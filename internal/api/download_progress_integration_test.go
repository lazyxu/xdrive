package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type nativeDownloadTestTicket struct {
	URL        string `json:"url"`
	TransferID string `json:"transfer_id"`
}

type nativeDownloadTestProgress struct {
	TransferID string    `json:"transfer_id"`
	State      string    `json:"state"`
	BytesSent  int64     `json:"bytes_sent"`
	BytesTotal int64     `json:"bytes_total"`
	UpdatedAt  time.Time `json:"updated_at"`
	Error      string    `json:"error"`
}

func TestNativeDownloadProgressAcrossServersAndRetries(t *testing.T) {
	server, peer, owner, token, otherToken, node := newNativeDownloadProgressFixture(t)
	router, peerRouter := server.Router(), peer.Router()
	ticket := nativeProgressTicket(t, router, token, fmt.Sprintf("/api/v1/files/%d/download-ticket", node.ID))
	otherTicket := nativeProgressTicket(t, router, token, fmt.Sprintf("/api/v1/files/%d/download-ticket", node.ID))
	if ticket.TransferID == otherTicket.TransferID {
		t.Fatal("independent browser downloads share a transfer ID")
	}
	progressPath := "/api/v1/download/progress/" + ticket.TransferID
	request(t, router, http.MethodGet, progressPath, "", nil, http.StatusUnauthorized)
	request(t, router, http.MethodGet, progressPath, otherToken, nil, http.StatusNotFound)
	queued := nativeProgressSnapshot(t, peerRouter, token, ticket.TransferID)
	if queued.State != "queued" || queued.BytesSent != 0 || queued.BytesTotal != 10 {
		t.Fatalf("queued progress=%+v", queued)
	}
	request(t, peerRouter, http.MethodHead, ticket.URL, "", nil, http.StatusOK)
	requestWithHeaders(t, peerRouter, http.MethodGet, ticket.URL, "", nil, http.StatusNotModified, map[string]string{"If-None-Match": `"1"`})
	requestWithHeaders(t, peerRouter, http.MethodGet, ticket.URL, "", nil, http.StatusRequestedRangeNotSatisfiable, map[string]string{"Range": "bytes=30-40"})
	unchanged := nativeProgressSnapshot(t, router, token, ticket.TransferID)
	if unchanged.State != "queued" || unchanged.BytesSent != 0 {
		t.Fatalf("HEAD/conditional/error responses changed progress: %+v", unchanged)
	}
	response := requestWithHeaders(t, peerRouter, http.MethodGet, ticket.URL, "", nil, http.StatusPartialContent, map[string]string{"Range": "bytes=3-6"})
	if response.Body.String() != "3456" {
		t.Fatalf("range response=%q", response.Body.String())
	}
	partial := nativeProgressSnapshot(t, router, token, ticket.TransferID)
	if partial.State != "completed" || partial.BytesSent != 4 || partial.BytesTotal != 10 {
		t.Fatalf("range progress=%+v", partial)
	}
	request(t, peerRouter, http.MethodGet, ticket.URL, "", nil, http.StatusOK)
	retry := nativeProgressSnapshot(t, router, token, ticket.TransferID)
	if retry.State != "completed" || retry.BytesSent != 14 || retry.BytesTotal != 10 {
		t.Fatalf("retry response bytes were reset or clamped: %+v", retry)
	}
	if retry.UpdatedAt.IsZero() || retry.UpdatedAt.Before(queued.UpdatedAt) {
		t.Fatalf("missing progress sampling timestamp: %+v", retry)
	}
	untouched := nativeProgressSnapshot(t, peerRouter, token, otherTicket.TransferID)
	if untouched.State != "queued" || untouched.BytesSent != 0 {
		t.Fatalf("one ticket updated another: %+v", untouched)
	}
	if err := server.DB.Model(&meta.User{}).Where("id = ?", owner.ID).Update("session_version", 2).Error; err != nil {
		t.Fatal(err)
	}
	newToken, err := server.Auth.Issue(owner.ID, 2)
	if err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodGet, progressPath, newToken, nil, http.StatusNotFound)
	request(t, peerRouter, http.MethodGet, ticket.URL, "", nil, http.StatusUnauthorized)
}

