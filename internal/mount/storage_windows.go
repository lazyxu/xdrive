//go:build windows

package mount

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/lazyxu/xdrive/internal/client"
	"golang.org/x/sys/windows"
)

var (
	kernel32Storage            = windows.NewLazySystemDLL("kernel32.dll")
	procGetCompressedFileSizeW = kernel32Storage.NewProc("GetCompressedFileSizeW")
)

type cacheCandidate struct {
	path       string
	allocated  int64
	lastAccess time.Time
}

func (p *winProvider) filterRemote(remote map[string]client.Node) map[string]client.Node {
	out := make(map[string]client.Node, len(remote))
	for rel, node := range remote {
		if rel != "" && p.policy.excludedPath(rel) {
			continue
		}
		out[rel] = node
	}
	return out
}

func (p *winProvider) prepareExcludedLocal(remote map[string]client.Node) error {
	excluded := append([]string(nil), p.policy.excluded...)
	sort.Slice(excluded, func(i, j int) bool {
		di, dj := policyDepth(excluded[i]), policyDepth(excluded[j])
		if di == dj {
			return excluded[i] < excluded[j]
		}
		return di < dj
	})
	handled := make([]string, 0, len(excluded))
	for _, rel := range excluded {
		if underAny(rel, handled) {
			continue
		}
		abs := filepath.Join(p.root, filepath.FromSlash(rel))
		_, localErr := os.Lstat(abs)
		remotePath, node, ok := remoteNodeFold(remote, rel)
		if !ok {
			if errors.Is(localErr, os.ErrNotExist) {
				handled = append(handled, rel)
				continue
			}
			return fmt.Errorf("excluded path %q no longer exists remotely but local content remains", rel)
		}
		if node.Type != "dir" {
			return fmt.Errorf("selective-sync excluded path %q is no longer a remote directory", rel)
		}
		rel = remotePath
		abs = filepath.Join(p.root, filepath.FromSlash(rel))
		if errors.Is(localErr, os.ErrNotExist) {
			handled = append(handled, rel)
			continue
		} else if localErr != nil {
			return localErr
		}
		if err := filepath.WalkDir(abs, func(path string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			childRel, err := filepath.Rel(p.root, path)
			if err != nil {
				return err
			}
			childRel = filepath.ToSlash(childRel)
			_, remoteNode, ok := remoteNodeFold(remote, childRel)
			if !ok {
				return fmt.Errorf("%s has local-only content; sync it before excluding this directory", path)
			}
			if entry.IsDir() != (remoteNode.Type == "dir") {
				return fmt.Errorf("%s differs from the remote object type", path)
			}
			if entry.IsDir() {
				return nil
			}
			state, err := availabilityPlatform(path)
			if err != nil {
				return err
			}
			if !state.Placeholder || !state.InSync {
				return fmt.Errorf("%s is not safely synchronized; sync it before excluding this directory", path)
			}
			return nil
		}); err != nil {
			return err
		}
		if err := os.RemoveAll(abs); err != nil {
			return fmt.Errorf("remove excluded local directory %s: %w", abs, err)
		}
		handled = append(handled, rel)
	}
	return nil
}

func remoteNodeFold(remote map[string]client.Node, rel string) (string, client.Node, bool) {
	for path, node := range remote {
		if strings.EqualFold(path, rel) {
			return path, node, true
		}
	}
	return "", client.Node{}, false
}

func scanLocalWithPolicy(root string, policy syncPolicy) (map[string]localEntry, error) {
	out := map[string]localEntry{"": {isDir: true}}
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if policy.excludedPath(rel) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		out[rel] = localEntry{isDir: entry.IsDir(), size: info.Size(), modTime: info.ModTime()}
		return nil
	})
	return out, err
}

func (p *winProvider) applyStoragePolicySnapshot() error {
	p.mu.Lock()
	baseline := cloneBaseline(p.baseline)
	p.mu.Unlock()
	if err := p.applyAlwaysLocal(baseline); err != nil {
		return err
	}
	return p.enforceCache(baseline)
}

