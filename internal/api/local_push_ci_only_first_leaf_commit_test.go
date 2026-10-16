//go:build linux || windows

package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

func ciOnlyFirstLeafOwnerJWT(t *testing.T, f localNativeCanonicalFixture) string {
	t.Helper()
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

func ciOnlyFirstLeafRequest(
	t *testing.T, f localNativeCanonicalFixture, router *gin.Engine, jwt, body string,
	change func(*http.Request),
) *httptest.ResponseRecorder {
	t.Helper()
	endpoint := fmt.Sprintf(
		"/api/v1/sources/%d/local-staging/%s/ci-first-leaf-commit",
		f.source.ID, f.stage.StageID,
	)
	req := httptest.NewRequest(http.MethodPost, endpoint, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+jwt)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", "\"7\"")
	req.Header.Set("X-XDrive-Device-ID", f.nativeProof.DeviceID)
	req.Header.Set("X-XDrive-Device-Token", f.nativeProof.DeviceToken)
	req.Header.Set("X-XDrive-Local-Root-ID", f.nativeProof.RootID)
	req.Header.Set("X-XDrive-Local-Root-Fingerprint", f.nativeProof.RootFingerprint)
	if change != nil {
		change(req)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	for _, sensitive := range []string{
		f.root.Path, f.nativeProof.DeviceToken, f.nativeProof.RootID,
		f.nativeProof.RootFingerprint, f.stage.SHA256,
	} {
		if sensitive != "" && strings.Contains(w.Body.String(), sensitive) {
			t.Fatalf("test-only first-file HTTP reply leaked native or CAS scope")
		}
	}
	return w
}

func TestLocalPushPrivateFirstLeafCIOnlyHTTPRouteIsAbsentByDefault(t *testing.T) {
	f := makeLocalNativeCanonicalFixture(t)
	router := f.server.Router()
	for _, r := range router.Routes() {
		if strings.Contains(r.Path, "ci-first-leaf-commit") {
			t.Fatalf("test-only canonical writer was registered in default Server: %s", r.Path)
		}
	}
	w := ciOnlyFirstLeafRequest(t, f, router, ciOnlyFirstLeafOwnerJWT(t, f),
		fmt.Sprintf(`{"relative_leaf":%q}`, localPushFirstLeafFixtureName), nil)
	if w.Code != http.StatusNotFound {
		t.Fatalf("disabled canonical writer returned HTTP %d", w.Code)
	}
	var nodes, runs, blobs int64
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&nodes).Error; err != nil || nodes != 0 {
		t.Fatalf("normal Server Router registered a canonical SourceItem: %d %v", nodes, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("normal Server started local Push: %d %v", runs, err)
	}
	if err := f.server.DB.Model(&meta.ContentBlob{}).Count(&blobs).Error; err != nil || blobs != 0 {
		t.Fatalf("normal Server created a CAS reference: %d %v", blobs, err)
	}
}

func TestLocalPushCIOnlyHTTPPhysicalNativeFirstLeafCommitAndLostReplyReplay(t *testing.T) {
	f := makeLocalNativeCanonicalFixture(t)
	native, err := f.nativePrecommit()
	if err != nil || !native.NativeMatched || !native.PhysicalStageMatched ||
		native.Authoritative || native.CommitSupported {
		t.Fatalf("source-original native precommit not valid: %+v %v", native, err)
	}
	f.prepareAndReserve(t)
	// Test code ALONE flips this private bit. Normal code contains no setter.
	f.server.localPushCIOnlyFirstLeaf = true
	router := f.server.Router()
	jwt := ciOnlyFirstLeafOwnerJWT(t, f)
	body := fmt.Sprintf(`{"relative_leaf":%q}`, localPushFirstLeafFixtureName)
	first := ciOnlyFirstLeafRequest(t, f, router, jwt, body, nil)
	if first.Code != http.StatusCreated ||
		first.Header().Get("ETag") != "\"7\"" ||
		!strings.Contains(first.Header().Get("Cache-Control"), "no-store") {
		t.Fatalf("real original->Stage->CAS/SQL test-gated writer failed: HTTP %d %s",
			first.Code, first.Body.String())
	}
	var got ciOnlyFirstLeafCommitResponse
	if err := json.Unmarshal(first.Body.Bytes(), &got); err != nil ||
		got.StageID != f.stage.StageID || got.SourceID != f.source.ID ||
		got.Revision != 7 || got.NodeID == 0 || got.SourceItemID == 0 ||
		got.State != localPushFirstLeafPhysicalReceiptState || got.Replayed ||
		!got.CASObserved || got.NativeVerified || got.BackupComplete ||
		got.CommitSupported || got.Authoritative || got.MissingInferenceSafe {
		t.Fatalf("test-only SQL receipt falsely claimed successful backup: %+v %v", got, err)
	}
	replay := ciOnlyFirstLeafRequest(t, f, router, jwt, body, nil)
	if replay.Code != http.StatusOK {
		t.Fatalf("ambiguous HTTP reply cannot be replayed: %d %s", replay.Code, replay.Body.String())
	}
	var repeated ciOnlyFirstLeafCommitResponse
	if err := json.Unmarshal(replay.Body.Bytes(), &repeated); err != nil ||
		!repeated.Replayed || repeated.NodeID != got.NodeID ||
		repeated.SourceItemID != got.SourceItemID || repeated.BackupComplete ||
		repeated.CommitSupported || repeated.Authoritative {
		t.Fatalf("first-file lost-reply replay changed canonical identity: %+v %v", repeated, err)
	}
	key, err := storage.ContentAddressedKey(f.stage.SHA256)
	if err != nil {
		t.Fatal(err)
	}
	h, err := f.store.Open(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	actual, readErr := io.ReadAll(h)
	closeErr := h.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(actual, f.body) {
		t.Fatalf("genuine original physical bytes did not survive private SQL commit: %v %v", readErr, closeErr)
	}
	var blob meta.ContentBlob
	if err := f.server.DB.Where("sha256 = ?", f.stage.SHA256).Take(&blob).Error; err != nil ||
		blob.RefCount != 1 || blob.State != meta.ContentBlobStateReady {
		t.Fatalf("real canonical CAS was not referenced exactly once: %+v %v", blob, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", got.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending ||
		item.LastSyncedAt != nil || item.LastSyncedRunID != "" {
		t.Fatalf("test-only canonical writer marked original backed up: %+v %v", item, err)
	}
	var runs int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("test-only writer started or finalized a SourceRun: %d %v", runs, err)
	}
	var source meta.Source
	if err := f.server.DB.Where("id = ?", f.source.ID).Take(&source).Error; err != nil ||
		source.Status != meta.SourceStatusPaused {
		t.Fatalf("CI-only first leaf activated production local Push: %+v %v", source, err)
	}
	if f.stagePUTs.Load() != 1 {
		t.Fatalf("replayed first-file commit uploaded native bytes twice: %d", f.stagePUTs.Load())
	}
}

func TestLocalPushCIOnlyHTTPFirstLeafRejectsInvalidDeviceAndInput(t *testing.T) {
	f := makeLocalNativeCanonicalFixture(t)
	f.prepareAndReserve(t)
	f.server.localPushCIOnlyFirstLeaf = true
	router := f.server.Router()
	jwt := ciOnlyFirstLeafOwnerJWT(t, f)
	good := fmt.Sprintf(`{"relative_leaf":%q}`, localPushFirstLeafFixtureName)
	for _, tc := range []struct {
		name   string
		body   string
		change func(*http.Request)
	}{
		{"missing-token", good, func(r *http.Request) {
			r.Header.Del("X-XDrive-Device-Token")
		}},
		{"forged-token", good, func(r *http.Request) {
			r.Header.Set("X-XDrive-Device-Token", "not-the-owning-device")
		}},
		{"foreign-device", good, func(r *http.Request) {
			r.Header.Set("X-XDrive-Device-ID", uuid.NewString())
		}},
		{"wrong-Root", good, func(r *http.Request) {
			r.Header.Set("X-XDrive-Local-Root-ID", uuid.NewString())
		}},
		{"wrong-revision", good, func(r *http.Request) {
			r.Header.Set("If-Match", "\"8\"")
		}},
		{"path-traversal", `{"relative_leaf":"../outside"}`, nil},
		{"nested-file", `{"relative_leaf":"nested/file.txt"}`, nil},
		{"extra-field", strings.TrimSuffix(good, "}") + `,"run":true}`, nil},
		{"body-trailing", good + " true", nil},
		{"oversized-body", good + strings.Repeat(" ", 700), nil},
		{"malformed-body", "{", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := ciOnlyFirstLeafRequest(t, f, router, jwt, tc.body, tc.change)
			if w.Code < 400 || w.Code >= 500 {
				t.Fatalf("unauthorized or malformed %s was accepted: HTTP %d", tc.name, w.Code)
			}
			if strings.Contains(w.Body.String(), "relative_leaf") {
				t.Fatal("raw local filename appeared in HTTP rejection")
			}
		})
	}
	var blobs, items int64
	if err := f.server.DB.Model(&meta.ContentBlob{}).Count(&blobs).Error; err != nil || blobs != 0 {
		t.Fatalf("invalid requests created a Blob: %d %v", blobs, err)
	}
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("invalid requests committed SourceItems: %d %v", items, err)
	}
	// Bad attempts cannot poison an authorized exact replay: real owning
	// request can still make its one and only pending first file.
	w := ciOnlyFirstLeafRequest(t, f, router, jwt, good, nil)
	if w.Code != http.StatusCreated {
		t.Fatalf("rejected callers poisoned valid exact first-file commit: %d %s", w.Code, w.Body.String())
	}
}

func TestLocalPushCIOnlyHTTPFirstLeafRejectsRevokedOrMissingCAS(t *testing.T) {
	for _, tc := range []string{"revoked-device", "missing-physical-CAS"} {
		t.Run(tc, func(t *testing.T) {
			f := makeLocalNativeCanonicalFixture(t)
			f.prepareAndReserve(t)
			f.server.localPushCIOnlyFirstLeaf = true
			router := f.server.Router()
			jwt := ciOnlyFirstLeafOwnerJWT(t, f)
			if tc == "revoked-device" {
				now := time.Now().UTC()
				if err := f.server.DB.Model(&meta.ClientDevice{}).
					Where("id = ?", f.device.ID).Update("revoked_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			} else {
				key, err := storage.ContentAddressedKey(f.stage.SHA256)
				if err != nil {
					t.Fatal(err)
				}
				if err := f.store.Delete(context.Background(), key); err != nil {
					t.Fatal(err)
				}
			}
			w := ciOnlyFirstLeafRequest(t, f, router, jwt,
				fmt.Sprintf(`{"relative_leaf":%q}`, localPushFirstLeafFixtureName), nil)
			if w.Code < 400 {
				t.Fatalf("%s authorized canonical write: HTTP %d %s", tc, w.Code, w.Body.String())
			}
			var blobs, items, runs int64
			if err := f.server.DB.Model(&meta.ContentBlob{}).Count(&blobs).Error; err != nil || blobs != 0 {
				t.Fatalf("%s created Blob: %d %v", tc, blobs, err)
			}
			if err := f.server.DB.Model(&meta.SourceItem{}).
				Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
				t.Fatalf("%s created SourceItem: %d %v", tc, items, err)
			}
			if err := f.server.DB.Model(&meta.SyncRun{}).
				Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
				t.Fatalf("%s started SourceRun: %d %v", tc, runs, err)
			}
		})
	}
}
