package api

// Administrator-only transport for five-component offline update candidates.
// The Go API cannot execute Docker. It writes only fixed release filenames to
// a deployment-owned mount; the Host must independently authenticate a signed
// manifest and the exact Go executable before installing anything.
import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"sort"
	"time"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	offlineImportChunkBytes = 8 << 20
	offlineImportFileMax    = int64(8) << 30
	offlineImportGoMax      = int64(32) << 20
	offlineImportMetaMax    = int64(8) << 20
	offlineImportTotalMax   = int64(48) << 30
	offlineImportMinFree    = uint64(512) << 20
	offlineImportMaxFiles   = 20
)

var (
	offlineImportIDPattern   = regexp.MustCompile("^[0-9a-f]{32}$")
	offlineImportSHA256      = regexp.MustCompile("^[0-9a-f]{64}$")
	offlineImportPackageName = regexp.MustCompile("^xdrive-(app|postgres|media-worker|ai-runtime|ai-models)-[0-9a-f]{12}\\.tar\\.gz$")
)

type offlineImportFileMetadata struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type offlineImportFileStatus struct {
	Name          string `json:"name"`
	State         string `json:"state"`
	Size          int64  `json:"size"`
	UploadedBytes int64  `json:"uploaded_bytes"`
	UploadSHA256  string `json:"upload_sha256,omitempty"` // transport digest, NOT publisher trust
}

type offlineImportStatus struct {
	ID            string                    `json:"id"`
	Files         []offlineImportFileStatus `json:"files"`
	ChunkBytes    int                       `json:"chunk_bytes"`
	ReadyToVerify bool                      `json:"ready_to_verify"`
}

func offlineImportAllowedFile(name string) bool {
	switch name {
	case "manifest.json", "xdrive-offline-linux-amd64",
		"delivery.json", "delivery-attestation.jsonl":
		return true
	default:
		return offlineImportPackageName.MatchString(name)
	}
}

func offlineImportSizeLimit(name string) int64 {
	switch name {
	case "manifest.json", "delivery.json", "delivery-attestation.jsonl":
		return offlineImportMetaMax
	case "xdrive-offline-linux-amd64":
		return offlineImportGoMax
	default:
		return offlineImportFileMax
	}
}

func (s *Server) offlineUpdateImportRoot() (*os.Root, error) {
	dir := strings.TrimSpace(s.OfflineUpdateImportDir)
	if !filepath.IsAbs(dir) || dir == "" {
		return nil, errors.New("offline import mount not configured")
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("offline import mount must be a real directory")
	}
	return os.OpenRoot(dir)
}

func openOfflineImport(root *os.Root, id string) (*os.Root, error) {
	if !offlineImportIDPattern.MatchString(id) {
		return nil, errors.New("invalid offline import ID")
	}
	info, err := root.Lstat(id)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("unsafe offline import directory")
	}
	return root.OpenRoot(id)
}

func offlineImportBusy(s *Server) bool {
	state := s.serverUpdateStatus()
	return state.State == "queued" || state.State == "running"
}

func offlineImportError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, os.ErrNotExist):
		c.JSON(http.StatusNotFound, gin.H{"error": "offline_import_not_found"})
	case errors.Is(err, os.ErrExist):
		c.JSON(http.StatusConflict, gin.H{"error": "offline_import_conflict"})
	default:
		// Host paths and OS diagnostics must never be sent to a browser.
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "offline_import_unavailable"})
	}
}

func (s *Server) adminCreateOfflineUpdateImport(c *gin.Context) {
	s.offlineUpdateImportMu.Lock()
	defer s.offlineUpdateImportMu.Unlock()
	if offlineImportBusy(s) {
		c.JSON(http.StatusConflict, gin.H{"error": "update_in_progress"})
		return
	}
	root, err := s.offlineUpdateImportRoot()
	if err != nil {
		offlineImportError(c, err)
		return
	}
	defer root.Close()
	entries, err := root.ReadDir(".")
	if err != nil {
		offlineImportError(c, err)
		return
	}
	active := 0
	for _, entry := range entries {
		if offlineImportIDPattern.MatchString(entry.Name()) {
			active++
		}
	}
	if active >= 24 {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "too_many_offline_imports"})
		return
	}
	var id string
	for attempts := 0; attempts < 4; attempts++ {
		var random [16]byte
		if _, err = rand.Read(random[:]); err != nil {
			break
		}
		id = hex.EncodeToString(random[:])
		err = root.Mkdir(id, 0o770)
		if err == nil {
			c.Header("Cache-Control", "no-store")
			c.JSON(http.StatusCreated, gin.H{"id": id, "chunk_bytes": offlineImportChunkBytes})
			return
		}
		if !errors.Is(err, os.ErrExist) {
			break
		}
	}
	offlineImportError(c, err)
}

