package api

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	pathpkg "path"
	"strings"
	"time"

	humanize "github.com/dustin/go-humanize"
	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	archiveDownloadMaxRoots   = 1000
	archiveDownloadMaxEntries = 200000
)

var (
	errArchiveRootNotAllowed     = errors.New("archive root cannot be downloaded")
	errArchiveTooManyEntries     = errors.New("archive contains too many entries")
	errArchiveStoredContent      = errors.New("archive stored content unavailable")
	errArchiveInvalidStoredEntry = errors.New("archive contains invalid node name")
)

type archiveDownloadRequest struct {
	IDs        []uint64 `json:"ids"`
	TransferID string   `json:"transfer_id,omitempty"`
}

type archiveDownloadEntry struct {
	Path       string
	IsDir      bool
	StorageKey string
	Size       int64
	UpdatedAt  time.Time
}

type archiveDownloadManifest struct {
	Roots      []meta.Node
	Entries    []archiveDownloadEntry
	TotalBytes int64
}

func (s *Server) downloadArchive(c *gin.Context) {
	var req archiveDownloadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, "invalid request")
		return
	}
	ids, ok := normalizeArchiveDownloadIDs(req.IDs)
	if !ok {
		fail(c, http.StatusBadRequest, "ids must contain between 1 and 1000 valid node ids")
		return
	}

	manifest, err := s.buildArchiveDownloadManifest(c.Request.Context(), userID(c), ids)
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			fail(c, http.StatusNotFound, "archive item not found")
		case errors.Is(err, errArchiveRootNotAllowed), errors.Is(err, errArchiveInvalidStoredEntry):
			fail(c, http.StatusBadRequest, err.Error())
		case errors.Is(err, errArchiveTooManyEntries):
			fail(c, http.StatusRequestEntityTooLarge, err.Error())
		case errors.Is(err, errArchiveStoredContent):
			fail(c, http.StatusConflict, err.Error())
		default:
			fail(c, http.StatusInternalServerError, "prepare archive failed")
		}
		return
	}

	transferID := strings.TrimSpace(req.TransferID)
	if transferID != "" {
		if err := s.beginArchiveDownloadProgress(userID(c), transferID, ids, manifest); err != nil {
			switch {
			case errors.Is(err, errArchiveProgressNotFound):
				fail(c, http.StatusNotFound, "archive transfer not found")
			case errors.Is(err, errArchiveProgressMismatch):
				fail(c, http.StatusConflict, err.Error())
			default:
				fail(c, http.StatusInternalServerError, "start archive progress failed")
			}
			return
		}
	}

	filename := archiveDownloadFilename(manifest.Roots)
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(filename))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-XDrive-Archive-Entries", fmt.Sprintf("%d", len(manifest.Entries)))
	c.Header("X-XDrive-Archive-Bytes", fmt.Sprintf("%d", manifest.TotalBytes))

	zw := zip.NewWriter(c.Writer)
	for _, entry := range manifest.Entries {
		var done int64
		var onProgress func(int64)
		if transferID != "" && !entry.IsDir {
			s.updateArchiveDownloadProgress(transferID, entry.Path, "transferring", 0, nil)
			onProgress = func(delta int64) {
				done += max(int64(0), delta)
				s.updateArchiveDownloadProgress(transferID, entry.Path, "transferring", done, nil)
			}
		}
		if err := writeArchiveDownloadEntry(c.Request.Context(), s, zw, entry, onProgress); err != nil {
			_ = zw.Close()
			if transferID != "" && !entry.IsDir {
				s.updateArchiveDownloadProgress(transferID, entry.Path, "failed", done, err)
				s.finishArchiveDownloadProgress(transferID, archiveProgressContextState(c.Request.Context()), err)
			}
			_ = c.Error(err)
			return
		}
		if transferID != "" && !entry.IsDir {
			s.updateArchiveDownloadProgress(transferID, entry.Path, "completed", entry.Size, nil)
		}
	}
	if err := zw.Close(); err != nil {
		if transferID != "" {
			s.finishArchiveDownloadProgress(transferID, "failed", err)
		}
		_ = c.Error(err)
		return
	}
	if transferID != "" {
		s.finishArchiveDownloadProgress(transferID, "completed", nil)
	}
}