func (p *winProvider) applyAlwaysLocal(baseline map[string]winState) error {
	paths := make([]string, 0, len(baseline))
	for rel, state := range baseline {
		if rel == "" || state.node.Type != "file" || !p.policy.alwaysLocalPath(rel) {
			continue
		}
		paths = append(paths, rel)
	}
	sort.Strings(paths)
	for _, rel := range paths {
		abs := filepath.Join(p.root, filepath.FromSlash(rel))
		state, err := availabilityPlatform(abs)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return err
		}
		if !state.Placeholder || (state.Pinned && state.AvailableOffline) {
			continue
		}
		if err := setPinPath(abs, cfPinStatePinned, false); err != nil {
			return err
		}
		if !state.AvailableOffline {
			if err := hydratePath(abs); err != nil {
				return err
			}
		}
	}
	return nil
}

func (p *winProvider) enforceCacheSnapshot() error {
	p.mu.Lock()
	baseline := cloneBaseline(p.baseline)
	p.mu.Unlock()
	return p.enforceCache(baseline)
}

func (p *winProvider) enforceCache(baseline map[string]winState) error {
	if p.cacheLimit <= 0 {
		return nil
	}
	p.mu.Lock()
	accessed := make(map[uint64]time.Time, len(p.accessed))
	for id, at := range p.accessed {
		accessed[id] = at
	}
	p.mu.Unlock()

	var total int64
	candidates := make([]cacheCandidate, 0)
	for rel, base := range baseline {
		if rel == "" || base.node.Type != "file" || p.policy.alwaysLocalPath(rel) || p.policy.excludedPath(rel) {
			continue
		}
		abs := filepath.Join(p.root, filepath.FromSlash(rel))
		state, err := availabilityPlatform(abs)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return err
		}
		if !state.Placeholder || !state.InSync || state.Pinned {
			continue
		}
		allocated, err := allocatedSizeWindows(abs)
		if err != nil {
			continue
		}
		if allocated <= 0 {
			continue
		}
		total += allocated
		at := accessed[base.node.ID]
		if fileAccess, accessErr := lastAccessWindows(abs); accessErr == nil && fileAccess.After(at) {
			at = fileAccess
		}
		if at.IsZero() {
			at = base.localModTime
		}
		candidates = append(candidates, cacheCandidate{path: abs, allocated: allocated, lastAccess: at})
	}
	if total <= p.cacheLimit {
		return nil
	}

	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].lastAccess.Equal(candidates[j].lastAccess) {
			return candidates[i].path < candidates[j].path
		}
		return candidates[i].lastAccess.Before(candidates[j].lastAccess)
	})
	now := time.Now()
	for _, candidate := range candidates {
		if total <= p.cacheLimit {
			break
		}
		if p.cacheGrace > 0 && !candidate.lastAccess.IsZero() && now.Sub(candidate.lastAccess) < p.cacheGrace {
			continue
		}
		if err := setPinPath(candidate.path, cfPinStateUnpinned, false); err != nil {
			continue
		}
		if err := dehydratePath(candidate.path); err != nil {
			continue
		}
		total -= candidate.allocated
	}
	return nil
}

func allocatedSizeWindows(path string) (int64, error) {
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	var high uint32
	low, _, callErr := procGetCompressedFileSizeW.Call(
		uintptr(unsafe.Pointer(ptr)),
		uintptr(unsafe.Pointer(&high)),
	)
	if uint32(low) == 0xffffffff {
		if errno, ok := callErr.(syscall.Errno); ok && errno != 0 {
			return 0, errno
		}
	}
	return int64((uint64(high) << 32) | uint64(uint32(low))), nil
}

func lastAccessWindows(path string) (time.Time, error) {
	ptr, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return time.Time{}, err
	}
	var data windows.Win32finddata
	h, err := windows.FindFirstFile(ptr, &data)
	if err != nil {
		return time.Time{}, err
	}
	if err := windows.FindClose(h); err != nil {
		return time.Time{}, err
	}
	return time.Unix(0, data.LastAccessTime.Nanoseconds()), nil
}