func offlineImportReadMeta(root *os.Root, name string) (offlineImportFileMetadata, error) {
	var meta offlineImportFileMetadata
	info, err := root.Lstat(name + ".upload.json")
	if err != nil {
		return meta, err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > 1024 {
		return meta, errors.New("invalid upload metadata size")
	}
	f, err := root.Open(name + ".upload.json")
	if err != nil {
		return meta, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 1025))
	if err != nil {
		return meta, err
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		return meta, err
	}
	if meta.Name != name || !offlineImportAllowedFile(name) ||
		meta.Size <= 0 || meta.Size > offlineImportSizeLimit(name) ||
		(meta.SHA256 != "" && !offlineImportSHA256.MatchString(meta.SHA256)) {
		return meta, errors.New("invalid upload metadata")
	}
	return meta, nil
}

func offlineImportStatusFor(root *os.Root, id string) (offlineImportStatus, error) {
	status := offlineImportStatus{
		ID: id, ChunkBytes: offlineImportChunkBytes,
		Files: make([]offlineImportFileStatus, 0),
	}
	entries, err := root.ReadDir(".")
	if err != nil {
		return status, err
	}
	if len(entries) > offlineImportMaxFiles*3 {
		return status, errors.New("excessive offline import members")
	}
	done := make(map[string]bool)
	for _, entry := range entries {
		name := entry.Name()
		if !offlineImportAllowedFile(name) {
			continue
		}
		info, err := root.Lstat(name)
		if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 ||
			info.Size() > offlineImportSizeLimit(name) {
			continue
		}
		status.Files = append(status.Files, offlineImportFileStatus{
			Name: name, State: "ready", Size: info.Size(), UploadedBytes: info.Size(),
		})
		done[name] = true
		if name == "manifest.json" {
			status.ReadyToVerify = true
		}
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".upload.json") {
			continue
		}
		name := strings.TrimSuffix(entry.Name(), ".upload.json")
		if !offlineImportAllowedFile(name) || done[name] {
			continue
		}
		meta, err := offlineImportReadMeta(root, name)
		if err != nil {
			continue
		}
		var uploaded int64
		if info, err := root.Lstat(name + ".part"); err == nil && info.Mode().IsRegular() {
			uploaded = info.Size()
		}
		if uploaded > meta.Size {
			return status, errors.New("invalid offline import partial size")
		}
		status.Files = append(status.Files, offlineImportFileStatus{
			Name: name, State: "uploading", Size: meta.Size,
			UploadedBytes: uploaded, UploadSHA256: meta.SHA256,
		})
	}
	// This is only a transport inventory. A ready Manifest is NOT trusted
	// until the Host verifies its independent publisher proof and all packages.
	status.ReadyToVerify = status.ReadyToVerify && done["xdrive-offline-linux-amd64"]
	return status, nil
}

func (s *Server) adminGetOfflineUpdateImport(c *gin.Context) {
	root, err := s.offlineUpdateImportRoot()
	if err != nil {
		offlineImportError(c, err)
		return
	}
	defer root.Close()
	session, err := openOfflineImport(root, c.Param("id"))
	if err != nil {
		offlineImportError(c, err)
		return
	}
	defer session.Close()
	status, err := offlineImportStatusFor(session, c.Param("id"))
	if err != nil {
		offlineImportError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, status)
}

func offlineImportExistingBytes(root *os.Root) (int64, error) {
	entries, err := root.ReadDir(".")
	if err != nil {
		return 0, err
	}
	if len(entries) > offlineImportMaxFiles*3 {
		return 0, errors.New("excessive import members")
	}
	known := make(map[string]int64)
	for _, entry := range entries {
		name := entry.Name()
		if offlineImportAllowedFile(name) {
			if info, err := root.Lstat(name); err == nil && info.Mode().IsRegular() {
				known[name] = info.Size()
			}
		} else if strings.HasSuffix(name, ".upload.json") {
			basename := strings.TrimSuffix(name, ".upload.json")
			if offlineImportAllowedFile(basename) {
				meta, err := offlineImportReadMeta(root, basename)
				if err != nil {
					return 0, err
				}
				if known[basename] < meta.Size {
					known[basename] = meta.Size
				}
			}
		}
	}
	if len(known) > offlineImportMaxFiles {
		return 0, errors.New("too many import files")
	}
	var total int64
	for _, size := range known {
		if size < 0 || total > offlineImportTotalMax-size {
			return 0, errors.New("offline import exceeds capacity limit")
		}
		total += size
	}
	return total, nil
}

