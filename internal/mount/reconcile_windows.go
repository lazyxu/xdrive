//go:build windows

package mount

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
)

const winHydrationGrace = 1 * time.Second

var errWindowsHydrationSettling = errors.New("Windows placeholder hydration is still settling")

func (p *winProvider) reconcileLocalChanges(ctx context.Context, raw []winLocalChange) error {
	changes := collapseWindowsChanges(raw)
	if changes.Overflow {
		return p.reconcile(ctx)
	}

	p.mu.Lock()
	baseline := cloneBaseline(p.baseline)
	hydrated := cloneHydrated(p.hydrated)
	p.mu.Unlock()
	defer p.storeBaseline(baseline)

	pathSet := make(map[string]struct{}, len(changes.Paths)+len(changes.Renames)*2)
	for _, path := range changes.Paths {
		if p.policy.excludedPath(path) {
			continue
		}
		pathSet[path] = struct{}{}
	}

	sort.Slice(changes.Renames, func(i, j int) bool {
		di, dj := depth(changes.Renames[i].OldPath), depth(changes.Renames[j].OldPath)
		if di == dj {
			return changes.Renames[i].OldPath < changes.Renames[j].OldPath
		}
		return di < dj
	})
	for _, rename := range changes.Renames {
		oldExcluded := p.policy.excludedPath(rename.OldPath)
		newExcluded := p.policy.excludedPath(rename.NewPath)
		if oldExcluded && newExcluded {
			continue
		}
		if oldExcluded {
			pathSet[rename.NewPath] = struct{}{}
			continue
		}
		if newExcluded {
			pathSet[rename.OldPath] = struct{}{}
			continue
		}
		handled, err := p.applyLocalRename(ctx, rename, baseline)
		if err != nil {
			return err
		}
		if !handled {
			pathSet[rename.NewPath] = struct{}{}
			pathSet[rename.OldPath] = struct{}{}
		}
	}

	paths := make([]string, 0, len(pathSet))
	for path := range pathSet {
		paths = append(paths, path)
	}
	sortPathsByDepth(paths, true)

	processedSubtrees := make([]string, 0)
	for _, rel := range paths {
		if underAny(rel, processedSubtrees) {
			continue
		}
		abs := filepath.Join(p.root, filepath.FromSlash(rel))
		info, err := os.Lstat(abs)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return err
		}
		if _, exists := baseline[rel]; !exists {
			handled, err := p.reconcileMovedPlaceholder(ctx, rel, info, baseline)
			if err != nil {
				return err
			}
			if handled {
				if info.IsDir() {
					processedSubtrees = append(processedSubtrees, rel)
				}
				continue
			}
		}
		if info.IsDir() {
			if _, exists := baseline[rel]; !exists {
				if err := p.syncNewDirectoryTree(ctx, rel, baseline); err != nil {
					return err
				}
				processedSubtrees = append(processedSubtrees, rel)
			}
			continue
		}
		if err := p.syncLocalFile(ctx, rel, info, baseline, hydrated); err != nil {
			return err
		}
	}

	deletions := make([]string, 0)
	for rel := range pathSet {
		if _, err := os.Lstat(filepath.Join(p.root, filepath.FromSlash(rel))); errors.Is(err, os.ErrNotExist) {
			if _, exists := baseline[rel]; exists {
				deletions = append(deletions, rel)
			}
		}
	}
	sortPathsByDepth(deletions, true)
	deletedPrefix := make([]string, 0)
	for _, rel := range deletions {
		if underAny(rel, deletedPrefix) {
			continue
		}
		base, ok := baseline[rel]
		if !ok {
			continue
		}
		if err := p.cli.Delete(ctx, base.node.ID, base.node.Revision); err != nil {
			var apiErr *client.APIError
			if errors.As(err, &apiErr) && (apiErr.Status == 404 || apiErr.Status == 409) {
				continue
			}
			return err
		}
		deletePrefix(baseline, rel)
		deletedPrefix = append(deletedPrefix, rel)
	}
	if err := p.applyAlwaysLocal(baseline); err != nil {
		return err
	}
	if err := p.enforceCache(baseline); err != nil {
		return err
	}
	p.pruneTransientState()
	return nil
}

