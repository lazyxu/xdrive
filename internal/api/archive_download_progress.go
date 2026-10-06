package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const archiveDownloadProgressTTL = 30 * time.Minute

var (
	errArchiveProgressNotFound = errors.New("archive progress ticket not found")
	errArchiveProgressMismatch = errors.New("archive manifest changed after prepare")
)

type archiveDownloadPrepareFile struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

type archiveDownloadPrepareResponse struct {
	TransferID string                       `json:"transfer_id"`
	Filename   string                       `json:"filename"`
	TotalBytes int64                        `json:"total_bytes"`
	Files      []archiveDownloadPrepareFile `json:"files"`
}

type archiveDownloadProgressFile struct {
	Path  string `json:"path"`
	Size  int64  `json:"size"`
	Done  int64  `json:"done"`
	State string `json:"state"`
	Error string `json:"error,omitempty"`
}

type archiveDownloadProgressResponse struct {
	TransferID     string                        `json:"transfer_id"`
	State          string                        `json:"state"`
	Error          string                        `json:"error,omitempty"`
	BytesDone      int64                         `json:"bytes_done"`
	BytesTotal     int64                         `json:"bytes_total"`
	ItemsTotal     int                           `json:"items_total"`
	ItemsCompleted int                           `json:"items_completed"`
	ItemsFailed    int                           `json:"items_failed"`
	ItemsRunning   int                           `json:"items_running"`
	ItemsQueued    int                           `json:"items_queued"`
	Files          []archiveDownloadProgressFile `json:"files"`
}

type archiveDownloadProgressState struct {
	OwnerID  uint64
	IDs      []uint64
	Filename string
	State    string
	Error    string
	Files    []archiveDownloadProgressFile
	index    map[string]int
	Updated  time.Time
}

func archiveDownloadManifestFiles(manifest archiveDownloadManifest) []archiveDownloadPrepareFile {
	files := make([]archiveDownloadPrepareFile, 0, len(manifest.Entries))
	for _, entry := range manifest.Entries {
		if entry.IsDir {
			continue
		}
		files = append(files, archiveDownloadPrepareFile{Path: entry.Path, Size: max(int64(0), entry.Size)})
	}
	return files
}

func normalizedArchiveProgressIDs(ids []uint64) []uint64 {
	out := append([]uint64(nil), ids...)
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

func sameArchiveProgressIDs(left, right []uint64) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func sameArchivePreparedFiles(left []archiveDownloadProgressFile, right []archiveDownloadPrepareFile) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index].Path != right[index].Path || left[index].Size != right[index].Size {
			return false
		}
	}
	return true
}

func (s *Server) cleanupArchiveDownloadProgressLocked(now time.Time) {
	for id, state := range s.archiveProgress {
		if now.Sub(state.Updated) > archiveDownloadProgressTTL {
			delete(s.archiveProgress, id)
		}
	}
}

func (s *Server) prepareArchiveDownloadProgress(ownerID uint64, ids []uint64, manifest archiveDownloadManifest) archiveDownloadPrepareResponse {
	now := time.Now()
	files := archiveDownloadManifestFiles(manifest)
	transferID := uuid.NewString()
	progressFiles := make([]archiveDownloadProgressFile, 0, len(files))
	index := make(map[string]int, len(files))
	for position, file := range files {
		progressFiles = append(progressFiles, archiveDownloadProgressFile{Path: file.Path, Size: file.Size, State: "queued"})
		index[file.Path] = position
	}

	s.archiveProgressMu.Lock()
	defer s.archiveProgressMu.Unlock()
	if s.archiveProgress == nil {
		s.archiveProgress = make(map[string]*archiveDownloadProgressState)
	}
	s.cleanupArchiveDownloadProgressLocked(now)
	s.archiveProgress[transferID] = &archiveDownloadProgressState{
		OwnerID:  ownerID,
		IDs:      normalizedArchiveProgressIDs(ids),
		Filename: archiveDownloadFilename(manifest.Roots),
		State:    "queued",
		Files:    progressFiles,
		index:    index,
		Updated:  now,
	}
	return archiveDownloadPrepareResponse{
		TransferID: transferID,
		Filename:   archiveDownloadFilename(manifest.Roots),
		TotalBytes: manifest.TotalBytes,
		Files:      files,
	}
}

