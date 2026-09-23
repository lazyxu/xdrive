//go:build windows

package mount

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/lazyxu/xdrive/internal/client"
)

type winState struct {
	node         client.Node
	localModTime time.Time
	localSize    int64
}

type winProvider struct {
	cli      *client.Client
	root     string
	connKey  int64
	mu       sync.Mutex
	baseline map[string]winState
	hydrated map[uint64]time.Time
}

var activeWinProvider struct {
	sync.RWMutex
	p *winProvider
}

func runPlatform(ctx context.Context, cli *client.Client, root string) error {
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}
	if err := cfRegister(root); err != nil {
		return err
	}
	p := &winProvider{cli: cli, root: root, baseline: map[string]winState{}, hydrated: map[uint64]time.Time{}}
	activeWinProvider.Lock()
	activeWinProvider.p = p
	activeWinProvider.Unlock()
	defer func() { activeWinProvider.Lock(); activeWinProvider.p = nil; activeWinProvider.Unlock() }()

	callback := newCallback(func(info *cfCallbackInfo, params *cfCallbackParametersFetchData) uintptr {
		fetchData(info, params)
		return 0
	})
	key, err := cfConnect(root, callback)
	if err != nil {
		return err
	}
	p.connKey = key
	defer cfDisconnect(key)

	if err := p.initialSync(ctx); err != nil {
		return err
	}
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := p.reconcile(ctx); err != nil {
				fmt.Fprintln(os.Stderr, "xd: Windows sync:", err)
			}
		}
	}
}

func fetchData(info *cfCallbackInfo, params *cfCallbackParametersFetchData) {
	activeWinProvider.RLock()
	p := activeWinProvider.p
	activeWinProvider.RUnlock()
	if p == nil || info == nil || params == nil {
		return
	}
	identity := copyIdentity(info.FileIdentity, info.FileIdentityLength)
	id, err := client.ParseNodeID(identity)
	if err != nil {
		cfTransferFailure(info, params.RequiredFileOffset, params.RequiredLength)
		return
	}
	p.mu.Lock()
	p.hydrated[id] = time.Now()
	p.mu.Unlock()
	offset, remaining := params.RequiredFileOffset, params.RequiredLength
	const chunkSize int64 = 4 << 20
	for remaining > 0 {
		want := remaining
		if want > chunkSize {
			want = chunkSize
		}
		data, err := p.cli.DownloadRange(context.Background(), id, offset, want)
		if err != nil || int64(len(data)) == 0 {
			cfTransferFailure(info, offset, remaining)
			return
		}
		if err := cfTransfer(info, data, offset); err != nil {
			return
		}
		offset += int64(len(data))
		remaining -= int64(len(data))
	}
}

func copyIdentity(ptr unsafe.Pointer, n uint32) []byte {
	if ptr == nil || n == 0 {
		return nil
	}
	src := unsafe.Slice((*byte)(ptr), int(n))
	out := make([]byte, len(src))
	copy(out, src)
	return out
}

func (p *winProvider) initialSync(ctx context.Context) error {
	remote, err := p.cli.Walk(ctx)
	if err != nil {
		return err
	}
	paths := sortedPaths(remote, true)
	for _, rel := range paths {
		if rel == "" {
			continue
		}
		n := remote[rel]
		abs := filepath.Join(p.root, filepath.FromSlash(rel))
		if n.Type == "dir" {
			if err := os.MkdirAll(abs, 0o755); err != nil {
				return err
			}
		} else if _, err := os.Lstat(abs); errors.Is(err, os.ErrNotExist) {
			if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
				return err
			}
			if err := cfCreatePlaceholder(filepath.Dir(abs), filepath.Base(abs), n.ID, n.Size, n.UpdatedAt.UnixNano(), false); err != nil {
				return err
			}
		}
	}
	return p.captureBaseline(remote)
}

func (p *winProvider) captureBaseline(remote map[string]client.Node) error {
	base := make(map[string]winState, len(remote))
	for rel, n := range remote {
		if rel == "" {
			base[rel] = winState{node: n}
			continue
		}
		st, err := os.Stat(filepath.Join(p.root, filepath.FromSlash(rel)))
		if err != nil {
			continue
		}
		base[rel] = winState{node: n, localModTime: st.ModTime(), localSize: st.Size()}
	}
	p.mu.Lock()
	p.baseline = base
	p.mu.Unlock()
	return nil
}

