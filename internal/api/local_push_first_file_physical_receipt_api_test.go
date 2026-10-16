package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
)

// A real committed internal first leaf is queried through the SAME Gin
// route and strict owning-Agent Go Client transport used in production.
// It intentionally creates no Runner, synced SourceItem or successful Run.
func localPushFirstLeafPhysicalHTTPFixture(
	t *testing.T,
) (localPushExistingCASTestFixture, *client.Client, client.LocalBoundSourceProof) {
	t.Helper()
	f := makeLocalPushFirstFileCommitFixture(t)
	f.server.Auth = auth.New("private-physical-first-file-receipt-test", time.Hour)
	f.server.RefreshTTL = 24 * time.Hour
	var owner meta.User
	if err := f.server.DB.Where("id = ?", f.device.OwnerID).Take(&owner).Error; err != nil {
		t.Fatal(err)
	}
	jwt, err := f.server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	router := f.server.Router()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A local leaf name may appear only inside the authenticated POST
		// body, not in URL/path/query/referrer logs or untrusted redirects.
		if strings.Contains(r.URL.String(), localPushFirstLeafFixtureName) {
			t.Error("private native leaf leaked into recovery URL")
		}
		router.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)
	proof := client.LocalBoundSourceProof{
		DeviceID: f.device.ID, DeviceToken: "local-precommit-owning-device-test-secret",
		RootID: f.proof.RootID, RootFingerprint: f.stage.RootFingerprint,
	}
	return f, client.New(server.URL, jwt), proof
}

func TestLocalPushFirstLeafHTTPHistoricalCASReceiptIsDeviceOnlyAndReadOnly(t *testing.T) {
	f, cli, proof := localPushFirstLeafPhysicalHTTPFixture(t)
	// An uncommitted physical Stage must never look like a recovered upload.
	if _, err := cli.ReadLocalPushFirstLeafPhysicalReceipt(
		context.Background(), f.source.ID, f.source.Revision,
		proof, f.stage.StageID, localPushFirstLeafFixtureName,
	); err == nil {
		t.Fatal("temporary Stage without SQL commit returned physical receipt")
	}
	committed, admitted, err := f.commitFirstLeaf(localPushFirstLeafFixtureName)
	if err != nil || !admitted || committed.NodeID == 0 || committed.SourceItemID == 0 {
		t.Fatalf("private first leaf could not commit for recovery fixture: %+v %t %v",
			committed, admitted, err)
	}
	// Simulate lost response, Stage slot reuse and both records' expiry.
	// SQL receipt intentionally survives without a live temporary Stage.
	if err := f.server.DB.Model(&meta.LocalPushStaging{}).
		Where("source_id = ?", f.source.ID).Update("stage_id", uuid.NewString()).Error; err != nil {
		t.Fatal(err)
	}
	past := time.Now().UTC().Add(-time.Hour).Truncate(time.Microsecond)
	if err := f.server.DB.Model(&meta.LocalPushCASPrepareIntent{}).
		Where("stage_id = ?", f.stage.StageID).Update("stage_expires_at", past).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.server.DB.Model(&meta.LocalPushQuotaHold{}).
		Where("stage_id = ?", f.stage.StageID).Update("expires_at", past).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.local.DeleteStaging(context.Background(), f.stageKey); err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 2; n++ {
		out, err := cli.ReadLocalPushFirstLeafPhysicalReceipt(
			context.Background(), f.source.ID, f.source.Revision,
			proof, f.stage.StageID, localPushFirstLeafFixtureName,
		)
		if err != nil || out.NodeID != committed.NodeID ||
			out.SourceItemID != committed.SourceItemID ||
			out.State != localPushFirstLeafPhysicalReceiptState ||
			!out.CASObserved || out.NativeVerified || out.BackupComplete ||
			out.CommitSupported || out.Authoritative {
			t.Fatalf("lost-reply physical recovery is not a bounded fact: %+v %v", out, err)
		}
		raw, err := json.Marshal(out)
		if err != nil || string(raw) != "{}" {
			t.Fatalf("native/SQL diagnostic leaked into generic IPC JSON: %q %v", raw, err)
		}
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", committed.SourceItemID).Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending ||
		item.LastSyncedAt != nil || item.LastSyncedRunID != "" {
		t.Fatalf("read-only physical recovery completed a SourceItem: %+v %v", item, err)
	}
	var runCount, blobs int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runCount).Error; err != nil || runCount != 0 {
		t.Fatalf("recovery fabricated a SyncRun: %d %v", runCount, err)
	}
	if err := f.server.DB.Model(&meta.ContentBlob{}).Count(&blobs).Error; err != nil || blobs != 1 {
		t.Fatalf("read-only historical receipt wrote canonical CAS refs: %d %v", blobs, err)
	}
}