func normalizeArchiveDownloadIDs(requested []uint64) ([]uint64, bool) {
	if len(requested) == 0 || len(requested) > archiveDownloadMaxRoots {
		return nil, false
	}
	seen := make(map[uint64]struct{}, len(requested))
	ids := make([]uint64, 0, len(requested))
	for _, id := range requested {
		if id == 0 {
			return nil, false
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids, len(ids) > 0
}

func (s *Server) buildArchiveDownloadManifest(
	ctx context.Context,
	uid uint64,
	ids []uint64,
) (archiveDownloadManifest, error) {
	var loaded []meta.Node
	if err := s.DB.WithContext(ctx).
		Preload("File").
		Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", ids, uid).
		Find(&loaded).Error; err != nil {
		return archiveDownloadManifest{}, err
	}
	if len(loaded) != len(ids) {
		return archiveDownloadManifest{}, gorm.ErrRecordNotFound
	}

	byID := make(map[uint64]meta.Node, len(loaded))
	selected := make(map[uint64]struct{}, len(loaded))
	for _, node := range loaded {
		byID[node.ID] = node
		selected[node.ID] = struct{}{}
	}
	ordered := make([]meta.Node, 0, len(ids))
	for _, id := range ids {
		node, ok := byID[id]
		if !ok {
			return archiveDownloadManifest{}, gorm.ErrRecordNotFound
		}
		if node.ParentID == nil || strings.TrimSpace(node.Name) == "" {
			return archiveDownloadManifest{}, errArchiveRootNotAllowed
		}
		if _, err := archivePathSegment(node.Name); err != nil {
			return archiveDownloadManifest{}, err
		}
		ordered = append(ordered, node)
	}

	parentCache := make(map[uint64]meta.Node)
	roots := make([]meta.Node, 0, len(ordered))
	for _, node := range ordered {
		nested, err := s.archiveNodeHasSelectedAncestor(ctx, uid, node, selected, parentCache)
		if err != nil {
			return archiveDownloadManifest{}, err
		}
		if !nested {
			roots = append(roots, node)
		}
	}

	manifest := archiveDownloadManifest{Roots: roots}
	reservedRootNames := make(map[string]struct{}, len(roots))
	visited := make(map[uint64]struct{})
	for _, root := range roots {
		rootName, err := archiveUniqueRootName(root.Name, root.Type, reservedRootNames)
		if err != nil {
			return archiveDownloadManifest{}, err
		}
		if err := s.appendArchiveDownloadNode(ctx, uid, root, rootName, &manifest, visited); err != nil {
			return archiveDownloadManifest{}, err
		}
	}
	return manifest, nil
}

func (s *Server) archiveNodeHasSelectedAncestor(
	ctx context.Context,
	uid uint64,
	node meta.Node,
	selected map[uint64]struct{},
	cache map[uint64]meta.Node,
) (bool, error) {
	parentID := node.ParentID
	seen := map[uint64]struct{}{node.ID: {}}
	for parentID != nil {
		if _, cycle := seen[*parentID]; cycle {
			return false, errArchiveInvalidStoredEntry
		}
		seen[*parentID] = struct{}{}
		if _, ok := selected[*parentID]; ok {
			return true, nil
		}
		parent, ok := cache[*parentID]
		if !ok {
			if err := s.DB.WithContext(ctx).
				Select("id", "parent_id", "name", "type", "owner_id").
				Where("id = ? AND owner_id = ? AND deleted_at IS NULL", *parentID, uid).
				First(&parent).Error; err != nil {
				return false, err
			}
			cache[parent.ID] = parent
		}
		parentID = parent.ParentID
	}
	return false, nil
}

func (s *Server) appendArchiveDownloadNode(
	ctx context.Context,
	uid uint64,
	node meta.Node,
	archivePath string,
	manifest *archiveDownloadManifest,
	visited map[uint64]struct{},
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if _, ok := visited[node.ID]; ok {
		return errArchiveInvalidStoredEntry
	}
	visited[node.ID] = struct{}{}
	if len(manifest.Entries) >= archiveDownloadMaxEntries {
		return errArchiveTooManyEntries
	}

	if node.Type == meta.NodeTypeDir {
		manifest.Entries = append(manifest.Entries, archiveDownloadEntry{
			Path: archivePath + "/", IsDir: true, UpdatedAt: node.UpdatedAt,
		})
		var children []meta.Node
		if err := s.DB.WithContext(ctx).
			Preload("File").
			Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL", uid, node.ID).
			Order("lower(name) ASC, id ASC").
			Find(&children).Error; err != nil {
			return err
		}
		for _, child := range children {
			segment, err := archivePathSegment(child.Name)
			if err != nil {
				return err
			}
			if err := s.appendArchiveDownloadNode(
				ctx,
				uid,
				child,
				pathpkg.Join(archivePath, segment),
				manifest,
				visited,
			); err != nil {
				return err
			}
		}
		return nil
	}
	if node.Type != meta.NodeTypeFile || node.File == nil {
		return errArchiveInvalidStoredEntry
	}
	if node.File.Size < 0 || strings.TrimSpace(node.File.StorageKey) == "" {
		return errArchiveStoredContent
	}
	if err := s.validateArchiveStoredFile(ctx, *node.File); err != nil {
		return err
	}
	const maxInt64 = int64(^uint64(0) >> 1)
	if node.File.Size > 0 && manifest.TotalBytes > maxInt64-node.File.Size {
		return errArchiveTooManyEntries
	}
	manifest.TotalBytes += node.File.Size
	manifest.Entries = append(manifest.Entries, archiveDownloadEntry{
		Path: archivePath, StorageKey: node.File.StorageKey, Size: node.File.Size, UpdatedAt: node.UpdatedAt,
	})
	return nil
}

func (s *Server) validateArchiveStoredFile(ctx context.Context, file meta.File) error {
	f, err := s.Store.Open(ctx, file.StorageKey)
	if err != nil {
		return fmt.Errorf("%w: %v", errArchiveStoredContent, err)
	}
	info, statErr := f.Stat()
	closeErr := f.Close()
	if statErr != nil {
		return fmt.Errorf("%w: %v", errArchiveStoredContent, statErr)
	}
	if closeErr != nil {
		return fmt.Errorf("%w: %v", errArchiveStoredContent, closeErr)
	}
	if info.Size() != file.Size {
		return fmt.Errorf("%w: stored size=%s metadata size=%s", errArchiveStoredContent, humanize.IBytes(uint64(max(int64(0), info.Size()))), humanize.IBytes(uint64(max(int64(0), file.Size))))
	}
	return nil
}

func archivePathSegment(name string) (string, error) {
	if err := meta.ValidateName(name); err != nil {
		return "", errArchiveInvalidStoredEntry
	}
	if name == "." || name == ".." || strings.ContainsAny(name, "/\\\x00") {
		return "", errArchiveInvalidStoredEntry
	}
	return name, nil
}

func archiveUniqueRootName(
	name string,
	nodeType string,
	reserved map[string]struct{},
) (string, error) {
	if _, err := archivePathSegment(name); err != nil {
		return "", err
	}
	available := func(candidate string) bool {
		_, exists := reserved[strings.ToLower(candidate)]
		return !exists
	}
	if available(name) {
		reserved[strings.ToLower(name)] = struct{}{}
		return name, nil
	}

	base, ext := name, ""
	if nodeType == meta.NodeTypeFile {
		if dot := strings.LastIndex(name, "."); dot > 0 {
			base, ext = name[:dot], name[dot:]
		}
	}
	for index := 1; index <= 9999; index++ {
		suffix := " - 副本"
		if index > 1 {
			suffix = fmt.Sprintf(" - 副本 (%d)", index)
		}
		candidate := base + suffix + ext
		if _, err := archivePathSegment(candidate); err != nil {
			return "", err
		}
		if available(candidate) {
			reserved[strings.ToLower(candidate)] = struct{}{}
			return candidate, nil
		}
	}
	return "", errArchiveTooManyEntries
}

func archiveDownloadFilename(roots []meta.Node) string {
	if len(roots) == 1 && roots[0].Type == meta.NodeTypeDir {
		return roots[0].Name + ".zip"
	}
	return "xDrive-download.zip"
}

func writeArchiveDownloadEntry(
	ctx context.Context,
	s *Server,
	zw *zip.Writer,
	entry archiveDownloadEntry,
	onProgress func(int64),
) error {
	header := &zip.FileHeader{Name: entry.Path, Method: zip.Store}
	header.SetModTime(entry.UpdatedAt)
	if entry.IsDir {
		header.SetMode(os.ModeDir | 0o755)
		_, err := zw.CreateHeader(header)
		return err
	}
	header.SetMode(0o644)
	header.UncompressedSize64 = uint64(entry.Size)
	writer, err := zw.CreateHeader(header)
	if err != nil {
		return err
	}
	f, err := s.Store.Open(ctx, entry.StorageKey)
	if err != nil {
		return err
	}
	defer f.Close()
	source := io.Reader(f)
	if onProgress != nil {
		source = &archiveProgressReader{reader: f, onRead: onProgress}
	}
	written, err := io.Copy(writer, source)
	if err != nil {
		return err
	}
	if written != entry.Size {
		return fmt.Errorf("archive source size changed: got %s want %s", humanize.IBytes(uint64(max(int64(0), written))), humanize.IBytes(uint64(max(int64(0), entry.Size))))
	}
	return nil
}
