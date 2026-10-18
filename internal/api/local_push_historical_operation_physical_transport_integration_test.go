package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
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

func makeLocalPushHistoricalOperationHTTPFixture(t *testing.T) (
	localPushExistingCASTestFixture, *client.Client,
	client.LocalBoundSourceProof, [32]byte, meta.LocalPushOperationIntent,
	localPushFirstFileCommitResult,
) {
	t.Helper()
	f, key, operation := makeLocalPushBoundFirstLeafFixture(t)
	first, ok, err := f.server.commitBoundLocalPushFirstLeafWithCurrentOperation(
		f.ctx, f.source.ID, f.source.Revision, f.proof, f.stage.StageID,
		localPushFirstLeafFixtureName, key, operation.ID, operation.Generation)
	if err != nil || !ok || first.Replayed ||
		first.NodeID == 0 || first.SourceItemID == 0 {
		t.Fatalf("operation-keyed physical CAS and SQL commit unavailable: %+v %t %v",
			first, ok, err)
	}
	f.server.Auth = auth.New("private-historical-operation-physical-read", time.Hour)
	f.server.RefreshTTL = 24 * time.Hour
	var owner meta.User
	if err := f.server.DB.Where("id = ?", f.device.OwnerID).
		Take(&owner).Error; err != nil {
		t.Fatal(err)
	}
	jwt, err := f.server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	router := f.server.Router()
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Neither the local original name nor secret may enter URL logs.
		if strings.Contains(r.URL.String(), localPushFirstLeafFixtureName) ||
			strings.Contains(r.URL.RawQuery, "request_key") {
			t.Error("native source data leaked into HTTP URL")
		}
		router.ServeHTTP(w, r)
	}))
	t.Cleanup(httpServer.Close)
	var original [32]byte
	copy(original[:], key)
	proof := client.LocalBoundSourceProof{
		DeviceID:        f.device.ID,
		DeviceToken:     "local-precommit-owning-device-test-secret",
		RootID:          f.proof.RootID,
		RootFingerprint: f.stage.RootFingerprint,
	}
	return f, client.New(httpServer.URL, jwt), proof, original, operation, first
}

func TestLocalPushOperationPhysicalPOSTReadOnlyLostResponseAndStageReplacement(t *testing.T) {
	f, cli, proof, key, op, first := makeLocalPushHistoricalOperationHTTPFixture(t)
	read := func() (client.LocalPushHistoricalOperationPhysicalReceipt, error) {
		return cli.ReadLocalPushHistoricalOperationPhysicalReceipt(
			context.Background(), f.source.ID, f.source.Revision, proof,
			f.stage.StageID, localPushFirstLeafFixtureName, key,
			op.ID, op.Generation)
	}
	// No current live Stage is required: a completed Stage can be replaced.
	got, err := read()
	if err != nil || !got.CASObserved || got.NativeVerified ||
		got.BackupComplete || got.CommitSupported || got.Authoritative ||
		got.RetirementSupported || got.OperationID != op.ID ||
		got.Generation != op.Generation || got.StageID != f.stage.StageID ||
		got.NodeID != first.NodeID || got.SourceItemID != first.SourceItemID {
		t.Fatalf("missing scoped historical operation/CAS receipt: %+v %v", got, err)
	}
	raw, err := json.Marshal(got)
	if err != nil || string(raw) != "{}" {
		t.Fatalf("private operation/CAS result escaped IPC JSON: %s %v", raw, err)
	}
	if err := f.server.DB.Model(&meta.LocalPushStaging{}).
		Where("source_id = ?", f.source.ID).
		Update("stage_id", uuid.NewString()).Error; err != nil {
		t.Fatal(err)
	}
	again, err := read()
	if err != nil || again != got {
		t.Fatalf("lost-reply historical CAS read changed after Stage reuse: %+v %v", again, err)
	}
	var item meta.SourceItem
	if err := f.server.DB.Where("id = ?", first.SourceItemID).
		Take(&item).Error; err != nil ||
		item.State != meta.SourceItemStatePending ||
		item.LastSyncedAt != nil || item.LastSyncedRunID != "" {
		t.Fatalf("historical read falsely synced SourceItem: %+v %v", item, err)
	}
	var runs int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("read-only historical receipt started a backup: %d %v", runs, err)
	}
}