func (s *Server) beginArchiveDownloadProgress(ownerID uint64, transferID string, ids []uint64, manifest archiveDownloadManifest) error {
	s.archiveProgressMu.Lock()
	defer s.archiveProgressMu.Unlock()
	if s.archiveProgress == nil {
		return errArchiveProgressNotFound
	}
	now := time.Now()
	s.cleanupArchiveDownloadProgressLocked(now)
	state := s.archiveProgress[transferID]
	if state == nil || state.OwnerID != ownerID {
		return errArchiveProgressNotFound
	}
	if !sameArchiveProgressIDs(state.IDs, normalizedArchiveProgressIDs(ids)) || !sameArchivePreparedFiles(state.Files, archiveDownloadManifestFiles(manifest)) {
		return errArchiveProgressMismatch
	}
	state.State = "running"
	state.Error = ""
	state.Updated = now
	return nil
}

func (s *Server) updateArchiveDownloadProgress(transferID, path, stateName string, done int64, err error) {
	if strings.TrimSpace(transferID) == "" {
		return
	}
	s.archiveProgressMu.Lock()
	defer s.archiveProgressMu.Unlock()
	state := s.archiveProgress[transferID]
	if state == nil {
		return
	}
	index, ok := state.index[path]
	if !ok {
		return
	}
	file := &state.Files[index]
	file.Done = min(max(int64(0), done), max(int64(0), file.Size))
	file.State = stateName
	if err != nil {
		file.Error = err.Error()
	}
	state.Updated = time.Now()
}

func (s *Server) finishArchiveDownloadProgress(transferID, stateName string, err error) {
	if strings.TrimSpace(transferID) == "" {
		return
	}
	s.archiveProgressMu.Lock()
	defer s.archiveProgressMu.Unlock()
	state := s.archiveProgress[transferID]
	if state == nil {
		return
	}
	state.State = stateName
	if err != nil {
		state.Error = err.Error()
	}
	if stateName == "failed" || stateName == "cancelled" {
		for index := range state.Files {
			if state.Files[index].State == "queued" || state.Files[index].State == "transferring" {
				state.Files[index].State = "cancelled"
			}
		}
	}
	state.Updated = time.Now()
}

func (s *Server) archiveDownloadProgressSnapshot(ownerID uint64, transferID string) (archiveDownloadProgressResponse, error) {
	s.archiveProgressMu.Lock()
	defer s.archiveProgressMu.Unlock()
	if s.archiveProgress == nil {
		return archiveDownloadProgressResponse{}, errArchiveProgressNotFound
	}
	now := time.Now()
	s.cleanupArchiveDownloadProgressLocked(now)
	state := s.archiveProgress[transferID]
	if state == nil || state.OwnerID != ownerID {
		return archiveDownloadProgressResponse{}, errArchiveProgressNotFound
	}
	response := archiveDownloadProgressResponse{
		TransferID: transferID,
		State:      state.State,
		Error:      state.Error,
		Files:      append([]archiveDownloadProgressFile(nil), state.Files...),
	}
	for _, file := range response.Files {
		response.BytesTotal += max(int64(0), file.Size)
		response.BytesDone += min(max(int64(0), file.Done), max(int64(0), file.Size))
		switch file.State {
		case "completed":
			response.ItemsCompleted++
		case "failed":
			response.ItemsFailed++
		case "transferring":
			response.ItemsRunning++
		default:
			response.ItemsQueued++
		}
	}
	response.ItemsTotal = len(response.Files)
	return response, nil
}

func (s *Server) prepareArchiveDownload(c *gin.Context) {
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
	response := s.prepareArchiveDownloadProgress(userID(c), ids, manifest)
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, response)
}

func (s *Server) getArchiveDownloadProgress(c *gin.Context) {
	transferID := strings.TrimSpace(c.Param("id"))
	if transferID == "" {
		fail(c, http.StatusBadRequest, "invalid transfer id")
		return
	}
	snapshot, err := s.archiveDownloadProgressSnapshot(userID(c), transferID)
	if err != nil {
		fail(c, http.StatusNotFound, "archive transfer not found")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, snapshot)
}

type archiveProgressReader struct {
	reader io.Reader
	onRead func(int64)
}

func (r *archiveProgressReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if n > 0 && r.onRead != nil {
		r.onRead(int64(n))
	}
	return n, err
}

func archiveProgressContextState(ctx context.Context) string {
	if ctx.Err() != nil {
		return "cancelled"
	}
	return "failed"
}
