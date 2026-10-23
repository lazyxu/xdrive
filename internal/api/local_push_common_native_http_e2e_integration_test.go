//go:build linux || windows

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// Real, isolated native-file -> owning HTTP admission -> ordinary bound
// UploadSession/chunks/finalize -> PostgreSQL/CAS -> immutable SQL receipt.
// The only artificial fault is a missing successful HTTP Finalize ACK,
// *after* the real Server committed it. Neither variant activates Desktop
// IPC, a SourceRun, any second file or legacy Stage/Key/Writer retirement.
func TestLocalPushCommonNativeHTTPPhysicalOriginalReplay(t *testing.T) {
	for _, tc := range []struct {
		name            string
		loseFinalizeACK bool
	}{
		{name: "real-native-to-cas-and-replay"},
		{name: "real-commit-with-lost-finalize-ack", loseFinalizeACK: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, server, owner, _, root := setupFilePropertiesTestDB(t)
			if err := db.AutoMigrate(
				&meta.ClientDevice{}, &meta.LocalSourceBinding{},
				&meta.UploadSession{}, &meta.UploadPart{}, &meta.FileVersion{},
				&meta.ContentBlob{}, &meta.Share{}, &meta.AuditEvent{},
				&meta.LocalPushStaging{}, &meta.LocalPushOperationIntent{},
				&meta.LocalPushOperationTerminalReceipt{},
				&meta.LocalPushOperationStageBinding{},
				&meta.LocalPushFirstLeafOperationCommit{},
				&meta.LocalPushFileTerminal{},
				&meta.LocalPushNativeTerminalChallenge{},
				&meta.LocalPushCASPrepareIntent{},
				&meta.LocalPushFirstDirectoryChallenge{},
				&meta.LocalPushCommonUploadOperation{},
			); err != nil {
				t.Fatal(err)
			}
			rawStore, err := storage.NewLocal(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			server.Store = rawStore
			server.Auth = auth.New("native-bound-original-integration", time.Hour)
			server.RefreshTTL = 24 * time.Hour
			server.MaxUploadBytes = 64 << 20
			gin.SetMode(gin.TestMode)
			token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
			if err != nil {
				t.Fatal(err)
			}
			deviceSecret := "owning-native-device-fixture-credential-32-plus"
			device := meta.ClientDevice{
				ID: uuid.NewString(), OwnerID: owner.ID,
				Name: "owning native Agent", Platform: runtime.GOOS,
				CredentialHash: deviceCredentialDigest(deviceSecret),
			}
			if err := db.Create(&device).Error; err != nil {
				t.Fatal(err)
			}
			parent := createFilePropertiesDir(t, db, owner.ID, root.ID, "Native target")
			source := meta.Source{
				OwnerID: owner.ID, Name: "Local original",
				Kind:      meta.SourceKindLocalFolder,
				Direction: meta.SourceDirectionPush,
				SyncMode:  meta.SourceSyncModeBackup,
				Status:    meta.SourceStatusPaused, Revision: 7,
				TargetNodeID: &parent.ID,
			}
			if err := db.Create(&source).Error; err != nil {
				t.Fatal(err)
			}
			router := server.Router()
			var chunkPUTs atomic.Int32
			var bindPOSTs atomic.Int32
			var finalizedPOSTs atomic.Int32
			var finalizeACKLost atomic.Bool
			httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodPut && strings.Contains(r.URL.Path, "/chunks/") {
					chunkPUTs.Add(1)
				}
				if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/local-common-upload/bind") {
					bindPOSTs.Add(1)
				}
				if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/finalize") {
					finalizedPOSTs.Add(1)
					if tc.loseFinalizeACK {
						// A real first Finalize commits SQL/CAS. Suppress
						// *every* Finalize ACK, including uploader retries,
						// so durable original Operation readback (not a
						// later generic Session result) is essential.
						if !finalizeACKLost.Swap(true) {
							rec := httptest.NewRecorder()
							router.ServeHTTP(rec, r)
							if rec.Code < 200 || rec.Code >= 300 {
								for k, values := range rec.Header() {
									for _, value := range values {
										w.Header().Add(k, value)
									}
								}
								w.WriteHeader(rec.Code)
								_, _ = w.Write(rec.Body.Bytes())
								return
							}
						}
						http.Error(w, "simulated missing Finalize ACK", http.StatusServiceUnavailable)
						return
					}
				}
				router.ServeHTTP(w, r)
			}))
			defer httpServer.Close()

			originalDir := filepath.Join(t.TempDir(), "original")
			if err := os.MkdirAll(originalDir, 0o700); err != nil {
				t.Fatal(err)
			}
			contents := bytes.Repeat([]byte("native-v2-physical-source-"), 3072)
			if err := os.WriteFile(filepath.Join(originalDir, "photo.bin"), contents, 0o600); err != nil {
				t.Fatal(err)
			}
			privateConfig := filepath.Join(t.TempDir(), "agent")
			grant, err := localpush.PrepareRootGrant(
				httpServer.URL, owner.Username, source.ID, device.ID, originalDir)
			if err != nil || !grant.StrongIdentity {
				t.Fatalf("strong owning Root unavailable: %+v %v", grant, err)
			}
			if err := localpush.SaveRootGrant(privateConfig, grant); err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&meta.LocalSourceBinding{
				SourceID: source.ID, OwnerID: owner.ID, DeviceID: device.ID,
				RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
			}).Error; err != nil {
				t.Fatal(err)
			}
			snapshot, summary, err := localpush.ScanInventoryToJournal(
				context.Background(), privateConfig, grant,
				localpush.InventoryScanner{IncludeNativeIdentity: true, BatchSize: 100})
			if err != nil || !summary.Complete || summary.MissingInferenceSafe {
				t.Fatalf("CURRENT Inventory not trustworthy: %+v %v", summary, err)
			}
			plan, err := localpush.PrepareVerifiedCommonUploadPlan(
				context.Background(), privateConfig, grant, token, source.Revision,
				snapshot.SnapshotSHA256, "photo.bin",
				localpushcommon.Target{ParentID: parent.ID, Name: "photo.bin"})
			if err != nil {
				t.Fatalf("original Operation was not durable: %v", err)
			}
			proof := client.LocalBoundSourceProof{
				DeviceID: device.ID, DeviceToken: deviceSecret,
				RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
			}
			api := client.New(httpServer.URL, token)
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			sum := sha256.Sum256(contents)
			digest := hex.EncodeToString(sum[:])
			if plan.ContentSHA256 != digest || plan.Size != int64(len(contents)) {
				t.Fatalf("native Plan digest/size mismatches original: %+v", plan)
			}
			receipt, err := localpush.UploadVerifiedCommonNativeOne(
				ctx, privateConfig, grant, snapshot.SnapshotSHA256, plan, api, proof, nil)
			if err != nil || !receipt.Committed ||
				receipt.OperationID != plan.OperationID ||
				receipt.ContentSHA256 != digest || receipt.Size != int64(len(contents)) ||
				receipt.NodeID == 0 || receipt.NodeRevision != 1 {
				t.Fatalf("real bound common upload did not produce original SQL receipt: %+v %v", receipt, err)
			}
			if chunkPUTs.Load() != 1 || bindPOSTs.Load() != 1 ||
				finalizedPOSTs.Load() == 0 || (tc.loseFinalizeACK && (!finalizeACKLost.Load() || finalizedPOSTs.Load() < 2)) {
				t.Fatalf("wrong real HTTP order/counts: chunks=%d bind=%d finalize=%d lost=%t",
					chunkPUTs.Load(), bindPOSTs.Load(), finalizedPOSTs.Load(), finalizeACKLost.Load())
			}
			var file meta.File
			if err := db.Where("node_id = ?", receipt.NodeID).Take(&file).Error; err != nil ||
				file.SHA256 != digest || file.Size != int64(len(contents)) ||
				file.StorageKey == "" {
				t.Fatalf("committed File metadata differs from native bytes: %+v %v", file, err)
			}
			r, err := rawStore.Open(ctx, file.StorageKey)
			if err != nil {
				t.Fatalf("physical CAS was not created: %v", err)
			}
			physical, readErr := io.ReadAll(r)
			_ = r.Close()
			if readErr != nil || !bytes.Equal(physical, contents) {
				t.Fatalf("physical CAS differs from native original: %v", readErr)
			}
			var operations, nodes, versions int64
			db.Model(&meta.LocalPushCommonUploadOperation{}).Where("operation_id = ?", plan.OperationID).Count(&operations)
			db.Model(&meta.Node{}).Where("parent_id = ?", parent.ID).Count(&nodes)
			db.Model(&meta.FileVersion{}).Count(&versions)
			if operations != 1 || nodes != 1 {
				t.Fatalf("duplicate original file/operation: operations=%d nodes=%d", operations, nodes)
			}
			again, err := localpush.UploadVerifiedCommonNativeOne(
				ctx, privateConfig, grant, snapshot.SnapshotSHA256, plan, api, proof, nil)
			if err != nil || again != receipt || chunkPUTs.Load() != 1 ||
				bindPOSTs.Load() != 1 {
				t.Fatalf("original committed Operation was reuploaded: first=%+v second=%+v err=%v chunks=%d binds=%d",
					receipt, again, err, chunkPUTs.Load(), bindPOSTs.Load())
			}
			var afterOps, afterNodes, afterVersions int64
			db.Model(&meta.LocalPushCommonUploadOperation{}).Where("operation_id = ?", plan.OperationID).Count(&afterOps)
			db.Model(&meta.Node{}).Where("parent_id = ?", parent.ID).Count(&afterNodes)
			db.Model(&meta.FileVersion{}).Count(&afterVersions)
			if afterOps != 1 || afterNodes != 1 || afterVersions != versions {
				t.Fatalf("replay changed SQL rows: op=%d node=%d versions=%d→%d",
					afterOps, afterNodes, versions, afterVersions)
			}
		})
	}
}
