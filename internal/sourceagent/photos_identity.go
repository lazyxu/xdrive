package sourceagent

import (
	"context"
	"errors"
	"fmt"
	"path"
	"path/filepath"
	"strings"

	"github.com/lazyxu/xdrive/internal/synology"
)

type PhotosRemote interface {
	Available(synology.Space) bool
	ListFoldersPage(context.Context, synology.Space, int, int) (synology.FolderPage, error)
	ListItemsPage(context.Context, synology.Space, int, int) (synology.ItemPage, error)
}

type photosIdentityRecord struct {
	ExternalID string
	Size       int64
}

type photosHeartbeatError struct {
	err error
}

func (e *photosHeartbeatError) Error() string { return e.err.Error() }
func (e *photosHeartbeatError) Unwrap() error { return e.err }

func buildPhotosIdentityIndex(ctx context.Context, remote PhotosRemote, roots []Root, heartbeat func() error) (map[string]photosIdentityRecord, []string, error) {
	out := make(map[string]photosIdentityRecord)
	if remote == nil {
		return out, nil, nil
	}
	var warnings []string
	for _, root := range roots {
		space, ok := photosSpaceForRoot(root.Key)
		if !ok {
			continue
		}
		if !remote.Available(space) {
			warnings = append(warnings, fmt.Sprintf("Synology Photos %s space unavailable; filesystem identity fallback", root.Key))
			continue
		}
		index, err := buildPhotosIdentityIndexForRoot(ctx, remote, space, root, heartbeat)
		if err != nil {
			var heartbeatErr *photosHeartbeatError
			if errors.As(err, &heartbeatErr) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return out, warnings, err
			}
			warnings = append(warnings, fmt.Sprintf("Synology Photos %s identity enrichment skipped: %v", root.Key, err))
			continue
		}
		for localPath, identity := range index {
			out[localPath] = identity
		}
	}
	return out, warnings, nil
}

func buildPhotosIdentityIndexForRoot(ctx context.Context, remote PhotosRemote, space synology.Space, root Root, heartbeat func() error) (map[string]photosIdentityRecord, error) {
	folders := make(map[int64]synology.Folder)
	offset := 0
	for pageNo := 0; pageNo < 100000; pageNo++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		page, err := remote.ListFoldersPage(ctx, space, offset, 500)
		if err != nil {
			return nil, err
		}
		for _, folder := range page.List {
			if folder.ID <= 0 {
				return nil, fmt.Errorf("invalid folder id %d", folder.ID)
			}
			if _, duplicate := folders[folder.ID]; duplicate {
				return nil, fmt.Errorf("duplicate folder id %d", folder.ID)
			}
			folders[folder.ID] = folder
		}
		if heartbeat != nil {
			if err := heartbeat(); err != nil {
				return nil, &photosHeartbeatError{err: err}
			}
		}
		next, done, err := photosNextOffset(offset, page.Offset, page.Total, len(page.List))
		if err != nil {
			return nil, err
		}
		if done {
			break
		}
		offset = next
	}
	folderPaths, err := exactPhotosFolderPaths(folders)
	if err != nil {
		return nil, err
	}

	out := make(map[string]photosIdentityRecord)
	seenIDs := make(map[string]string)
	offset = 0
	for pageNo := 0; pageNo < 100000; pageNo++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		page, err := remote.ListItemsPage(ctx, space, offset, 500)
		if err != nil {
			return nil, err
		}
		for _, item := range page.List {
			if item.Filesize < 0 {
				return nil, fmt.Errorf("invalid item size for id %d", item.ID)
			}
			externalID, err := synology.ExternalID(space, item.ID)
			if err != nil {
				return nil, err
			}
			relative, err := exactPhotosItemPath(folderPaths[item.FolderID], item.Filename)
			if err != nil {
				return nil, fmt.Errorf("item %d path: %w", item.ID, err)
			}
			localPath, err := localPathWithinRoot(root.Path, relative)
			if err != nil {
				return nil, fmt.Errorf("item %d local path: %w", item.ID, err)
			}
			if prior, duplicate := seenIDs[externalID]; duplicate && prior != localPath {
				return nil, fmt.Errorf("item identity %s maps to multiple local paths", externalID)
			}
			seenIDs[externalID] = localPath
			if prior, duplicate := out[localPath]; duplicate && prior.ExternalID != externalID {
				return nil, fmt.Errorf("local path %q maps to multiple Photos identities", relative)
			}
			out[localPath] = photosIdentityRecord{ExternalID: externalID, Size: item.Filesize}
		}
		if heartbeat != nil {
			if err := heartbeat(); err != nil {
				return nil, &photosHeartbeatError{err: err}
			}
		}
		next, done, err := photosNextOffset(offset, page.Offset, page.Total, len(page.List))
		if err != nil {
			return nil, err
		}
		if done {
			return out, nil
		}
		offset = next
	}
	return nil, fmt.Errorf("Photos item pagination exceeded safety limit")
}

