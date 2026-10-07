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
	Path       string    `json:"path"`
	IsDir      bool      `json:"is_dir,omitempty"`
	StorageKey string    `json:"storage_key,omitempty"`
	Size       int64     `json:"size,omitempty"`
	UpdatedAt  time.Time `json:"updated_at"`
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

	transferID := strings.TrimSpace(req.TransferID)
	var manifest archiveDownloadManifest
	filename := ""
	loadedPrepared := false
	if transferID != "" {
		preparedManifest, preparedFilename, found, err := s.loadArchivePreparedManifest(
			c.Request.Context(),
			userID(c),
			transferID,
			ids,
		)
		if err != nil {
			switch {
			case errors.Is(err, errArchiveProgressMismatch),
				errors.Is(err, errArchivePrepareUnavailable),
				errors.Is(err, errArchivePrepareExpired):
				fail(c, http.StatusConflict, err.Error())
			default:
				fail(c, http.StatusInternalServerError, "load prepared archive failed")
			}
			return
		}
		if found {
			manifest = preparedManifest
			filename = preparedFilename
			loadedPrepared = true
		}
	}
	if !loadedPrepared {
		var err error
		manifest, err = s.buildArchiveDownloadManifest(c.Request.Context(), userID(c), ids)
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
		filename = archiveDownloadFilename(manifest.Roots)
	}

	if transferID != "" {
		if loadedPrepared {
			if err := s.seedArchiveDownloadProgress(
				userID(c),
				transferID,
				ids,
				filename,
				manifest,
			); err != nil {
				if errors.Is(err, errArchiveProgressMismatch) {
					fail(c, http.StatusConflict, err.Error())
					return
				}
				transferID = ""
			}
		}
		if transferID != "" {
			if err := s.beginArchiveDownloadProgress(userID(c), transferID, ids, manifest); err != nil {
				switch {
				case errors.Is(err, errArchiveProgressNotFound):
					// Legacy/process-local tickets remain optional. The durable prepared
					// manifest above is the data-plane authority when one exists.
					transferID = ""
				case errors.Is(err, errArchiveProgressMismatch):
					fail(c, http.StatusConflict, err.Error())
					return
				default:
					fail(c, http.StatusInternalServerError, "start archive progress failed")
					return
				}
			}
		}
	}

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
		var childrenByParent map[uint64][]meta.Node
		if root.Type == meta.NodeTypeDir {
			childrenByParent, err = loadArchiveDownloadSubtree(ctx, s.DB, uid, root.ID)
			if err != nil {
				return archiveDownloadManifest{}, err
			}
		}
		if err := s.appendArchiveDownloadNode(ctx, root, rootName, &manifest, visited, childrenByParent); err != nil {
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

type archiveDownloadSubtreeRow struct {
	ID             uint64    `gorm:"column:id"`
	ParentID       *uint64   `gorm:"column:parent_id"`
	Name           string    `gorm:"column:name"`
	Type           string    `gorm:"column:type"`
	Revision       uint64    `gorm:"column:revision"`
	CreatedAt      time.Time `gorm:"column:created_at"`
	UpdatedAt      time.Time `gorm:"column:updated_at"`
	Cycle          bool      `gorm:"column:cycle"`
	FileNodeID     uint64    `gorm:"column:file_node_id"`
	FileSize       int64     `gorm:"column:file_size"`
	FileStorageKey string    `gorm:"column:file_storage_key"`
	FileSHA256     string    `gorm:"column:file_sha256"`
}

func loadArchiveDownloadSubtree(
	ctx context.Context,
	db *gorm.DB,
	uid uint64,
	rootID uint64,
) (map[uint64][]meta.Node, error) {
	var rows []archiveDownloadSubtreeRow
	err := db.WithContext(ctx).Raw(`WITH RECURSIVE tree AS (
SELECT n.id, n.parent_id, n.name, n.type, n.revision, n.created_at, n.updated_at,
       ARRAY[CAST(? AS bigint), n.id]::bigint[] AS path_ids,
       false AS cycle
FROM xd_nodes AS n
WHERE n.owner_id = ? AND n.parent_id = ? AND n.deleted_at IS NULL
UNION ALL
SELECT n.id, n.parent_id, n.name, n.type, n.revision, n.created_at, n.updated_at,
       tree.path_ids || n.id,
       n.id = ANY(tree.path_ids) AS cycle
FROM xd_nodes AS n
JOIN tree ON n.parent_id = tree.id
WHERE n.owner_id = ? AND n.deleted_at IS NULL AND NOT tree.cycle
)
SELECT tree.id, tree.parent_id, tree.name, tree.type, tree.revision,
       tree.created_at, tree.updated_at, tree.cycle,
       COALESCE(f.node_id, 0) AS file_node_id,
       COALESCE(f.size, 0) AS file_size,
       COALESCE(f.storage_key, '') AS file_storage_key,
       COALESCE(f.sha256, '') AS file_sha256
FROM tree
LEFT JOIN xd_files AS f ON f.node_id = tree.id
ORDER BY tree.parent_id ASC NULLS FIRST, lower(tree.name) ASC, tree.id ASC
LIMIT ?`, rootID, uid, rootID, uid, archiveDownloadMaxEntries).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	if len(rows) >= archiveDownloadMaxEntries {
		return nil, errArchiveTooManyEntries
	}

	childrenByParent := make(map[uint64][]meta.Node)
	for _, row := range rows {
		if row.Cycle || row.ParentID == nil {
			return nil, errArchiveInvalidStoredEntry
		}
		node := meta.Node{
			ID:        row.ID,
			ParentID:  row.ParentID,
			Name:      row.Name,
			Type:      row.Type,
			OwnerID:   uid,
			Revision:  row.Revision,
			CreatedAt: row.CreatedAt,
			UpdatedAt: row.UpdatedAt,
		}
		if row.FileNodeID != 0 {
			node.File = &meta.File{
				NodeID:     row.FileNodeID,
				Size:       row.FileSize,
				StorageKey: row.FileStorageKey,
				SHA256:     row.FileSHA256,
			}
		}
		childrenByParent[*row.ParentID] = append(childrenByParent[*row.ParentID], node)
	}
	return childrenByParent, nil
}

func (s *Server) appendArchiveDownloadNode(
	ctx context.Context,
	node meta.Node,
	archivePath string,
	manifest *archiveDownloadManifest,
	visited map[uint64]struct{},
	childrenByParent map[uint64][]meta.Node,
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
		for _, child := range childrenByParent[node.ID] {
			segment, err := archivePathSegment(child.Name)
			if err != nil {
				return err
			}
			if err := s.appendArchiveDownloadNode(
				ctx,
				child,
				pathpkg.Join(archivePath, segment),
				manifest,
				visited,
				childrenByParent,
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