func TestLocalPushFirstLeafHTTPPhysicalReceiptRejectsUnboundAndWrongClaims(t *testing.T) {
	f, cli, proof := localPushFirstLeafPhysicalHTTPFixture(t)
	if _, admitted, err := f.commitFirstLeaf(localPushFirstLeafFixtureName); err != nil || !admitted {
		t.Fatalf("fixture needs one committed leaf: %t %v", admitted, err)
	}
	for _, kind := range []string{
		"forged-secret", "same-owner-other-device", "wrong-root", "wrong-stage",
		"wrong-leaf", "untrusted-path", "wrong-revision", "missing-device",
	} {
		t.Run(kind, func(t *testing.T) {
			other := proof
			stageID := f.stage.StageID
			leaf := localPushFirstLeafFixtureName
			revision := f.source.Revision
			switch kind {
			case "forged-secret":
				other.DeviceToken = "not-the-owning-device-secret"
			case "same-owner-other-device":
				// A genuinely enrolled second Desktop for the SAME account
				// cannot inherit A's bound local Root or physical CAS receipt.
				other.DeviceID = uuid.NewString()
				other.DeviceToken = "second-device-private-token"
				device := meta.ClientDevice{
					ID: other.DeviceID, OwnerID: f.device.OwnerID,
					Name: "Other same-account Desktop", Platform: "windows",
					CredentialHash: deviceCredentialDigest(other.DeviceToken),
					CreatedAt:      time.Now().UTC(), UpdatedAt: time.Now().UTC(),
				}
				if err := f.server.DB.Create(&device).Error; err != nil {
					t.Fatal(err)
				}
			case "wrong-root":
				other.RootID = uuid.NewString()
			case "wrong-stage":
				stageID = uuid.NewString()
			case "wrong-leaf":
				leaf = "other-first-leaf.jpg"
			case "untrusted-path":
				leaf = "../private"
			case "wrong-revision":
				revision++
			case "missing-device":
				other.DeviceToken = ""
			}
			if _, err := cli.ReadLocalPushFirstLeafPhysicalReceipt(
				context.Background(), f.source.ID, revision,
				other, stageID, leaf,
			); err == nil {
				t.Fatalf("%s acquired a physical receipt without correct identity", kind)
			}
		})
	}
}
func TestLocalPushFirstLeafHTTPReceiptRequiresCurrentCASAndDeviceState(t *testing.T) {
	for _, variant := range []string{
		"corrupt-cas", "missing-cas", "revoked-device",
		"changed-root", "changed-source-revision", "already-synced-item",
	} {
		t.Run(variant, func(t *testing.T) {
			f, cli, proof := localPushFirstLeafPhysicalHTTPFixture(t)
			if _, accepted, err := f.commitFirstLeaf(localPushFirstLeafFixtureName); !accepted || err != nil {
				t.Fatalf("failed to seed private committed physical receipt: %t %v", accepted, err)
			}
			switch variant {
			case "corrupt-cas":
				full := filepath.Join(f.local.FilesystemRoot(), filepath.FromSlash(f.casKey))
				if err := os.WriteFile(full, bytes.Repeat([]byte{0xfa}, len(f.body)), 0o600); err != nil {
					t.Fatal(err)
				}
			case "missing-cas":
				if err := f.local.Delete(context.Background(), f.casKey); err != nil {
					t.Fatal(err)
				}
			case "revoked-device":
				now := time.Now().UTC()
				if err := f.server.DB.Model(&meta.ClientDevice{}).
					Where("id = ?", f.device.ID).Update("revoked_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			case "changed-root":
				if err := f.server.DB.Model(&meta.LocalSourceBinding{}).
					Where("source_id = ?", f.source.ID).
					Update("root_fingerprint", strings.Repeat("b", 64)).Error; err != nil {
					t.Fatal(err)
				}
			case "changed-source-revision":
				if err := f.server.DB.Model(&meta.Source{}).
					Where("id = ?", f.source.ID).Update("revision", f.source.Revision+1).Error; err != nil {
					t.Fatal(err)
				}
			case "already-synced-item":
				if err := f.server.DB.Model(&meta.SourceItem{}).
					Where("source_id = ?", f.source.ID).
					Update("state", meta.SourceItemStateSynced).Error; err != nil {
					t.Fatal(err)
				}
			}
			result, err := cli.ReadLocalPushFirstLeafPhysicalReceipt(
				context.Background(), f.source.ID, f.source.Revision,
				proof, f.stage.StageID, localPushFirstLeafFixtureName,
			)
			if err == nil || result.CASObserved || result.BackupComplete {
				t.Fatalf("%s exposed unverified physical recovery: %+v %v", variant, result, err)
			}
			var runs int64
			if err := f.server.DB.Model(&meta.SyncRun{}).
				Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
				t.Fatalf("%s recovery created a successful source run: %d %v", variant, runs, err)
			}
		})
	}
}
func TestLocalPushFirstLeafHTTPReadRejectsOversizedUnknownAndUnboundRequests(t *testing.T) {
	f, _, proof := localPushFirstLeafPhysicalHTTPFixture(t)
	var owner meta.User
	if err := f.server.DB.Where("id = ?", f.device.OwnerID).Take(&owner).Error; err != nil {
		t.Fatal(err)
	}
	token, err := f.server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	router := f.server.Router()
	endpoint := "/api/v1/sources/" + strconv.FormatUint(f.source.ID, 10) +
		"/local-staging/" + f.stage.StageID + "/physical-receipt"
	normal := "{\"relative_leaf\":\"" + localPushFirstLeafFixtureName + "\"}"
	cases := []struct {
		name      string
		body      string
		omitToken bool
		want      int
	}{
		{"malformed-json", "{", false, http.StatusBadRequest},
		{"unknown-field", strings.TrimSuffix(normal, "}") + ",\"unexpected\":true}", false, http.StatusBadRequest},
		{"trailing-json", normal + " true", false, http.StatusBadRequest},
		{"oversized-body", normal + strings.Repeat(" ", 600), false, http.StatusBadRequest},
		{"relative-traversal", "{\"relative_leaf\":\"../secret\"}", false, http.StatusBadRequest},
		{"empty-leaf", "{\"relative_leaf\":\"\"}", false, http.StatusBadRequest},
		{"wrong-leaf-type", "{\"relative_leaf\":23}", false, http.StatusBadRequest},
		{"owner-jwt-without-device-proof", normal, true, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, endpoint, strings.NewReader(tc.body))
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("If-Match", "\"7\"")
			req.Header.Set("X-XDrive-Device-ID", proof.DeviceID)
			if !tc.omitToken {
				req.Header.Set("X-XDrive-Device-Token", proof.DeviceToken)
			}
			req.Header.Set("X-XDrive-Local-Root-ID", proof.RootID)
			req.Header.Set("X-XDrive-Local-Root-Fingerprint", proof.RootFingerprint)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, req)
			if response.Code != tc.want {
				t.Fatalf("untrusted %s input returned HTTP %d, expected %d: %s",
					tc.name, response.Code, tc.want, response.Body.String())
			}
			if !tc.omitToken && !strings.Contains(response.Header().Get("Cache-Control"), "no-store") {
				t.Fatalf("%s response was cacheable: %v", tc.name, response.Header())
			}
			for _, secret := range []string{
				proof.DeviceToken, proof.RootID, proof.RootFingerprint, f.stage.ContentSHA256,
			} {
				if strings.Contains(response.Body.String(), secret) {
					t.Fatalf("%s leaked native or CAS identity through error response", tc.name)
				}
			}
		})
	}
	var items, runs int64
	if err := f.server.DB.Model(&meta.SourceItem{}).
		Where("source_id = ?", f.source.ID).Count(&items).Error; err != nil || items != 0 {
		t.Fatalf("invalid recovery mutated SourceItem: count=%d err=%v", items, err)
	}
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("invalid recovery fabricated SourceRun: count=%d err=%v", runs, err)
	}
}
