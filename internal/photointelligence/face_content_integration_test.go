package photointelligence

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Keyed fixtures catch accidental reuse of the face result fingerprint as the
// signed preview/ETag fingerprint in Smart/OCR and semantic model transports.
func bindTestOriginalContent(t *testing.T, db *gorm.DB, asset *meta.PhotoAsset, node meta.Node, file meta.File) {
	t.Helper()
	identity, err := photoasset.IdentifyOriginals(asset.Kind, []photoasset.OriginalResource{{Role: "primary", SHA256: file.SHA256, Size: file.Size}})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(asset).Updates(map[string]any{"content_key": identity.Key, "content_manifest": identity.Manifest, "evidence_key": identity.Key}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.PhotoResource{AssetID: asset.ID, ResourceKind: meta.PhotoResourceKindNode, NodeID: node.ID,
		Role: "primary", Name: node.Name, MediaKind: meta.MediaKindImage, SHA256: file.SHA256, Size: file.Size}).Error; err != nil {
		t.Fatal(err)
	}
}

func faceContentTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	conn, err := base.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	schema := "face_content_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := base.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = base.Exec(`DROP SCHEMA "` + schema + `" CASCADE`).Error })
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
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.File{}, &meta.MediaMetadata{}, &meta.MediaDerivedResource{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SourceCollection{}, &meta.SourceCollectionItem{}, &meta.PhotoAsset{}, &meta.PhotoAssetOccurrence{}, &meta.PhotoAssetIdentityAlias{},
		&meta.PhotoMetadata{}, &meta.PhotoResource{}, &meta.PhotoCollection{}, &meta.PhotoCollectionAsset{}, &meta.PhotoFace{}, &meta.PhotoAnalysisState{}); err != nil {
		t.Fatal(err)
	}
	if err := photoasset.InstallContentIdentitySchema(db); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestFaceContentClaimsSurviveOnlyEqualOriginals(t *testing.T) {
	for _, scenario := range []string{"source handoff", "replacement", "newer attempt", "cancelled attempt", "revoked session"} {
		t.Run(scenario, func(t *testing.T) {
			db := faceContentTestDB(t)
			ctx := context.Background()
			owner := meta.User{Username: "face-content", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
			if err := db.Create(&owner).Error; err != nil {
				t.Fatal(err)
			}
			sha := strings.Repeat("a", 64)
			nodes := make([]meta.Node, 2)
			for i := range nodes {
				nodes[i] = meta.Node{OwnerID: owner.ID, Name: fmt.Sprintf("portrait-%d.jpg", i), Type: meta.NodeTypeFile, Revision: 1}
				for _, record := range []any{&nodes[i]} {
					if err := db.Create(record).Error; err != nil {
						t.Fatal(err)
					}
				}
				if err := db.Create(&meta.File{NodeID: nodes[i].ID, Size: 100, SHA256: sha, StorageKey: fmt.Sprintf("portrait-%d", i)}).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Create(&meta.MediaMetadata{NodeID: nodes[i].ID, OwnerID: owner.ID, NodeRevision: 1, SHA256: sha, IndexState: meta.MediaIndexStateReady, MediaKind: meta.MediaKindImage}).Error; err != nil {
					t.Fatal(err)
				}
			}
			reconcile := func() {
				t.Helper()
				if _, err := photoasset.ReconcileOwner(ctx, db, owner.ID); err != nil {
					t.Fatal(err)
				}
			}
			reconcile()
			var asset meta.PhotoAsset
			if err := db.Where("owner_id = ? AND content_key = ?", owner.ID, "sha256:"+sha).First(&asset).Error; err != nil {
				t.Fatal(err)
			}
			info := testFaceAnalyzerInfo()
			now := time.Now().UTC()
			analyzer := &fakeFaceAnalyzer{info: info}
			runner := &FaceRunner{DB: db, Analyzer: analyzer, PreviewURL: func(context.Context, uint64, uint64, uint64, uint64) (string, error) {
				return "http://server:8080/api/v1/media-analysis-preview/1?ticket=test", nil
			}}
			var newer []meta.PhotoAnalysisState
			analyzer.onAnalyze = func() {
				switch scenario {
				case "source handoff":
					if err := db.Transaction(func(tx *gorm.DB) error {
						if err := tx.Where("node_id = ?", nodes[0].ID).Delete(&meta.File{}).Error; err != nil {
							return err
						}
						return tx.Delete(&meta.Node{}, nodes[0].ID).Error
					}); err != nil {
						t.Fatal(err)
					}
					reconcile()
				case "replacement":
					for _, node := range nodes {
						if err := db.Model(&meta.File{}).Where("node_id = ?", node.ID).Update("sha256", strings.Repeat("b", 64)).Error; err != nil {
							t.Fatal(err)
						}
						if err := db.Model(&meta.Node{}).Where("id = ?", node.ID).Update("revision", 2).Error; err != nil {
							t.Fatal(err)
						}
						if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", node.ID).Updates(map[string]any{"sha256": strings.Repeat("b", 64), "node_revision": 2}).Error; err != nil {
							t.Fatal(err)
						}
					}
					reconcile()
				case "newer attempt":
					var states []meta.PhotoAnalysisState
					if err := db.Where("asset_id = ?", asset.ID).Find(&states).Error; err != nil {
						t.Fatal(err)
					}
					var err error
					newer, err = runner.markFaceAnalysisRunning(ctx, asset.ID, FaceDetectorAnalyzerVersion(info), FaceEmbeddingAnalyzerVersion(info), states[0].InputFingerprint, now.Add(time.Second))
					if err != nil {
						t.Fatal(err)
					}
				case "cancelled attempt":
					if err := db.Model(&meta.PhotoAnalysisState{}).Where("asset_id = ?", asset.ID).Update("state", meta.PhotoAnalysisStateStale).Error; err != nil {
						t.Fatal(err)
					}
				case "revoked session":
					if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).Update("session_version", 2).Error; err != nil {
						t.Fatal(err)
					}
				}
			}
			processed, err := runner.RunOwnerBatch(ctx, owner.ID, 1)
			if processed != 1 {
				t.Fatalf("processed=%d error=%v", processed, err)
			}
			var states []meta.PhotoAnalysisState
			if err := db.Where("asset_id = ?", asset.ID).Order("kind ASC").Find(&states).Error; err != nil {
				t.Fatal(err)
			}
			var faces int64
			if err := db.Model(&meta.PhotoFace{}).Where("asset_id = ?", asset.ID).Count(&faces).Error; err != nil {
				t.Fatal(err)
			}
			if scenario == "source handoff" {
				if err != nil || faces != 1 {
					t.Fatalf("equal-content handoff lost analysis: %d %v", faces, err)
				}
				for _, state := range states {
					if state.State != meta.PhotoAnalysisStateReady || !strings.Contains(state.InputFingerprint, asset.ContentKey) {
						t.Fatalf("result not bound to immutable content: %+v", state)
					}
				}
				analyzer.onAnalyze = nil
				if count, err := runner.RunOwnerBatch(ctx, owner.ID, 1); err != nil || count != 0 {
					t.Fatalf("source change unnecessarily reanalyzed same content: %d %v", count, err)
				}
			} else {
				if err == nil || faces != 0 {
					t.Fatalf("late result escaped claim/content guard: faces=%d err=%v", faces, err)
				}
				for _, state := range states {
					if state.State == meta.PhotoAnalysisStateReady {
						t.Fatal("invalid late result marked ready")
					}
					if scenario == "newer attempt" && (state.Attempt != newer[0].Attempt || state.State != meta.PhotoAnalysisStateRunning) {
						t.Fatalf("late failure overwrote newer attempt: %+v", state)
					}
					if scenario == "cancelled attempt" && state.State != meta.PhotoAnalysisStateStale {
						t.Fatalf("late failure revived cancelled attempt: %+v", state)
					}
				}
			}
		})
	}
}