func (p *winProvider) applyLocalRename(ctx context.Context, rename winRename, baseline map[string]winState) (bool, error) {
	if rename.OldPath == rename.NewPath {
		return true, nil
	}
	base, ok := baseline[rename.OldPath]
	if !ok {
		return false, nil
	}
	_, err := os.Lstat(filepath.Join(p.root, filepath.FromSlash(rename.NewPath)))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	parentRel := slashDir(rename.NewPath)
	parent, ok := baseline[parentRel]
	if !ok {
		return false, nil
	}
	name := slashBase(rename.NewPath)
	parentID := parent.node.ID
	updated, err := p.cli.RenameMove(ctx, base.node.ID, base.node.Revision, &name, &parentID)
	if err != nil {
		var apiErr *client.APIError
		if client.IsRevisionConflict(err) || (errors.As(err, &apiErr) && (apiErr.Status == 404 || apiErr.Status == 409)) {
			return false, nil
		}
		return false, err
	}

	deletePrefix(baseline, rename.NewPath)
	moveBaselinePrefix(baseline, rename.OldPath, rename.NewPath)
	rootState := baseline[rename.NewPath]
	rootState.node = updated
	baseline[rename.NewPath] = rootState
	if err := cfMarkPathInSync(filepath.Join(p.root, filepath.FromSlash(rename.NewPath))); err != nil {
		return false, err
	}
	return true, nil
}

func (p *winProvider) reconcileMovedPlaceholder(ctx context.Context, rel string, info os.FileInfo, baseline map[string]winState) (bool, error) {
	absPath := filepath.Join(p.root, filepath.FromSlash(rel))
	nodeID, placeholder, err := cfPlaceholderNodeID(absPath)
	if err != nil {
		return false, err
	}
	if !placeholder {
		return false, nil
	}

	oldRel, base, ok := findBaselinePathByNodeID(baseline, nodeID)
	if !ok || oldRel == rel {
		return false, nil
	}
	if err := p.ensureRemoteParent(ctx, rel, baseline); err != nil {
		return false, err
	}
	parent, ok := baseline[slashDir(rel)]
	if !ok {
		return false, fmt.Errorf("Windows sync baseline is missing target parent %q", slashDir(rel))
	}
	name := slashBase(rel)
	parentID := parent.node.ID
	updated, err := p.cli.RenameMove(ctx, base.node.ID, base.node.Revision, &name, &parentID)
	if err != nil {
		return false, err
	}

	deletePrefix(baseline, rel)
	moveBaselinePrefix(baseline, oldRel, rel)
	state := baseline[rel]
	state.node = updated
	state.localModTime = info.ModTime()
	state.localSize = info.Size()
	baseline[rel] = state
	if err := cfMarkPathInSync(absPath); err != nil {
		return false, err
	}
	return true, nil
}

func findBaselinePathByNodeID(baseline map[string]winState, nodeID uint64) (string, winState, bool) {
	for rel, state := range baseline {
		if rel != "" && state.node.ID == nodeID {
			return rel, state, true
		}
	}
	return "", winState{}, false
}

func moveBaselinePrefix(baseline map[string]winState, oldPrefix, newPrefix string) {
	keys := make([]string, 0)
	for path := range baseline {
		if path == oldPrefix || strings.HasPrefix(path, oldPrefix+"/") {
			keys = append(keys, path)
		}
	}
	sortPathsByDepth(keys, true)
	for _, oldPath := range keys {
		state := baseline[oldPath]
		suffix := strings.TrimPrefix(oldPath, oldPrefix)
		newPath := newPrefix + suffix
		delete(baseline, oldPath)
		baseline[newPath] = state
	}
}

