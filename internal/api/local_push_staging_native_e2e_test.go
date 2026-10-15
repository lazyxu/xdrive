//go:build linux || windows

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushstage"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

// Exercise the real native original reader and the real Gin/PostgreSQL/Local
// temporary-byte receiver and physical SHA256 endpoint in ONE chain. Earlier
// HTTP mock and Server tests independently cover only their own halves.
//
// This is still NOT a committed SourceRun, File, CAS object or real backup.
// The owning device must never obtain any canonical write authority from it.
func TestLocalPushNativeToGinPhysicalStageAndCancellation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		tamper bool
	}{
		{name: "original-to-physical-stage"},
		{name: "temporary-bytes-replaced-before-physical-recheck", tamper: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, app, owner, _, root := setupFilePropertiesTestDB(t)
			if err := db.AutoMigrate(
				&meta.ClientDevice{}, &meta.LocalSourceBinding{},
				&meta.LocalPushStaging{}, &meta.UploadSession{},
				&meta.SyncRun{}, &meta.FileVersion{}, &meta.ContentBlob{},
			); err != nil {
				t.Fatal(err)
			}
			store, err := storage.NewLocal(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			app.Store = store
			app.Auth = auth.New("native-gin-physical-stage-end-to-end", time.Hour)
			app.RefreshTTL = 24 * time.Hour
			gin.SetMode(gin.TestMode)
			jwt, err := app.Auth.Issue(owner.ID, owner.SessionVersion)
			if err != nil {
				t.Fatal(err)
			}
			token := "owning-device-only-physical-staging-test-secret"
			now := time.Now().UTC()
			device := meta.ClientDevice{
				ID: uuid.NewString(), OwnerID: owner.ID,
				Name: "Owning native computer", Platform: runtime.GOOS,
				CredentialHash: deviceCredentialDigest(token),
				CreatedAt:      now, UpdatedAt: now,
			}
			if err := db.Create(&device).Error; err != nil {
				t.Fatal(err)
			}
			target := createFilePropertiesDir(t, db, owner.ID, root.ID, "Native backup target")
			source := meta.Source{
				OwnerID: owner.ID, Name: "Native originals",
				Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
				SyncMode: meta.SourceSyncModeBackup, Status: meta.SourceStatusPaused,
				Revision: 7, TargetNodeID: &target.ID,
			}
			if err := db.Create(&source).Error; err != nil {
				t.Fatal(err)
			}
			originalRoot := filepath.Join(t.TempDir(), "original-files")
			privateConfig := filepath.Join(t.TempDir(), "native-config")
			if err := os.MkdirAll(originalRoot, 0o700); err != nil {
				t.Fatal(err)
			}
			body := bytes.Repeat([]byte("physical-native-original-"), 8192)
			if err := os.WriteFile(filepath.Join(originalRoot, "photo.bin"), body, 0o600); err != nil {
				t.Fatal(err)
			}

			router := app.Router()
			httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tc.tamper && r.Method == http.MethodGet &&
					strings.HasSuffix(r.URL.Path, "/content-preflight") {
					// Simulate an out-of-band same-size overwrite AFTER the
					// authenticated PUT and staged-status readback, BEFORE
					// Server hashes the real file. A stale status must fail.
					p := strings.TrimSuffix(r.URL.Path, "/content-preflight")
					i := strings.LastIndex(p, "/")
					if i < 0 {
						t.Error("missing private server stage identifier")
						http.Error(w, "invalid stage", http.StatusInternalServerError)
						return
					}
					key, keyErr := localPushStageStoreKey(p[i+1:])
					if keyErr != nil {
						t.Errorf("invalid private stage key: %v", keyErr)
						http.Error(w, "invalid stage", http.StatusInternalServerError)
						return
					}
					changed := bytes.Repeat([]byte{0x9f}, len(body))
					if _, putErr := store.Put(r.Context(), key, bytes.NewReader(changed)); putErr != nil {
						t.Errorf("unable to simulate physical stage tampering: %v", putErr)
						http.Error(w, "temporary corruption setup failed", http.StatusInternalServerError)
						return
					}
				}
				router.ServeHTTP(w, r)
			}))
			defer httpServer.Close()

			grant, err := localpush.PrepareRootGrant(
				httpServer.URL, "owner", source.ID, device.ID, originalRoot,
			)
			if err != nil {
				t.Fatal(err)
			}
			if err := localpush.SaveRootGrant(privateConfig, grant); err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&meta.LocalSourceBinding{
				SourceID: source.ID, OwnerID: owner.ID, DeviceID: device.ID,
				RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
				CreatedAt: now, UpdatedAt: now,
			}).Error; err != nil {
				t.Fatal(err)
			}
			journal, err := localpush.BeginInventoryJournal(privateConfig, grant)
			if err != nil {
				t.Fatal(err)
			}
			defer journal.Abort()
			stats, err := (localpush.InventoryScanner{
				IncludeNativeIdentity: true,
				BatchSize:             localpush.DefaultInventoryBatchSize,
			}).ScanInventory(context.Background(), grant, journal.Append)
			if err != nil || !stats.Complete {
				t.Fatalf("native original inventory failed: %+v err=%v", stats, err)
			}
			if _, err := journal.Commit(stats); err != nil {
				t.Fatal(err)
			}
			proof := client.LocalBoundSourceProof{
				DeviceID: device.ID, DeviceToken: token,
				RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
			}
			sum := sha256.Sum256(body)
			digest := hex.EncodeToString(sum[:])
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			receipt, stageErr := localpushstage.StageVerifiedNativeOriginalBytes(
				client.New(httpServer.URL, jwt), ctx, privateConfig,
				grant, source.Revision, proof, "photo.bin", digest,
			)
			var stage meta.LocalPushStaging
			if err := db.Where("source_id = ?", source.ID).Take(&stage).Error; err != nil {
				t.Fatal(err)
			}
			key, err := localPushStageStoreKey(stage.StageID)
			if err != nil {
				t.Fatal(err)
			}
			if stage.SourceID != source.ID || stage.DeviceID != device.ID ||
				stage.RootID != grant.RootID || stage.RootFingerprint != grant.Fingerprint ||
				stage.SourceRevision != 7 || stage.TotalSize != int64(len(body)) ||
				stage.ContentSHA256 != digest {
				t.Fatalf("temporary staging lost authorized original identity: %+v", stage)
			}
			if tc.tamper {
				if stageErr == nil || receipt.StageID != "" ||
					stage.Status != localPushStageCanceled {
					t.Fatalf("modified staged bytes were accepted: receipt=%+v stage=%q err=%v",
						receipt, stage.Status, stageErr)
				}
				if h, openErr := store.Open(context.Background(), key); !os.IsNotExist(openErr) {
					if openErr == nil {
						_ = h.Close()
					}
					t.Fatalf("rejected temporary physical bytes were not removed: %v", openErr)
				}
			} else {
				if stageErr != nil || receipt.StageID != stage.StageID ||
					receipt.SourceID != source.ID || receipt.Revision != 7 ||
					receipt.Size != int64(len(body)) || receipt.SHA256 != digest ||
					stage.Status != localPushStageReady {
					t.Fatalf("native→Gin→physical proof failed: receipt=%+v stage=%q err=%v",
						receipt, stage.Status, stageErr)
				}
				h, err := store.Open(context.Background(), key)
				if err != nil {
					t.Fatal(err)
				}
				got, readErr := io.ReadAll(h)
				_ = h.Close()
				if readErr != nil || !bytes.Equal(got, body) {
					t.Fatalf("Server real temporary disk bytes differ from native original: %v", readErr)
				}
				serialized, err := json.Marshal(receipt)
				if err != nil || string(serialized) != "{}" {
					t.Fatalf("temporary private Agent receipt leaked to JSON: %q err=%v", serialized, err)
				}
			}

			for _, model := range []any{
				&meta.SourceItem{}, &meta.SyncRun{}, &meta.FileVersion{},
				&meta.ContentBlob{}, &meta.UploadSession{},
			} {
				var count int64
				if err := db.Model(model).Count(&count).Error; err != nil || count != 0 {
					t.Fatalf("temporary native stage changed canonical model %T: %d err=%v",
						model, count, err)
				}
			}
			var saved meta.Source
			if err := db.Where("id = ?", source.ID).Take(&saved).Error; err != nil ||
				saved.Status != meta.SourceStatusPaused || saved.Revision != 7 {
				t.Fatalf("native HTTP staging activated Push Source: %+v err=%v", saved, err)
			}
		})
	}
}