func (s *Server) adminRegisterOfflineUpdateFile(c *gin.Context) {
	s.offlineUpdateImportMu.Lock()
	defer s.offlineUpdateImportMu.Unlock()
	name := c.Param("name")
	if !offlineImportAllowedFile(name) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_offline_filename"})
		return
	}
	var input offlineImportFileMetadata
	if err := c.ShouldBindJSON(&input); err != nil || input.Name != name ||
		input.Size <= 0 || input.Size > offlineImportSizeLimit(name) ||
		(input.SHA256 != "" && !offlineImportSHA256.MatchString(input.SHA256)) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_offline_upload_metadata"})
		return
	}
	if offlineImportBusy(s) {
		c.JSON(http.StatusConflict, gin.H{"error": "update_in_progress"})
		return
	}
	root, err := s.offlineUpdateImportRoot()
	if err != nil {
		offlineImportError(c, err)
		return
	}
	defer root.Close()
	session, err := openOfflineImport(root, c.Param("id"))
	if err != nil {
		offlineImportError(c, err)
		return
	}
	defer session.Close()
	if _, err := session.Lstat(name); err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "offline_file_already_ready"})
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		offlineImportError(c, err)
		return
	}
	if existing, err := offlineImportReadMeta(session, name); err == nil {
		if existing != input {
			c.JSON(http.StatusConflict, gin.H{"error": "offline_upload_identity_mismatch"})
			return
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		offlineImportError(c, err)
		return
	} else {
		used, err := offlineImportExistingBytes(session)
		if err != nil || used > offlineImportTotalMax-input.Size {
			c.JSON(http.StatusInsufficientStorage, gin.H{"error": "offline_import_capacity_exceeded"})
			return
		}
		f, err := session.OpenFile(name+".upload.json", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o660)
		if err != nil {
			offlineImportError(c, err)
			return
		}
		raw, _ := json.Marshal(input)
		_, writeErr := f.Write(append(raw, '
'))
		if writeErr == nil {
			writeErr = f.Sync()
		}
		closeErr := f.Close()
		if writeErr != nil || closeErr != nil {
			_ = session.Remove(name + ".upload.json")
			c.JSON(http.StatusInsufficientStorage, gin.H{"error": "offline_import_write_failed"})
			return
		}
	}
	if partInfo, lookupErr := session.Lstat(name + ".part"); lookupErr == nil {
		if !partInfo.Mode().IsRegular() {
			c.JSON(http.StatusConflict, gin.H{"error": "offline_partial_file_invalid"})
			return
		}
	} else if !errors.Is(lookupErr, os.ErrNotExist) {
		offlineImportError(c, lookupErr)
		return
	}
	part, err := session.OpenFile(name+".part", os.O_WRONLY|os.O_CREATE, 0o660)
	if err != nil {
		offlineImportError(c, err)
		return
	}
	_ = part.Close()
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"name": name, "size": input.Size, "chunk_bytes": offlineImportChunkBytes})
}