func TestLocalPushOperationPhysicalReadRejectsForgedIdentityAndDrift(t *testing.T) {
	for _, variant := range []string{
		"key", "operation", "generation", "stage", "leaf", "path-traversal",
		"device-token", "same-owner-foreign-device", "root",
		"revision", "source-drift", "revoked", "missing-cas",
		"corrupt-cas", "synced-item", "canceled-context",
	} {
		t.Run(variant, func(t *testing.T) {
			f, cli, proof, key, op, first := makeLocalPushHistoricalOperationHTTPFixture(t)
			stage, leaf, operationID, generation := f.stage.StageID,
				localPushFirstLeafFixtureName, op.ID, op.Generation
			revision := f.source.Revision
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch variant {
			case "key":
				key[0] ^= 0xff
			case "operation":
				operationID = uuid.NewString()
			case "generation":
				generation++
			case "stage":
				stage = uuid.NewString()
			case "leaf":
				leaf = "wrong.jpg"
			case "path-traversal":
				leaf = "../escape"
			case "device-token":
				proof.DeviceToken = "forged-device-token"
			case "same-owner-foreign-device":
				proof.DeviceID = uuid.NewString()
				proof.DeviceToken = "other-registered-device"
				if err := f.server.DB.Create(&meta.ClientDevice{
					ID: proof.DeviceID, OwnerID: f.device.OwnerID,
					Platform: "windows", Name: "Foreign same-account device",
					CredentialHash: deviceCredentialDigest(proof.DeviceToken),
					CreatedAt:      time.Now().UTC(), UpdatedAt: time.Now().UTC(),
				}).Error; err != nil {
					t.Fatal(err)
				}
			case "root":
				proof.RootFingerprint = strings.Repeat("d", 64)
			case "revision":
				revision++
			case "source-drift":
				if err := f.server.DB.Model(&meta.Source{}).
					Where("id = ?", f.source.ID).
					Update("revision", f.source.Revision+1).Error; err != nil {
					t.Fatal(err)
				}
			case "revoked":
				now := time.Now().UTC()
				if err := f.server.DB.Model(&meta.ClientDevice{}).
					Where("id = ?", f.device.ID).
					Update("revoked_at", &now).Error; err != nil {
					t.Fatal(err)
				}
			case "missing-cas":
				if err := f.local.Delete(context.Background(), f.casKey); err != nil {
					t.Fatal(err)
				}
			case "corrupt-cas":
				file := filepath.Join(f.local.FilesystemRoot(), filepath.FromSlash(f.casKey))
				bad := bytes.Repeat([]byte{0x83}, len(f.body))
				if err := os.WriteFile(file, bad, 0o600); err != nil {
					t.Fatal(err)
				}
			case "synced-item":
				if err := f.server.DB.Model(&meta.SourceItem{}).
					Where("id = ?", first.SourceItemID).
					Update("state", meta.SourceItemStateSynced).Error; err != nil {
					t.Fatal(err)
				}
			case "canceled-context":
				cancel()
			}
			got, err := cli.ReadLocalPushHistoricalOperationPhysicalReceipt(
				ctx, f.source.ID, revision, proof, stage, leaf,
				key, operationID, generation)
			if err == nil || got.CASObserved || got.NodeID != 0 ||
				got.SourceItemID != 0 || got.BackupComplete {
				t.Fatalf("%s admitted a foreign or corrupt CAS recovery: %+v %v",
					variant, got, err)
			}
			var runs int64
			if err := f.server.DB.Model(&meta.SyncRun{}).
				Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
				t.Fatalf("%s changed real SourceRun state: %d %v", variant, runs, err)
			}
		})
	}
}

func TestLocalPushOperationPhysicalHTTPBoundsAndNoCredentialLeaks(t *testing.T) {
	f, _, proof, key, op, _ := makeLocalPushHistoricalOperationHTTPFixture(t)
	var owner meta.User
	if err := f.server.DB.Where("id = ?", f.device.OwnerID).Take(&owner).Error; err != nil {
		t.Fatal(err)
	}
	jwt, err := f.server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	route := fmt.Sprintf("/api/v1/sources/%d/local-staging/%s/operation-physical-receipt",
		f.source.ID, f.stage.StageID)
	proofHeaders := map[string]string{
		"If-Match":                        strconv.Quote(strconv.FormatUint(f.source.Revision, 10)),
		"Content-Type":                    "application/json",
		"X-XDrive-Device-ID":              proof.DeviceID,
		"X-XDrive-Device-Token":           proof.DeviceToken,
		"X-XDrive-Local-Root-ID":          proof.RootID,
		"X-XDrive-Local-Root-Fingerprint": proof.RootFingerprint,
	}
	body := fmt.Sprintf(`{"request_key":%q,"operation_id":%q,"generation":%d,"relative_leaf":%q}`,
		base64.RawURLEncoding.EncodeToString(key[:]), op.ID, op.Generation,
		localPushFirstLeafFixtureName)
	router := f.server.Router()
	test := func(label, url, payload string, hdr map[string]string, status int) {
		t.Helper()
		resp := requestWithHeaders(t, router, http.MethodPost, url, jwt,
			strings.NewReader(payload), status, hdr)
		if resp.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("%s private response can be cached", label)
		}
		for _, secret := range []string{proof.DeviceToken, proof.RootID, proof.RootFingerprint, base64.RawURLEncoding.EncodeToString(key[:])} {
			if strings.Contains(resp.Body.String(), secret) {
				t.Fatalf("%s returned private device/Root/request key", label)
			}
		}
	}
	test("valid", route, body, proofHeaders, http.StatusOK)
	for _, variant := range []struct {
		name   string
		path   string
		body   string
		status int
	}{
		{"unknown-field", route, strings.TrimSuffix(body, "}") + `,"elevate":true}`, http.StatusBadRequest},
		{"duplicate-json", route, body + " true", http.StatusBadRequest},
		{"oversized", route, body + strings.Repeat(" ", 900), http.StatusBadRequest},
		{"invalid-op", route, strings.Replace(body, op.ID, "invalid", 1), http.StatusBadRequest},
		{"invalid-key", route, strings.Replace(body, base64.RawURLEncoding.EncodeToString(key[:]), "x", 1), http.StatusBadRequest},
		{"path-leak", route, strings.Replace(body, localPushFirstLeafFixtureName, "../private", 1), http.StatusBadRequest},
		{"query", route + "?request_key=never", body, http.StatusBadRequest},
	} {
		t.Run(variant.name, func(t *testing.T) {
			test(variant.name, variant.path, variant.body, proofHeaders, variant.status)
		})
	}
	ownerOnly := map[string]string{"Content-Type": "application/json", "If-Match": proofHeaders["If-Match"]}
	test("owner-jwt-alone", route, body, ownerOnly, http.StatusForbidden)
	var runs int64
	if err := f.server.DB.Model(&meta.SyncRun{}).
		Where("source_id = ?", f.source.ID).Count(&runs).Error; err != nil || runs != 0 {
		t.Fatalf("private historical route fabricated a SourceRun: %d %v", runs, err)
	}
}
