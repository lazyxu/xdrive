//go:build linux || windows

package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

func ciDirectoryJWT(t *testing.T, f localPushExistingCASTestFixture) string {
	t.Helper()
	// setupFilePropertiesTestDB creates only a DB-backed Server. Unlike an
	// HTTP fixture it has no signing key until this test explicitly sets one.
	f.server.Auth = auth.New("ci-only-first-directory-real-jwt-test", time.Hour)
	f.server.RefreshTTL = 24 * time.Hour
	var owner meta.User
	if err := f.server.DB.Where("id = ?", f.device.OwnerID).Take(&owner).Error; err != nil {
		t.Fatal(err)
	}
	jwt, err := f.server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	return jwt
}

func ciDirectoryHTTP(t *testing.T, f localPushExistingCASTestFixture, router *gin.Engine, jwt, body string, change func(*http.Request)) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/ci-first-directory-commit", f.source.ID), strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", "\"7\"")
	req.Header.Set("X-XDrive-Device-ID", f.proof.DeviceID)
	req.Header.Set("X-XDrive-Device-Token", f.ctx.Request.Header.Get("X-XDrive-Device-Token"))
	req.Header.Set("X-XDrive-Local-Root-ID", f.proof.RootID)
	req.Header.Set("X-XDrive-Local-Root-Fingerprint", f.ctx.Request.Header.Get("X-XDrive-Local-Root-Fingerprint"))
	if change != nil {
		change(req)
	}
	out := httptest.NewRecorder()
	router.ServeHTTP(out, req)
	for _, secret := range []string{f.proof.RootID, f.ctx.Request.Header.Get("X-XDrive-Device-Token"), f.stage.ContentSHA256} {
		if secret != "" && strings.Contains(out.Body.String(), secret) {
			t.Fatal("CI directory leaked private credential or CAS hash")
		}
	}
	return out
}

func TestLocalFirstDirectoryHTTPAbsentOnProductionRouter(t *testing.T) {
	f := makeLocalPushExistingCASTestFixture(t)
	jwt := ciDirectoryJWT(t, f)
	router := f.server.Router()
	for _, route := range router.Routes() {
		if strings.Contains(route.Path, "ci-first-directory-commit") {
			t.Fatal("test-only write registered in default Server")
		}
	}
	out := ciDirectoryHTTP(t, f, router, jwt, "{\"relative_directory\":\"Camera Roll\"}", nil)
	if out.Code != http.StatusNotFound {
		t.Fatalf("production first-directory writer exposed: %d", out.Code)
	}
	var count int64
	if err := f.server.DB.Model(&meta.SourceItem{}).Where("source_id = ?", f.source.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("disabled route wrote SourceItem: %d %v", count, err)
	}
}

func TestLocalFirstDirectoryCIHTTPAtomicPendingAndExactReplay(t *testing.T) {
	f := makeLocalPushExistingCASTestFixture(t)
	if err := f.server.DB.AutoMigrate(&meta.FileVersion{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	f.server.localPushCIOnlyFirstDirectory = true
	jwt := ciDirectoryJWT(t, f)
	router := f.server.Router()
	body := "{\"relative_directory\":\"Camera Roll\"}"
	created := ciDirectoryHTTP(t, f, router, jwt, body, nil)
	if created.Code != http.StatusCreated || created.Header().Get("ETag") != "\"7\"" || !strings.Contains(created.Header().Get("Cache-Control"), "no-store") {
		t.Fatalf("authenticated directory was not admitted: %d %s", created.Code, created.Body.String())
	}
	var first ciOnlyFirstDirectoryCommitResponse
	if err := json.Unmarshal(created.Body.Bytes(), &first); err != nil || first.SourceID != f.source.ID || first.Revision != f.source.Revision || first.NodeID == 0 || first.SourceItemID == 0 || first.State != meta.SourceItemStatePending || first.Replayed || first.NativeVerified || first.BackupComplete || first.CommitSupported || first.Authoritative || first.MissingInferenceSafe {
		t.Fatalf("CI directory elevated state: %+v %v", first, err)
	}
	again := ciDirectoryHTTP(t, f, router, jwt, body, nil)
	if again.Code != http.StatusOK {
		t.Fatalf("lost-response replay failed: %d %s", again.Code, again.Body.String())
	}
	var replay ciOnlyFirstDirectoryCommitResponse
	if err := json.Unmarshal(again.Body.Bytes(), &replay); err != nil || !replay.Replayed || replay.NodeID != first.NodeID || replay.SourceItemID != first.SourceItemID || replay.BackupComplete || replay.Authoritative {
		t.Fatalf("CI replay mutated ownership: %+v %v", replay, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).Take(&item).Error; err != nil || item.SourceID != f.source.ID || item.State != meta.SourceItemStatePending || item.NodeID == nil || *item.NodeID != first.NodeID || item.LastSyncedAt != nil || item.LastSyncedRunID != "" {
		t.Fatalf("directory marked synced: %+v %v", item, err)
	}
	var nodes, items, runs, files, versions, blobs int64
	db := f.server.DB
	if err := db.Model(&meta.Node{}).Where("parent_id = ?", *f.source.TargetNodeID).Count(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SourceItem{}).Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.File{}).Count(&files).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.FileVersion{}).Count(&versions).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.ContentBlob{}).Count(&blobs).Error; err != nil {
		t.Fatal(err)
	}
	if nodes != 1 || items != 1 || runs != 0 || files != 0 || versions != 0 || blobs != 1 {
		t.Fatalf("CI dir changed unrelated durable state: %d %d %d %d %d %d", nodes, items, runs, files, versions, blobs)
	}
}