func exactPhotosFolderPaths(folders map[int64]synology.Folder) (map[int64]string, error) {
	out := make(map[int64]string, len(folders))
	visiting := make(map[int64]bool)
	var resolve func(int64) (string, error)
	resolve = func(id int64) (string, error) {
		if value, ok := out[id]; ok {
			return value, nil
		}
		folder, ok := folders[id]
		if !ok {
			return "", fmt.Errorf("missing folder id %d", id)
		}
		if visiting[id] {
			return "", fmt.Errorf("folder parent cycle at id %d", id)
		}
		visiting[id] = true
		segment, err := exactPhotosSegment(folder.Name, true)
		if err != nil {
			return "", fmt.Errorf("folder %d: %w", id, err)
		}
		parent := ""
		if folder.Parent > 0 {
			parent, err = resolve(folder.Parent)
			if err != nil {
				return "", err
			}
		}
		visiting[id] = false
		if parent == "" {
			out[id] = segment
		} else if segment == "" {
			out[id] = parent
		} else {
			out[id] = path.Join(parent, segment)
		}
		return out[id], nil
	}
	for id := range folders {
		if _, err := resolve(id); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func exactPhotosItemPath(parent, filename string) (string, error) {
	name, err := exactPhotosSegment(filename, false)
	if err != nil {
		return "", err
	}
	if parent == "" {
		return name, nil
	}
	return path.Join(parent, name), nil
}

func exactPhotosSegment(value string, allowEmpty bool) (string, error) {
	value = strings.Trim(value, "/")
	if value == "" {
		if allowEmpty {
			return "", nil
		}
		return "", fmt.Errorf("empty path segment")
	}
	if value == "." || value == ".." || strings.ContainsRune(value, '/') || strings.ContainsRune(value, 0) {
		return "", fmt.Errorf("unsafe path segment %q", value)
	}
	return value, nil
}

func localPathWithinRoot(rootPath, relative string) (string, error) {
	rootPath = filepath.Clean(rootPath)
	localPath := filepath.Clean(filepath.Join(rootPath, filepath.FromSlash(relative)))
	rel, err := filepath.Rel(rootPath, localPath)
	if err != nil {
		return "", err
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", fmt.Errorf("path escapes configured root")
	}
	return localPath, nil
}

func photosSpaceForRoot(key string) (synology.Space, bool) {
	switch strings.TrimSpace(key) {
	case "personal":
		return synology.SpacePersonal, true
	case "shared":
		return synology.SpaceShared, true
	default:
		return "", false
	}
}

func photosNextOffset(requested, returned, total, count int) (int, bool, error) {
	if requested < 0 || returned < 0 || total < 0 || count < 0 {
		return 0, false, fmt.Errorf("pagination returned negative values")
	}
	if count == 0 {
		if total <= requested {
			return requested, true, nil
		}
		return 0, false, fmt.Errorf("pagination returned no entries before total=%d", total)
	}
	if returned != requested {
		return 0, false, fmt.Errorf("pagination offset mismatch: requested=%d returned=%d", requested, returned)
	}
	next := requested + count
	if total > 0 && next > total {
		return 0, false, fmt.Errorf("pagination exceeded total: next=%d total=%d", next, total)
	}
	return next, total > 0 && next == total, nil
}