func TestNativeVersionAndArchiveProgressCountsWireBytes(t *testing.T) {
	server, peer, owner, token, _, node := newNativeDownloadProgressFixture(t)
	router, peerRouter := server.Router(), peer.Router()
	version := meta.FileVersion{NodeID: node.ID, Revision: 1, Size: 10, StorageKey: "progress/data.txt", CreatedAt: time.Now().Add(-time.Hour)}
	if err := server.DB.Create(&version).Error; err != nil {
		t.Fatal(err)
	}
	ticket := nativeProgressTicket(t, router, token, fmt.Sprintf("/api/v1/files/%d/versions/%d/download-ticket", node.ID, version.ID))
	request(t, peerRouter, http.MethodGet, ticket.URL, "", nil, http.StatusOK)
	versionProgress := nativeProgressSnapshot(t, router, token, ticket.TransferID)
	if versionProgress.State != "completed" || versionProgress.BytesSent != 10 || versionProgress.BytesTotal != 10 {
		t.Fatalf("version progress=%+v", versionProgress)
	}
	manifest, err := json.Marshal(archivePreparedManifest{Filename: "data.zip", TotalBytes: 10, Entries: []archiveDownloadEntry{{Path: "data.txt", StorageKey: "progress/data.txt", Size: 10, UpdatedAt: time.Now()}}})
	if err != nil {
		t.Fatal(err)
	}
	run := meta.ArchivePrepareRun{ID: uuid.NewString(), OwnerID: owner.ID, RequestedIDsJSON: fmt.Sprintf("[%d]", node.ID), Status: meta.ArchivePrepareStatusCompleted, Filename: "data.zip", TotalBytes: 10, ManifestJSON: string(manifest), ExpiresAt: time.Now().Add(time.Hour)}
	if err := server.DB.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	archiveTicket := nativeProgressTicket(t, router, token, "/api/v1/download/archive/prepare/"+run.ID+"/download-ticket")
	if archiveTicket.TransferID == run.ID {
		t.Fatal("wire transfer identity must not overwrite archive prepare/child progress identity")
	}
	queued := nativeProgressSnapshot(t, peerRouter, token, archiveTicket.TransferID)
	if queued.BytesTotal != 0 {
		t.Fatalf("ZIP response length was guessed from source bytes: %+v", queued)
	}
	archive := request(t, peerRouter, http.MethodGet, archiveTicket.URL, "", nil, http.StatusOK)
	entries := readArchiveTestEntries(t, archive.Body.Bytes())
	if entries["data.txt"] != "0123456789" {
		t.Fatalf("ZIP payload changed: %v", entries)
	}
	progress := nativeProgressSnapshot(t, router, token, archiveTicket.TransferID)
	if progress.State != "completed" || progress.BytesSent != int64(archive.Body.Len()) || progress.BytesTotal != int64(archive.Body.Len()) || progress.BytesSent <= 10 {
		t.Fatalf("ZIP progress=%+v, actual response bytes=%d, logical bytes=10", progress, archive.Body.Len())
	}
}

func TestNativeDownloadMetricsFailureDoesNotBreakPayload(t *testing.T) {
	server, peer, _, token, _, node := newNativeDownloadProgressFixture(t)
	router, peerRouter := server.Router(), peer.Router()
	ticket := nativeProgressTicket(t, router, token, fmt.Sprintf("/api/v1/files/%d/download-ticket", node.ID))
	if err := server.DB.Exec("DROP TABLE xd_download_progress").Error; err != nil {
		t.Fatal(err)
	}
	response := request(t, peerRouter, http.MethodGet, ticket.URL, "", nil, http.StatusOK)
	if response.Body.String() != "0123456789" {
		t.Fatalf("metrics failure changed download payload: %q", response.Body.String())
	}
	// Ticket issuance must also remain available when the optional progress store fails.
	issued := request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/files/%d/download-ticket", node.ID), token, nil, http.StatusOK)
	var next nativeDownloadTestTicket
	if err := json.Unmarshal(issued.Body.Bytes(), &next); err != nil {
		t.Fatal(err)
	}
	request(t, peerRouter, http.MethodGet, next.URL, "", nil, http.StatusOK)
}

