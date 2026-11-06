package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// This regression deliberately keeps legacy rows in PostgreSQL. Removing the
// old DSM Photos Push executor must never cascade-delete Source/Node/CAS data.
func TestRetiredSynologyPhotosPushPreservesHistoryAndCannotWrite(t *testing.T) {
	db, server, owner, stranger, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}, &meta.FileVersion{}, &meta.UploadSession{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("retired-dsm-photos-push-integration", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	router := server.Router()
	ownerJWT, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	strangerJWT, err := server.Auth.Issue(stranger.ID, stranger.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	// Neither a browser nor a valid historical Synology Device is allowed to
	// create a new Photos Push Source. Photos Pull remains a distinct kind.
	request(t, router, http.MethodPost, "/api/v1/sources", ownerJWT,
		strings.NewReader(`{"name":"retired push","kind":"synology_photos","direction":"push","sync_mode":"backup","run_mode":"sync"}`),
		http.StatusGone)
	var created int64
	if err := db.Model(&meta.Source{}).
		Where("owner_id = ? AND kind = ? AND direction = ?",
			owner.ID, synologySourceKind, meta.SourceDirectionPush).
		Count(&created).Error; err != nil || created != 0 {
		t.Fatalf("new Synology Photos Push unexpectedly persisted: count=%d err=%v", created, err)
	}

	target := createFilePropertiesDir(t, db, owner.ID, root.ID, "legacy Photos Push target")
	photo := createFilePropertiesFile(t, db, owner.ID, target.ID, "original.jpg", 16)
	source := meta.Source{
		OwnerID: owner.ID, Name: "Existing DSM Photos Push",
		Kind: synologySourceKind, Direction: meta.SourceDirectionPush,
		SyncMode: meta.SourceSyncModeBackup, RunMode: meta.SourceRunModeSync,
		Status: meta.SourceStatusActive, Revision: 1,
		TargetNodeID: &target.ID, TargetManaged: true,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	item := meta.SourceItem{
		SourceID: source.ID, ExternalID: "synology:shared:123",
		NodeID: &photo.ID, Kind: meta.SourceItemKindFile,
		Path: "original.jpg", State: meta.SourceItemStateSynced,
		LastSeenAt: time.Now().UTC(),
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	version := meta.FileVersion{
		NodeID: photo.ID, Revision: 1, Size: 16,
		SHA256: strings.Repeat("f", 64),
		StorageKey: "retired-dsm-photos/retain-cas",
	}
	if err := db.Create(&version).Error; err != nil {
		t.Fatal(err)
	}

	url := fmt.Sprintf("/api/v1/sources/%d", source.ID)
	request(t, router, http.MethodGet, url, ownerJWT, nil, http.StatusOK)
	request(t, router, http.MethodGet, url, strangerJWT, nil, http.StatusNotFound)
	for _, call := range []struct {
		method, suffix, body string
	}{
		{http.MethodPost, "/trigger", ""},
		{http.MethodPatch, "", `{"status":"active"}`},
		{http.MethodPost, "/restore", ""},
	} {
		requestWithHeaders(t, router, call.method, url+call.suffix, ownerJWT,
			strings.NewReader(call.body), http.StatusGone, map[string]string{"If-Match": `"1"`})
	}
	request(t, router, http.MethodPut, url+"/synology-root", ownerJWT,
		strings.NewReader(`{"root_id":"ignored"}`), http.StatusNotFound)

	// Existing SourceID-bound sessions must fail closed even if the old
	// caller still presents its historical Source/Root headers.
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	init := uploadInitRequest{ParentID: &target.ID, Name: "new.jpg", SourceID: source.ID}
	if err := requireSourceRunOrLocalPushTargetTx(context.Background(), db, ctx,
		owner.ID, target.ID, init); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("retired Photos Push init gained write authority: %v", err)
	}
	session := meta.UploadSession{ID: "a54b1e36-cff3-47cf-8f14-6c21e1ec8d74",
		OwnerID: owner.ID, ParentID: &target.ID, SourceID: source.ID,
		Name: "new.jpg", Status: meta.UploadStatusActive}
	if err := requireSourceRunOrLocalPushFinalizeTx(context.Background(), db, ctx,
		session, target.ID); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("retired Photos Push finalize gained write authority: %v", err)
	}

	// Owner can archive *only* this retired Source. Never hard-delete the
	// Source or Target, and never reactivate it through the restore endpoint.
	requestWithHeaders(t, router, http.MethodPost, url+"/archive",
		strangerJWT, nil, http.StatusNotFound, map[string]string{"If-Match": `"1"`})
	out := requestWithHeaders(t, router, http.MethodPost, url+"/archive",
		ownerJWT, nil, http.StatusOK, map[string]string{"If-Match": `"1"`})
	var archived sourceDTO
	if err := json.Unmarshal(out.Body.Bytes(), &archived); err != nil {
		t.Fatal(err)
	}
	if archived.ID != source.ID || archived.Revision != 2 ||
		archived.Status != meta.SourceStatusArchived ||
		archived.TargetNodeID == nil || *archived.TargetNodeID != target.ID {
		t.Fatalf("archive altered historical Source target/identity: %+v", archived)
	}
	requestWithHeaders(t, router, http.MethodPost, url+"/restore",
		ownerJWT, nil, http.StatusGone, map[string]string{"If-Match": `"2"`})
	request(t, router, http.MethodGet, url, ownerJWT, nil, http.StatusOK)

	var storedSource meta.Source
	if err := db.Where("id = ?", source.ID).Take(&storedSource).Error; err != nil {
		t.Fatal(err)
	}
	var count int64
	for _, model := range []any{&meta.SourceItem{}, &meta.Node{}, &meta.FileVersion{}} {
		query := db.Model(model)
		switch model.(type) {
		case *meta.SourceItem:
			query = query.Where("source_id = ?", source.ID)
		case *meta.Node:
			query = query.Where("id IN ?", []uint64{target.ID, photo.ID})
		case *meta.FileVersion:
			query = query.Where("node_id = ?", photo.ID)
		}
		if err := query.Count(&count).Error; err != nil || count == 0 {
			t.Fatalf("retirement erased historical model %T: count=%d err=%v", model, count, err)
		}
	}
	if storedSource.Status != meta.SourceStatusArchived || !storedSource.TargetManaged {
		t.Fatalf("retirement lost Source provenance: %+v", storedSource)
	}
}

func TestOnlySynologyPhotosPushIsRetired(t *testing.T) {
	for _, tc := range []struct {
		kind, direction string
		retired bool
	}{
		{synologySourceKind, meta.SourceDirectionPush, true},
		{synologySourceKind, meta.SourceDirectionPull, false},
		{synologyFilesSourceKind, meta.SourceDirectionPull, false},
		{meta.SourceKindLocalFolder, meta.SourceDirectionPush, false},
	} {
		if got := isRetiredSynologyPhotosPush(meta.Source{Kind: tc.kind, Direction: tc.direction}); got != tc.retired {
			t.Fatalf("kind=%q direction=%q retired=%t want=%t", tc.kind, tc.direction, got, tc.retired)
		}
	}
}