func TestLocalFirstDirectoryCIHTTPUnauthorizedAndMalformedRemainUnwritten(t *testing.T) {
	f := makeLocalPushExistingCASTestFixture(t)
	f.server.localPushCIOnlyFirstDirectory = true
	jwt := ciDirectoryJWT(t, f)
	router := f.server.Router()
	good := "{\"relative_directory\":\"Camera Roll\"}"
	for _, tc := range []struct {
		name, body string
		change     func(*http.Request)
	}{
		{"no-jwt", good, func(r *http.Request) { r.Header.Del("Authorization") }},
		{"missing-token", good, func(r *http.Request) { r.Header.Del("X-XDrive-Device-Token") }},
		{"wrong-token", good, func(r *http.Request) { r.Header.Set("X-XDrive-Device-Token", "foreign") }},
		{"different-device", good, func(r *http.Request) { r.Header.Set("X-XDrive-Device-ID", uuid.NewString()) }},
		{"different-root", good, func(r *http.Request) { r.Header.Set("X-XDrive-Local-Root-ID", uuid.NewString()) }},
		{"wrong-fingerprint", good, func(r *http.Request) { r.Header.Set("X-XDrive-Local-Root-Fingerprint", strings.Repeat("b", 64)) }},
		{"stale-revision", good, func(r *http.Request) { r.Header.Set("If-Match", "\"8\"") }},
		{"empty", "{\"relative_directory\":\"\"}", nil},
		{"traversal", "{\"relative_directory\":\"../outside\"}", nil},
		{"nested", "{\"relative_directory\":\"one/two\"}", nil},
		{"reserved", "{\"relative_directory\":\"CON\"}", nil},
		{"unknown-field", "{\"relative_directory\":\"Camera Roll\",\"run\":true}", nil},
		{"trailing", good + " true", nil},
		{"oversize", good + strings.Repeat(" ", 700), nil},
		{"invalid-json", "{", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			out := ciDirectoryHTTP(t, f, router, jwt, tc.body, tc.change)
			if out.Code < 400 || out.Code >= 500 {
				t.Fatalf("%s accepted: HTTP %d", tc.name, out.Code)
			}
		})
	}
	var count int64
	if err := f.server.DB.Model(&meta.SourceItem{}).Where("source_id = ?", f.source.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("unauthorized attempts committed SourceItems: %d %v", count, err)
	}
	if out := ciDirectoryHTTP(t, f, router, jwt, good, nil); out.Code != http.StatusCreated {
		t.Fatalf("invalid callers poisoned owner: HTTP %d", out.Code)
	}
}

func TestLocalFirstDirectoryCIHTTPRevocationAndSourceDriftFailClosed(t *testing.T) {
	for _, kind := range []string{"revoked", "revision", "active", "target-deleted"} {
		t.Run(kind, func(t *testing.T) {
			f := makeLocalPushExistingCASTestFixture(t)
			f.server.localPushCIOnlyFirstDirectory = true
			jwt := ciDirectoryJWT(t, f)
			switch kind {
			case "revoked":
				now := time.Now().UTC()
				if err := f.server.DB.Model(&meta.ClientDevice{}).Where("id = ?", f.device.ID).Update("revoked_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			case "revision":
				if err := f.server.DB.Model(&meta.Source{}).Where("id = ?", f.source.ID).Update("revision", 8).Error; err != nil {
					t.Fatal(err)
				}
			case "active":
				if err := f.server.DB.Model(&meta.Source{}).Where("id = ?", f.source.ID).Update("status", meta.SourceStatusActive).Error; err != nil {
					t.Fatal(err)
				}
			case "target-deleted":
				now := time.Now().UTC()
				if err := f.server.DB.Model(&meta.Node{}).Where("id = ?", *f.source.TargetNodeID).Update("deleted_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			}
			w := ciDirectoryHTTP(t, f, f.server.Router(), jwt, "{\"relative_directory\":\"Camera Roll\"}", nil)
			if w.Code < 400 || w.Code >= 500 {
				t.Fatalf("%s authorized CI directory: HTTP %d", kind, w.Code)
			}
			var count int64
			if err := f.server.DB.Model(&meta.SourceItem{}).Where("source_id = ?", f.source.ID).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("%s wrote unauthorized directory: %d %v", kind, count, err)
			}
		})
	}
}