func TestNativeDownloadProgressReportsPartialNetworkFailure(t *testing.T) {
	server, peer, _, token, _, node := newNativeDownloadProgressFixture(t)
	router, peerRouter := server.Router(), peer.Router()
	ticket := nativeProgressTicket(t, router, token, fmt.Sprintf("/api/v1/files/%d/download-ticket", node.ID))
	response := &shortDownloadResponse{ResponseRecorder: httptest.NewRecorder(), limit: 3}
	peerRouter.ServeHTTP(response, httptest.NewRequest(http.MethodGet, ticket.URL, nil))
	progress := nativeProgressSnapshot(t, router, token, ticket.TransferID)
	if progress.State != "failed" || progress.BytesSent != 3 || progress.Error == "" {
		t.Fatalf("network failure was reported as file bytes read: %+v", progress)
	}
	request(t, peerRouter, http.MethodGet, ticket.URL, "", nil, http.StatusOK)
	retried := nativeProgressSnapshot(t, router, token, ticket.TransferID)
	if retried.State != "completed" || retried.BytesSent != 13 || retried.Error != "" {
		t.Fatalf("a successful retry kept the previous response failure: %+v", retried)
	}
}

func nativeProgressTicket(t *testing.T, router http.Handler, token, path string) nativeDownloadTestTicket {
	t.Helper()
	response := request(t, router, http.MethodPost, path, token, nil, http.StatusOK)
	var ticket nativeDownloadTestTicket
	if err := json.Unmarshal(response.Body.Bytes(), &ticket); err != nil {
		t.Fatal(err)
	}
	if ticket.TransferID == "" || ticket.URL == "" {
		t.Fatalf("native ticket is missing its transfer ID: %+v", ticket)
	}
	return ticket
}

func nativeProgressSnapshot(t *testing.T, router http.Handler, token, id string) nativeDownloadTestProgress {
	t.Helper()
	response := request(t, router, http.MethodGet, "/api/v1/download/progress/"+id, token, nil, http.StatusOK)
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("progress response may be cached: %v", response.Header())
	}
	var progress nativeDownloadTestProgress
	if err := json.Unmarshal(response.Body.Bytes(), &progress); err != nil {
		t.Fatal(err)
	}
	if progress.TransferID != id {
		t.Fatalf("progress identity=%q wanted %q", progress.TransferID, id)
	}
	return progress
}

func newNativeDownloadProgressFixture(t *testing.T) (*Server, *Server, meta.User, string, string, meta.Node) {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = baseSQL.Close() })
	schema := "native_progress_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error })
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.DownloadProgress{}, &meta.ArchivePrepareRun{}); err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put(t.Context(), "progress/data.txt", bytes.NewBufferString("0123456789")); err != nil {
		t.Fatal(err)
	}
	manager := auth.New("native-download-progress-secret", time.Hour)
	server := &Server{DB: db, Store: store, Auth: manager}
	peer := &Server{DB: db, Store: store, Auth: manager}
	owner := meta.User{Username: "native-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	other := meta.User{Username: "native-other", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	token, err := manager.Issue(owner.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	otherToken, err := manager.Issue(other.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	node := meta.Node{Name: "data.txt", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.File{NodeID: node.ID, Size: 10, StorageKey: "progress/data.txt"}).Error; err != nil {
		t.Fatal(err)
	}
	return server, peer, owner, token, otherToken, node
}