func (p *winProvider) reconcile(ctx context.Context) error {
	local, err := scanLocal(p.root)
	if err != nil {
		return err
	}
	p.mu.Lock()
	baseline := cloneBaseline(p.baseline)
	hydrated := cloneHydrated(p.hydrated)
	p.mu.Unlock()

	// Local additions in parent-first order.
	localPaths := make([]string, 0, len(local))
	for rel := range local {
		if rel != "" {
			localPaths = append(localPaths, rel)
		}
	}
	sort.Slice(localPaths, func(i, j int) bool {
		if depth(localPaths[i]) == depth(localPaths[j]) {
			return localPaths[i] < localPaths[j]
		}
		return depth(localPaths[i]) < depth(localPaths[j])
	})
	for _, rel := range localPaths {
		if _, ok := baseline[rel]; ok {
			continue
		}
		entry := local[rel]
		parentRel := slashDir(rel)
		parent, ok := baseline[parentRel]
		if !ok {
			continue
		}
		if entry.isDir {
			n, err := p.cli.CreateDir(ctx, parent.node.ID, slashBase(rel))
			if err != nil {
				return err
			}
			baseline[rel] = stateFromLocal(n, entry)
		} else {
			n, err := p.cli.UploadFile(ctx, parent.node.ID, filepath.Join(p.root, filepath.FromSlash(rel)), slashBase(rel))
			if err != nil {
				return err
			}
			baseline[rel] = stateFromLocal(n, entry)
		}
	}

	// Existing local files: resumable fixed-chunk upload on size/mtime change. Hydration
	// is ignored for a short grace window so reads do not become writes.
	for rel, entry := range local {
		base, ok := baseline[rel]
		if !ok || entry.isDir || base.node.Type != "file" {
			continue
		}
		if t, ok := hydrated[base.node.ID]; ok && time.Since(t) < 5*time.Second {
			continue
		}
		if entry.size == base.localSize && entry.modTime.Equal(base.localModTime) {
			continue
		}
		absPath := filepath.Join(p.root, filepath.FromSlash(rel))
		n, upErr := p.cli.OverwriteFileResumable(ctx, base.node.ID, base.node.Revision, absPath, nil)
		if upErr != nil {
			if !client.IsRevisionConflict(upErr) || base.node.ParentID == nil {
				return upErr
			}
			abs := filepath.Join(p.root, filepath.FromSlash(rel))
			conflictRel := joinSlash(slashDir(rel), conflictName(slashBase(rel)))
			conflictAbs := filepath.Join(p.root, filepath.FromSlash(conflictRel))
			if err := copyLocalFile(abs, conflictAbs); err != nil {
				return err
			}
			conflictNode, err := p.cli.UploadFile(ctx, *base.node.ParentID, conflictAbs, slashBase(conflictRel))
			if err != nil {
				return err
			}
			emitEvent(Event{Kind: EventConflict, Path: conflictRel})
			if st, err := os.Stat(conflictAbs); err == nil {
				local[conflictRel] = localEntry{isDir: false, size: st.Size(), modTime: st.ModTime()}
				baseline[conflictRel] = winState{node: conflictNode, localModTime: st.ModTime(), localSize: st.Size()}
			}
			remoteNow, err := p.cli.Walk(ctx)
			if err != nil {
				return err
			}
			current, ok := findNodeByID(remoteNow, base.node.ID)
			if !ok {
				return fmt.Errorf("conflict source node %d disappeared", base.node.ID)
			}
			_ = os.Remove(abs)
			if err := cfCreatePlaceholder(filepath.Dir(abs), filepath.Base(abs), current.ID, current.Size, current.UpdatedAt.UnixNano(), false); err != nil {
				return err
			}
			if st, err := os.Stat(abs); err == nil {
				local[rel] = localEntry{isDir: false, size: st.Size(), modTime: st.ModTime()}
				baseline[rel] = winState{node: current, localModTime: st.ModTime(), localSize: st.Size()}
			}
			continue
		}
		baseline[rel] = stateFromLocal(n, entry)
	}

	// Local deletions run after additions and writes. This ordering matters for
	// renaming an online-only placeholder: the new path can hydrate from the old
	// server node before the old node is removed.
	missing := make([]string, 0)
	for rel := range baseline {
		if rel != "" {
			if _, ok := local[rel]; !ok {
				missing = append(missing, rel)
			}
		}
	}
	sort.Slice(missing, func(i, j int) bool { return depth(missing[i]) < depth(missing[j]) })
	deletedPrefix := []string{}
	for _, rel := range missing {
		if underAny(rel, deletedPrefix) {
			continue
		}
		if err := p.cli.Delete(ctx, baseline[rel].node.ID, baseline[rel].node.Revision); err != nil {
			var apiErr *client.APIError
			if errors.As(err, &apiErr) && apiErr.Status == 409 {
				continue
			}
			if !errors.As(err, &apiErr) || apiErr.Status != 404 {
				return err
			}
		}
		deletedPrefix = append(deletedPrefix, rel)
		deletePrefix(baseline, rel)
	}

	// Pull server-side changes made through Web/API. Local dirty changes were
	// already uploaded above, so this is a simple last-writer-wins MVP policy.
	remote, err := p.cli.Walk(ctx)
	if err != nil {
		return err
	}
	remotePaths := sortedPaths(remote, true)
	for _, rel := range remotePaths {
		if rel == "" {
			continue
		}
		rn := remote[rel]
		base, exists := baseline[rel]
		abs := filepath.Join(p.root, filepath.FromSlash(rel))
		if exists {
			if _, statErr := os.Lstat(abs); errors.Is(statErr, os.ErrNotExist) {
				if rn.Type == "dir" {
					if err := os.MkdirAll(abs, 0o755); err != nil {
						return err
					}
				} else {
					if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
						return err
					}
					if err := cfCreatePlaceholder(filepath.Dir(abs), filepath.Base(abs), rn.ID, rn.Size, rn.UpdatedAt.UnixNano(), false); err != nil {
						return err
					}
				}
				if st, err := os.Stat(abs); err == nil {
					baseline[rel] = winState{node: rn, localModTime: st.ModTime(), localSize: st.Size()}
				}
				continue
			}
		}
		if !exists {
			if rn.Type == "dir" {
				if err := os.MkdirAll(abs, 0o755); err != nil {
					return err
				}
			} else {
				if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
					return err
				}
				if err := cfCreatePlaceholder(filepath.Dir(abs), filepath.Base(abs), rn.ID, rn.Size, rn.UpdatedAt.UnixNano(), false); err != nil {
					return err
				}
			}
			if st, err := os.Stat(abs); err == nil {
				baseline[rel] = winState{node: rn, localModTime: st.ModTime(), localSize: st.Size()}
			}
			continue
		}
		if rn.Type == "file" && rn.Revision != base.node.Revision {
			_ = os.Remove(abs)
			if err := cfCreatePlaceholder(filepath.Dir(abs), filepath.Base(abs), rn.ID, rn.Size, rn.UpdatedAt.UnixNano(), false); err != nil {
				return err
			}
			if st, err := os.Stat(abs); err == nil {
				baseline[rel] = winState{node: rn, localModTime: st.ModTime(), localSize: st.Size()}
			}
		} else {
			base.node = rn
			baseline[rel] = base
		}
	}
	// Remote deletions (for example from Web UI).
	for rel := range baseline {
		if rel == "" {
			continue
		}
		if _, ok := remote[rel]; ok {
			continue
		}
		_ = os.RemoveAll(filepath.Join(p.root, filepath.FromSlash(rel)))
		deletePrefix(baseline, rel)
	}
	p.mu.Lock()
	p.baseline = baseline
	for id, t := range p.hydrated {
		if time.Since(t) > 30*time.Second {
			delete(p.hydrated, id)
		}
	}
	p.mu.Unlock()
	return nil
}

