package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// End-to-end capability test: public recipients cannot borrow the Owner archive
// APIs. Reuse the existing durable planner + stream, with real Postgres and CAS.
func TestPublicShareFolderZIPLifecycleAndSecurity(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("real PostgreSQL17 required")
	}
	gin.SetMode(gin.TestMode)
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "public_zip_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error })
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.AuditEvent{}, &meta.Node{},
		&meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{}, &meta.Share{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.LocalPushQuotaHold{},
		&meta.ArchivePrepareRun{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id,parent_id,lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	manager := auth.New("public-share-zip-isolated-test-secret", time.Hour)
	server := &Server{DB: db, Store: store, Auth: manager, RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20}
	router := server.Router()
	peer := (&Server{DB: db, Store: store, Auth: manager, RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost"}).Router()
	ownerToken := createTestUser(t, db, router, "public-zip-owner", "password-for-owner")
	otherToken := createTestUser(t, db, router, "public-zip-other", "password-for-other")
	ownerRoot := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", ownerToken, nil, http.StatusOK)
	otherRoot := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", otherToken, nil, http.StatusOK)
	shared := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", ownerRoot.ID), ownerToken, strings.NewReader(`{"name":"Shared Folder"}`), http.StatusCreated)
	nested := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", shared.ID), ownerToken, strings.NewReader(`{"name":"Nested"}`), http.StatusCreated)
	requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", shared.ID), ownerToken, strings.NewReader(`{"name":"Empty"}`), http.StatusCreated)
	a := uploadTestFile(t, router, ownerToken, shared.ID, "hello.txt", "hello-from-shared-zip")
	b := uploadTestFile(t, router, ownerToken, nested.ID, "inside.bin", "inside-zip-content")
	outside := uploadTestFile(t, router, ownerToken, ownerRoot.ID, "outside.txt", "NOT-ALLOWED")
	uploadTestFile(t, router, otherToken, otherRoot.ID, "other.txt", "PRIVATE")

	createShare := func(downloads int64) createdShareDTO {
		res := request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/shares", shared.ID),
			ownerToken, strings.NewReader(fmt.Sprintf(`{"password":"zip-secret","max_downloads":%d}`, downloads)), http.StatusCreated)
		var v createdShareDTO
		if err := json.Unmarshal(res.Body.Bytes(), &v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	share := createShare(1)
	post := func(token, path, pass, runID string, want int) *publicShareArchiveStatus {
		t.Helper()
		data := fmt.Sprintf(`{"password":%q,"prepare_id":%q}`, pass, runID)
		res := requestWithHeaders(t, router, http.MethodPost, path, "", strings.NewReader(data),
			want, map[string]string{"X-XDrive-Share-Token": token})
		if want != http.StatusOK && want != http.StatusAccepted {
			return nil
		}
		var v publicShareArchiveStatus
		if err := json.Unmarshal(res.Body.Bytes(), &v); err != nil {
			t.Fatal(err)
		}
		return &v
	}
	preparePath := "/api/v1/public/share/archive/prepare"
	statusPath := "/api/v1/public/share/archive/status"
	ticketPath := "/api/v1/public/share/archive/download-ticket"
	post(share.Token, preparePath, "wrong", "", http.StatusUnauthorized)
	post("", preparePath, "zip-secret", "", http.StatusNotFound)
	post(share.Token, statusPath, "zip-secret", "not-a-uuid", http.StatusNotFound)
	request(t, router, http.MethodPost, "/api/v1/download/archive/prepare", "", strings.NewReader(`{"ids":[1]}`), http.StatusUnauthorized)
	first := post(share.Token, preparePath, "zip-secret", "", http.StatusAccepted)
	duplicate := post(share.Token, preparePath, "zip-secret", "", http.StatusAccepted)
	if first.PrepareID == "" || first.PrepareID != duplicate.PrepareID {
		t.Fatalf("public prepare not idempotent: %+v %+v", first, duplicate)
	}
	var cnt int64
	if err := db.Model(&meta.ArchivePrepareRun{}).Where("public_share_id = ?", share.ID).Count(&cnt).Error; err != nil || cnt != 1 {
		t.Fatalf("duplicate public prepare jobs: count=%d err=%v", cnt, err)
	}
	var stored meta.ArchivePrepareRun
	if err := db.Where("id = ?", first.PrepareID).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.OwnerID == 0 || stored.PublicShareID == nil || *stored.PublicShareID != share.ID ||
		strings.Contains(stored.RequestedIDsJSON, share.Token) || stored.PublicRootRevision == 0 {
		t.Fatalf("public job stored invalid capability boundary: %+v", stored)
	}
	if err := server.executeArchivePrepareRun(context.Background(), first.PrepareID); err != nil {
		t.Fatal(err)
	}
	completed := post(share.Token, statusPath, "zip-secret", first.PrepareID, http.StatusOK)
	if completed.State != meta.ArchivePrepareStatusCompleted ||
		completed.Filename != "Shared Folder.zip" ||
		completed.TotalBytes != int64(len("hello-from-shared-zip")+len("inside-zip-content")) {
		t.Fatalf("public ZIP prepare was not complete: %+v", completed)
	}
	// Public response must never embed private CAS keys, Owner internals or
	// an enormous list of 100k manifest entries.
	statusRes := requestWithHeaders(t, router, http.MethodPost, statusPath, "",
		strings.NewReader(fmt.Sprintf(`{"password":"zip-secret","prepare_id":%q}`, first.PrepareID)),
		http.StatusOK, map[string]string{"X-XDrive-Share-Token": share.Token})
	if strings.Contains(statusRes.Body.String(), "storage_key") || strings.Contains(statusRes.Body.String(), "manifest_json") ||
		strings.Contains(statusRes.Body.String(), share.Token) {
		t.Fatal("public archive status leaked storage or bearer")
	}
	raw := requestWithHeaders(t, router, http.MethodPost, ticketPath, "",
		strings.NewReader(fmt.Sprintf(`{"password":"zip-secret","prepare_id":%q}`, first.PrepareID)),
		http.StatusOK, map[string]string{"X-XDrive-Share-Token": share.Token})
	var ticket publicShareDownloadTicketDTO
	if err := json.Unmarshal(raw.Body.Bytes(), &ticket); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(ticket.URL, fmt.Sprintf("/api/v1/public-share-archive/%d?ticket=", share.ID)) ||
		strings.Contains(ticket.URL, share.Token) {
		t.Fatalf("public archive ticket leaked share bearer: %+v", ticket)
	}
	// A real second Server may stream it; source remains the prepared
	// authorized subtree. This counts ONE share download, not two files.
	body := requestWithHeaders(t, peer, http.MethodGet, ticket.URL, "", nil, http.StatusOK, nil)
	if body.Header().Get("Content-Type") != "application/zip" {
		t.Fatal("not streamed ZIP")
	}
	entries := readArchiveTestEntries(t, body.Body.Bytes())
	for name, want := range map[string]string{
		"Shared Folder/":                  "",
		"Shared Folder/Empty/":            "",
		"Shared Folder/Nested/":           "",
		"Shared Folder/hello.txt":         "hello-from-shared-zip",
		"Shared Folder/Nested/inside.bin": "inside-zip-content",
	} {
		if got, ok := entries[name]; !ok || got != want {
			t.Fatalf("bad archive entry %s: got %q found %v", name, got, ok)
		}
	}
	if strings.Contains(fmt.Sprint(entries), "NOT-ALLOWED") || len(entries) != 5 {
		t.Fatalf("ZIP escaped root: %v", entries)
	}
	var current meta.Share
	if err := db.First(&current, share.ID).Error; err != nil {
		t.Fatal(err)
	}
	if current.DownloadCount != 1 {
		t.Fatalf("folder ZIP must count once, got %d", current.DownloadCount)
	}
	post(share.Token, ticketPath, "zip-secret", first.PrepareID, http.StatusGone)
	post(share.Token, preparePath, "zip-secret", "", http.StatusGone)
	// Even when exhausted AFTER ticket issue, that already-issued ticket is
	// valid for the duration of its short TTL, like existing file tickets.
	requestWithHeaders(t, peer, http.MethodGet, ticket.URL, "", nil, http.StatusOK, nil)

	// Different share capability with the same folder cannot reuse or read
	// the first share's private preparation UUID.
	alternate := createShare(0)
	post(alternate.Token, statusPath, "zip-secret", first.PrepareID, http.StatusNotFound)
	second := post(alternate.Token, preparePath, "zip-secret", "", http.StatusAccepted)
	if err := server.executeArchivePrepareRun(context.Background(), second.PrepareID); err != nil {
		t.Fatal(err)
	}
	post(alternate.Token, statusPath, "zip-secret", second.PrepareID, http.StatusOK)
	if err := db.Model(&meta.Node{}).Where("id = ?", b.ID).
		Update("parent_id", ownerRoot.ID).Error; err != nil {
		t.Fatal(err)
	}
	post(alternate.Token, ticketPath, "zip-secret", second.PrepareID, http.StatusConflict)
	// Stale completed preparation is evicted from reuse on next explicit
	// recipient click, without weakening its prior permission check.
	renewed := post(alternate.Token, preparePath, "zip-secret", "", http.StatusAccepted)
	if renewed.PrepareID == second.PrepareID {
		t.Fatal("stale ZIP was reused")
	}
	if err := server.executeArchivePrepareRun(context.Background(), renewed.PrepareID); err != nil {
		t.Fatal(err)
	}
	ticketRes := requestWithHeaders(t, router, http.MethodPost, ticketPath, "",
		strings.NewReader(fmt.Sprintf(`{"password":"zip-secret","prepare_id":%q}`, renewed.PrepareID)),
		http.StatusOK, map[string]string{"X-XDrive-Share-Token": alternate.Token})
	var staleTicket publicShareDownloadTicketDTO
	if err := json.Unmarshal(ticketRes.Body.Bytes(), &staleTicket); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.Node{}).Where("id = ?", a.ID).
		Update("parent_id", ownerRoot.ID).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, peer, http.MethodGet, staleTicket.URL, "", nil, http.StatusConflict, nil)
	request(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/shares/%d", alternate.ID),
		ownerToken, nil, http.StatusNoContent)
	requestWithHeaders(t, peer, http.MethodGet, staleTicket.URL, "", nil, http.StatusGone, nil)

	// Explicit cancellation of a queued public task is persisted and does
	// not rely on page unmount/AbortSignal. It cannot cancel an Owner task.
	queuedShare := createShare(0)
	queued := post(queuedShare.Token, preparePath, "zip-secret", "", http.StatusAccepted)
	cancelPath := "/api/v1/public/share/archive/cancel"
	cancelResp := post(queuedShare.Token, cancelPath, "zip-secret", queued.PrepareID, http.StatusOK)
	if cancelResp.State != meta.ArchivePrepareStatusCancelRequested &&
		cancelResp.State != meta.ArchivePrepareStatusCancelled {
		t.Fatalf("cancel response: %+v", cancelResp)
	}
	var cancelled meta.ArchivePrepareRun
	if err := db.Where("id = ?", queued.PrepareID).First(&cancelled).Error; err != nil {
		t.Fatal(err)
	}
	if cancelled.Status != meta.ArchivePrepareStatusCancelled {
		t.Fatalf("task not cancelled: %+v", cancelled)
	}
	post(queuedShare.Token, ticketPath, "zip-secret", queued.PrepareID, http.StatusConflict)

	// CancelRequested is not yet terminal. Never queue another heavyweight
	// public ZIP for this share while the old Owner worker is winding down.
	pending := post(queuedShare.Token, preparePath, "zip-secret", "", http.StatusAccepted)
	if err := db.Model(&meta.ArchivePrepareRun{}).
		Where("id = ?", pending.PrepareID).
		Update("status", meta.ArchivePrepareStatusCancelRequested).Error; err != nil {
		t.Fatal(err)
	}
	stillPending := post(queuedShare.Token, preparePath, "zip-secret", "", http.StatusAccepted)
	if stillPending.PrepareID != pending.PrepareID || stillPending.State != meta.ArchivePrepareStatusCancelRequested {
		t.Fatalf("a second public archive task was enqueued before original cancel completed: %+v %+v",
			pending, stillPending)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	data := make([]byte, 100)
	if _, err := (publicArchiveContextReader{ctx: ctx, source: strings.NewReader("data")}).Read(data); !errors.Is(err, context.Canceled) {
		t.Fatalf("detached ZIP read did not stop: %v", err)
	}
	if len(entries) != 5 || outside.ID == 0 {
		t.Fatal("test corpus unexpectedly changed")
	}
}