func (p *winProvider) syncNewDirectoryTree(ctx context.Context, rel string, baseline map[string]winState) error {
	absRoot := filepath.Join(p.root, filepath.FromSlash(rel))
	return filepath.WalkDir(absRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		childRel, err := filepath.Rel(p.root, path)
		if err != nil {
			return err
		}
		childRel = filepath.ToSlash(childRel)
		if p.policy.excludedPath(childRel) {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if _, exists := baseline[childRel]; exists {
			return nil
		}
		if err := p.ensureRemoteParent(ctx, childRel, baseline); err != nil {
			return err
		}
		parent := baseline[slashDir(childRel)]
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if entry.IsDir() {
			node, err := p.cli.CreateDir(ctx, parent.node.ID, slashBase(childRel))
			if err != nil {
				return err
			}
			if err := cfConvertPathToPlaceholder(path, node.ID); err != nil {
				return err
			}
			baseline[childRel] = stateFromLocal(node, localEntry{isDir: true, modTime: info.ModTime()})
			return nil
		}
		task, progress := p.uploadTransfer(childRel, info.Size())
		node, err := p.cli.UploadFileResumable(ctx, parent.node.ID, path, slashBase(childRel), progress)
		finishTransfer(task, err)
		if err != nil {
			return err
		}
		if err := cfConvertPathToPlaceholder(path, node.ID); err != nil {
			return err
		}
		baseline[childRel] = stateFromLocal(node, localEntry{size: info.Size(), modTime: info.ModTime()})
		return nil
	})
}

func (p *winProvider) ensureRemoteParent(ctx context.Context, rel string, baseline map[string]winState) error {
	parentRel := slashDir(rel)
	if _, ok := baseline[parentRel]; ok {
		return nil
	}
	if parentRel == "" {
		return fmt.Errorf("Windows sync baseline is missing root")
	}
	info, err := os.Lstat(filepath.Join(p.root, filepath.FromSlash(parentRel)))
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("parent %s is not a directory", parentRel)
	}
	if err := p.ensureRemoteParent(ctx, parentRel, baseline); err != nil {
		return err
	}
	parent := baseline[slashDir(parentRel)]
	node, err := p.cli.CreateDir(ctx, parent.node.ID, slashBase(parentRel))
	if err != nil {
		return err
	}
	baseline[parentRel] = stateFromLocal(node, localEntry{isDir: true, modTime: info.ModTime()})
	return nil
}