type localEntry struct {
	isDir   bool
	size    int64
	modTime time.Time
}

func scanLocal(root string) (map[string]localEntry, error) {
	out := map[string]localEntry{"": {isDir: true}}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if path == root {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		info, err := d.Info()
		if err != nil {
			return err
		}
		out[rel] = localEntry{isDir: d.IsDir(), size: info.Size(), modTime: info.ModTime()}
		return nil
	})
	return out, err
}

func copyLocalFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func joinSlash(dir, base string) string {
	if dir == "" {
		return base
	}
	return dir + "/" + base
}

func findNodeByID(nodes map[string]client.Node, id uint64) (client.Node, bool) {
	for _, n := range nodes {
		if n.ID == id {
			return n, true
		}
	}
	return client.Node{}, false
}

func stateFromLocal(n client.Node, e localEntry) winState {
	return winState{node: n, localModTime: e.modTime, localSize: e.size}
}
func cloneBaseline(in map[string]winState) map[string]winState {
	out := make(map[string]winState, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
func cloneHydrated(in map[uint64]time.Time) map[uint64]time.Time {
	out := make(map[uint64]time.Time, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
func depth(s string) int {
	if s == "" {
		return 0
	}
	return strings.Count(s, "/") + 1
}
func slashDir(s string) string {
	if i := strings.LastIndexByte(s, '/'); i >= 0 {
		return s[:i]
	}
	return ""
}
func slashBase(s string) string {
	if i := strings.LastIndexByte(s, '/'); i >= 0 {
		return s[i+1:]
	}
	return s
}
func underAny(path string, prefixes []string) bool {
	for _, p := range prefixes {
		if path == p || strings.HasPrefix(path, p+"/") {
			return true
		}
	}
	return false
}
func deletePrefix(m map[string]winState, prefix string) {
	for k := range m {
		if k == prefix || strings.HasPrefix(k, prefix+"/") {
			delete(m, k)
		}
	}
}
func sortedPaths(m map[string]client.Node, parentsFirst bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Slice(out, func(i, j int) bool {
		di, dj := depth(out[i]), depth(out[j])
		if di == dj {
			return out[i] < out[j]
		}
		if parentsFirst {
			return di < dj
		}
		return di > dj
	})
	return out
}