func (s *Server) adminUploadOfflineUpdateChunk(c *gin.Context) {
	s.offlineUpdateImportMu.Lock()
	defer s.offlineUpdateImportMu.Unlock()
	name := c.Param("name")
	index, err := strconv.ParseUint(c.Param("index"), 10, 32)
	if !offlineImportAllowedFile(name) || err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_offline_chunk_target"})
		return
	}
	if offlineImportBusy(s) {
		c.JSON(http.StatusConflict, gin.H{"error": "update_in_progress"})
		return
	}
	root, err := s.offlineUpdateImportRoot()
	if err != nil {
		offlineImportError(c, err)
		return
	}
	defer root.Close()
	session, err := openOfflineImport(root, c.Param("id"))
	if err != nil {
		offlineImportError(c, err)
		return
	}
	defer session.Close()
	meta, err := offlineImportReadMeta(session, name)
	if err != nil {
		offlineImportError(c, err)
		return
	}
	offset := int64(index) * offlineImportChunkBytes
	if offset < 0 || offset >= meta.Size {
		c.JSON(http.StatusBadRequest, gin.H{"error": "offline_chunk_index_out_of_range"})
		return
	}
	needed := meta.Size - offset
	if needed > offlineImportChunkBytes {
		needed = offlineImportChunkBytes
	}
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, offlineImportChunkBytes+1))
	if err != nil || int64(len(body)) != needed {
		c.JSON(http.StatusBadRequest, gin.H{"error": "offline_chunk_wrong_size"})
		return
	}
	digest := sha256.Sum256(body)
	if hex.EncodeToString(digest[:]) != c.GetHeader("X-XDrive-Chunk-SHA256") {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "offline_chunk_hash_mismatch"})
		return
	}
	if _, err := session.Lstat(name); err == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "offline_file_already_ready"})
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		offlineImportError(c, err)
		return
	}
	partInfo, err := session.Lstat(name + ".part")
	if err != nil || !partInfo.Mode().IsRegular() {
		c.JSON(http.StatusConflict, gin.H{"error": "offline_partial_file_invalid"})
		return
	}
	part, err := session.OpenFile(name+".part", os.O_RDWR, 0)
	if err != nil {
		offlineImportError(c, err)
		return
	}
	defer part.Close()
	info, err := part.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > meta.Size {
		c.JSON(http.StatusConflict, gin.H{"error": "offline_partial_file_invalid"})
		return
	}
	if info.Size() >= offset+needed {
		existing := make([]byte, needed)
		if _, err := part.ReadAt(existing, offset); err != nil || !equalOfflineChunk(existing, body) {
			c.JSON(http.StatusConflict, gin.H{"error": "offline_chunk_retry_different_bytes"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"uploaded_bytes": info.Size(), "already_received": true})
		return
	}
	// Resume a crash-interrupted partially written chunk by truncating to its
	// start. Earlier acknowledged chunks are immutable, and later positions
	// cannot be written out of order to create sparse executable files.
	if info.Size() < offset || info.Size() >= offset+needed && info.Size() != offset {
		c.JSON(http.StatusConflict, gin.H{"error": "offline_chunk_out_of_order", "uploaded_bytes": info.Size()})
		return
	}
	if available, err := offlineUpdateImportFreeBytes(s.OfflineUpdateImportDir); err != nil ||
		available < uint64(needed)+offlineImportMinFree {
		c.JSON(http.StatusInsufficientStorage, gin.H{"error": "offline_import_insufficient_disk"})
		return
	}
	if err := part.Truncate(offset); err != nil {
		c.JSON(http.StatusInsufficientStorage, gin.H{"error": "offline_import_write_failed"})
		return
	}
	if _, err := part.WriteAt(body, offset); err != nil {
		_ = part.Truncate(offset)
		c.JSON(http.StatusInsufficientStorage, gin.H{"error": "offline_import_write_failed"})
		return
	}
	if err := part.Sync(); err != nil {
		_ = part.Truncate(offset)
		c.JSON(http.StatusInsufficientStorage, gin.H{"error": "offline_import_write_failed"})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"uploaded_bytes": offset + needed, "already_received": false})
}

func equalOfflineChunk(a, b []byte) bool {
	return len(a) == len(b) && sha256.Sum256(a) == sha256.Sum256(b)
}