func (p *winProvider) syncLocalFile(ctx context.Context, rel string, info os.FileInfo, baseline map[string]winState, hydrated map[uint64]time.Time) error {
	entry := localEntry{size: info.Size(), modTime: info.ModTime()}
	base, exists := baseline[rel]
	absPath := filepath.Join(p.root, filepath.FromSlash(rel))
	if !exists {
		if err := p.ensureRemoteParent(ctx, rel, baseline); err != nil {
			return err
		}
		parent := baseline[slashDir(rel)]
		task, progress := p.uploadTransfer(rel, entry.size)
		node, err := p.cli.UploadFileResumable(ctx, parent.node.ID, absPath, slashBase(rel), progress)
		finishTransfer(task, err)
		if err != nil {
			return err
		}
		if err := cfConvertPathToPlaceholder(absPath, node.ID); err != nil {
			return err
		}
		baseline[rel] = stateFromLocal(node, entry)
		return nil
	}
	if base.node.Type != "file" {
		return nil
	}
	if entry.size == base.localSize && entry.modTime.Equal(base.localModTime) {
		return nil
	}
	if t, ok := hydrated[base.node.ID]; ok && time.Since(t) < winHydrationGrace {
		return errWindowsHydrationSettling
	}

	task, progress := p.uploadTransfer(rel, entry.size)
	node, err := p.cli.OverwriteFileResumable(ctx, base.node.ID, base.node.Revision, absPath, progress)
	if err == nil {
		finishTransfer(task, nil)
		if syncErr := cfMarkPathInSync(absPath); syncErr != nil {
			return syncErr
		}
		baseline[rel] = stateFromLocal(node, entry)
		return nil
	}
	if !client.IsRevisionConflict(err) || base.node.ParentID == nil {
		finishTransfer(task, err)
		return err
	}

	conflictRel := joinSlash(slashDir(rel), conflictName(slashBase(rel)))
	conflictAbs := filepath.Join(p.root, filepath.FromSlash(conflictRel))
	if err := copyLocalFile(absPath, conflictAbs); err != nil {
		return err
	}
	conflictTask, conflictProgress := p.uploadTransfer(conflictRel, entry.size)
	conflictNode, err := p.cli.UploadFileResumable(ctx, *base.node.ParentID, conflictAbs, slashBase(conflictRel), conflictProgress)
	finishTransfer(conflictTask, err)
	if err != nil {
		return err
	}
	if err := cfConvertPathToPlaceholder(conflictAbs, conflictNode.ID); err != nil {
		finishTransfer(task, err)
		return err
	}
	finishTransfer(task, nil)
	emitEvent(Event{
		Kind:           EventConflict,
		Path:           conflictRel,
		OriginalPath:   rel,
		OriginalNodeID: base.node.ID,
		ConflictNodeID: conflictNode.ID,
	})
	if st, statErr := os.Stat(conflictAbs); statErr == nil {
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
	_ = os.Remove(absPath)
	if err := cfCreatePlaceholder(filepath.Dir(absPath), filepath.Base(absPath), current.ID, current.Size, current.UpdatedAt.UnixNano(), false); err != nil {
		return err
	}
	if st, statErr := os.Stat(absPath); statErr == nil {
		baseline[rel] = winState{node: current, localModTime: st.ModTime(), localSize: st.Size()}
	}
	return nil
}

func (p *winProvider) reconcileRemote(ctx context.Context) error {
	remote, err := p.cli.Walk(ctx)
	if err != nil {
		return err
	}
	remote = p.filterRemote(remote)
	p.mu.Lock()
	baseline := cloneBaseline(p.baseline)
	hydrated := cloneHydrated(p.hydrated)
	p.mu.Unlock()
	defer p.storeBaseline(baseline)

	remotePaths := sortedPaths(remote, true)
	for _, rel := range remotePaths {
		rn := remote[rel]
		if rel == "" {
			state := baseline[rel]
			state.node = rn
			baseline[rel] = state
			continue
		}

		base, exists := baseline[rel]
		abs := filepath.Join(p.root, filepath.FromSlash(rel))
		info, statErr := os.Lstat(abs)
		localExists := statErr == nil
		if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
			return statErr
		}

		if exists && !localExists && rn.Revision == base.node.Revision {
			if err := p.cli.Delete(ctx, base.node.ID, base.node.Revision); err == nil {
				deletePrefix(baseline, rel)
				continue
			}
		}

		if exists && localExists && !info.IsDir() && base.node.Type == "file" {
			if t, ok := hydrated[base.node.ID]; !ok || time.Since(t) >= winHydrationGrace {
				if info.Size() != base.localSize || !info.ModTime().Equal(base.localModTime) {
					if err := p.syncLocalFile(ctx, rel, info, baseline, hydrated); err != nil {
						return err
					}
					continue
				}
			}
		}

		base, exists = baseline[rel]
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

		if !localExists {
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
	if err := p.applyAlwaysLocal(baseline); err != nil {
		return err
	}
	if err := p.enforceCache(baseline); err != nil {
		return err
	}
	p.pruneTransientState()
	return nil
}

func (p *winProvider) storeBaseline(baseline map[string]winState) {
	p.mu.Lock()
	p.baseline = baseline
	p.mu.Unlock()
	if err := p.persistBaseline(baseline); err != nil {
		fmt.Fprintln(os.Stderr, "xd: persist Windows sync baseline:", err)
		emitEvent(Event{Kind: EventSyncFailed, Message: err.Error()})
	}
}

func (p *winProvider) pruneTransientState() {
	now := time.Now()
	p.mu.Lock()
	for id, t := range p.hydrated {
		if now.Sub(t) > 30*time.Second {
			delete(p.hydrated, id)
		}
	}
	for id, t := range p.accessed {
		if now.Sub(t) > 30*24*time.Hour {
			delete(p.accessed, id)
		}
	}
	p.mu.Unlock()
}