func offlineImportDigest(root *os.Root, name string, size int64) (string, error) {
	f, err := root.Open(name)
	if err != nil {
		return "", err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() != size {
		return "", errors.New("offline file size changed")
	}
	hasher := sha256.New()
	if _, err := io.CopyN(hasher, f, size); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func (s *Server) adminFinalizeOfflineUpdateFile(c *gin.Context) {
	s.offlineUpdateImportMu.Lock()
	defer s.offlineUpdateImportMu.Unlock()
	name := c.Param("name")
	if !offlineImportAllowedFile(name) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_offline_filename"})
		return
	}
	if offlineImportBusy(s) {
		c.JSON(http.StatusConflict, gin.H{"error": "update_in_progress"})
		return
	}
	root, err := s.offlineUpdateImportRoot()
	if err != nil {
		offlineImportError(c, err)
		return
	}
	defer root.Close()
	session, err := openOfflineImport(root, c.Param("id"))
	if err != nil {
		offlineImportError(c, err)
		return
	}
	defer session.Close()
	meta, err := offlineImportReadMeta(session, name)
	if err != nil {
		offlineImportError(c, err)
		return
	}
	if existing, err := session.Lstat(name); err == nil && existing.Mode().IsRegular() {
		digest, err := offlineImportDigest(session, name, meta.Size)
		if err == nil && (meta.SHA256 == "" || digest == meta.SHA256) {
			c.JSON(http.StatusOK, gin.H{"name": name, "state": "ready", "upload_sha256": digest})
			return
		}
		c.JSON(http.StatusConflict, gin.H{"error": "offline_final_file_identity_mismatch"})
		return
	}
	partInfo, err := session.Lstat(name + ".part")
	if err != nil || !partInfo.Mode().IsRegular() {
		c.JSON(http.StatusConflict, gin.H{"error": "offline_partial_file_invalid"})
		return
	}
	digest, err := offlineImportDigest(session, name+".part", meta.Size)
	if err != nil || (meta.SHA256 != "" && digest != meta.SHA256) {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "offline_upload_sha256_mismatch"})
		return
	}
	// Link is an atomic no-overwrite commit. A Host-preplaced file is never
	// overwritten by a browser upload even if it appears during finalization.
	if err := session.Link(name+".part", name); err != nil {
		offlineImportError(c, err)
		return
	}
	if err := session.Remove(name + ".part"); err != nil {
		// The canonical file is already present and fully verified; leave a
		// harmless partial hardlink for the next host maintenance cleanup.
		c.JSON(http.StatusOK, gin.H{"name": name, "state": "ready", "upload_sha256": digest})
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"name": name, "state": "ready", "upload_sha256": digest})
}


// A persistent catalog makes a created Host import recoverable after a browser
// refresh. No host filesystem path is accepted or disclosed by this endpoint.
func (s *Server) adminListOfflineUpdateImports(c *gin.Context) {
	root, err := s.offlineUpdateImportRoot()
	if err != nil {
		offlineImportError(c, err)
		return
	}
	defer root.Close()
	entries, err := root.ReadDir(".")
	if err != nil {
		offlineImportError(c, err)
		return
	}
	type item struct {
		ID         string    `json:"id"`
		ModifiedAt time.Time `json:"modified_at"`
	}
	items := make([]item, 0)
	for _, entry := range entries {
		if !offlineImportIDPattern.MatchString(entry.Name()) {
			continue
		}
		info, err := root.Lstat(entry.Name())
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			continue
		}
		items = append(items, item{ID: entry.Name(), ModifiedAt: info.ModTime().UTC()})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].ModifiedAt.After(items[j].ModifiedAt)
	})
	if len(items) > 24 {
		items = items[:24]
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"items": items})
}

// Deletion is deliberately limited to a known staging namespace. Unknown
// host-preplaced paths and nested directories are never recursively removed.
func (s *Server) adminDeleteOfflineUpdateImport(c *gin.Context) {
	s.offlineUpdateImportMu.Lock()
	defer s.offlineUpdateImportMu.Unlock()
	if offlineImportBusy(s) {
		c.JSON(http.StatusConflict, gin.H{"error": "update_in_progress"})
		return
	}
	root, err := s.offlineUpdateImportRoot()
	if err != nil {
		offlineImportError(c, err)
		return
	}
	defer root.Close()
	id := c.Param("id")
	session, err := openOfflineImport(root, id)
	if err != nil {
		offlineImportError(c, err)
		return
	}
	entries, err := session.ReadDir(".")
	_ = session.Close()
	if err != nil {
		offlineImportError(c, err)
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		base := strings.TrimSuffix(strings.TrimSuffix(name, ".upload.json"), ".part")
		if !offlineImportAllowedFile(base) || entry.IsDir() {
			c.JSON(http.StatusConflict, gin.H{"error": "offline_import_contains_unmanaged_data"})
			return
		}
	}
	// Root.Remove is path-contained, and refuses a directory with unexpected
	// children. A failed partial cleanup is safe to retry.
	for _, entry := range entries {
		if err := root.Remove(id + "/" + entry.Name()); err != nil {
			offlineImportError(c, err)
			return
		}
	}
	if err := root.Remove(id); err != nil {
		offlineImportError(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Status(http.StatusNoContent)
}
