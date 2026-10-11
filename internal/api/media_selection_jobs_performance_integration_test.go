package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// Deliberately only PostgreSQL/Go metadata; never claim original CAS, Web
// or Desktop rendering from this measurement.
func TestGallerySelectionJobsReal10k100k(t *testing.T) {
	if os.Getenv("XD_GALLERY_SELECTION_JOB_PERF") != "1" {
		t.Skip("only dedicated Gallery G07 benchmark enables 10k/100k")
	}
	db := newDurableSelectionJobDB(t)
	// This opt-in scenario deliberately retains the original 100-item Worker
	// SQL, transaction/cancellation, profile and result checks.
	mixed := os.Getenv("XD_GALLERY_SELECTION_MIXED_100K_PERF") == "1"
	if mixed {
		if err := db.AutoMigrate(&meta.PhotoResource{}); err != nil {
			t.Fatal(err)
		}
	}
	for _, scale := range []int{10000, 100000} {
		t.Run(fmt.Sprintf("%d", scale), func(t *testing.T) {
			owner := meta.User{Username: fmt.Sprintf("selection-perf-%d", scale), PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
			if err := db.Create(&owner).Error; err != nil {
				t.Fatal(err)
			}
			setup := time.Now()
			fixtureKind := "original_all_images"
			images, videos, livePhotos := scale, 0, 0
			physicalNodes := scale
			var motionResources int64
			if mixed {
				fixtureKind = "mixed_70_image_15_video_15_live"
				images = scale * 70 / 100
				videos = scale * 15 / 100
				livePhotos = scale - images - videos
				physicalNodes = scale + livePhotos
				// The primary 100k assets carry real PostgreSQL identities and
				// heterogeneous kinds. The 15k motion companions add separate
				// Nodes/PhotoResources, but no synthetic media bytes or codec decode.
				if err := db.Exec(`INSERT INTO xd_nodes(owner_id,name,type,revision,created_at,updated_at)
SELECT ?, CASE WHEN s <= ? THEN 'photo-'||s::text||'.jpg'
               WHEN s <= ? THEN 'video-'||s::text||'.mp4'
               ELSE 'live-'||s::text||'.jpg' END,
'file',1,NOW(),NOW()
FROM generate_series(1,?) AS s`, owner.ID, images, images+videos, scale).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Exec(`INSERT INTO xd_photo_assets(owner_id,primary_node_id,kind,evidence_key,created_at,updated_at)
SELECT n.owner_id,n.id,
       CASE WHEN n.name LIKE 'video-%' THEN ?
            WHEN n.name LIKE 'live-%' THEN ?
            ELSE ? END,
       'mixed-selection-perf:'||n.id::text,NOW(),NOW()
FROM xd_nodes AS n WHERE n.owner_id=?`,
					meta.PhotoAssetKindVideo, meta.PhotoAssetKindLivePhoto,
					meta.PhotoAssetKindImage, owner.ID).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Exec(`INSERT INTO xd_photo_metadata(asset_id,media_kind,mime_type,created_at,updated_at)
SELECT a.id, CASE WHEN a.kind=? THEN 'video' ELSE 'image' END,
       CASE WHEN a.kind=? THEN 'video/mp4' ELSE 'image/jpeg' END,
       NOW(),NOW()
FROM xd_photo_assets AS a WHERE a.owner_id=?`,
					meta.PhotoAssetKindVideo, meta.PhotoAssetKindVideo, owner.ID).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Exec(`INSERT INTO xd_nodes(owner_id,name,type,revision,created_at,updated_at)
SELECT ?, 'motion-'||s::text||'.mov','file',1,NOW(),NOW()
FROM generate_series(?::integer,?::integer) AS s`,
					owner.ID, images+videos+1, scale).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Exec(`INSERT INTO xd_photo_resources
(asset_id,resource_kind,node_id,role,name,media_kind,mime_type,created_at,updated_at)
SELECT a.id,'node',p.id,'primary',p.name,
       CASE WHEN a.kind=? THEN 'video' ELSE 'image' END,
       CASE WHEN a.kind=? THEN 'video/mp4' ELSE 'image/jpeg' END,
       NOW(),NOW()
FROM xd_photo_assets AS a JOIN xd_nodes AS p ON p.id=a.primary_node_id
WHERE a.owner_id=?`,
					meta.PhotoAssetKindVideo, meta.PhotoAssetKindVideo, owner.ID).Error; err != nil {
					t.Fatal(err)
				}
				// Fixture-only linear-time set join on the explicit pairing
				// number: avoid matching every 15k Live asset against all
				// 115k Nodes. This never changes production Worker SQL.
				if err := db.Exec(`WITH live_assets AS MATERIALIZED (
 SELECT a.id AS asset_id,
        split_part(split_part(p.name,'-',2),'.',1)::integer AS pair_number
 FROM xd_photo_assets AS a
 JOIN xd_nodes AS p ON p.id=a.primary_node_id
 WHERE a.owner_id=? AND a.kind=?
), motion_nodes AS MATERIALIZED (
 SELECT m.id,m.name,
        split_part(split_part(m.name,'-',2),'.',1)::integer AS pair_number
 FROM xd_nodes AS m
 WHERE m.owner_id=? AND m.name LIKE 'motion-%'
)
INSERT INTO xd_photo_resources
(asset_id,resource_kind,node_id,role,name,media_kind,mime_type,created_at,updated_at)
SELECT a.asset_id,'node',m.id,'motion',m.name,'video','video/quicktime',NOW(),NOW()
FROM live_assets AS a JOIN motion_nodes AS m ON m.pair_number=a.pair_number`,
					owner.ID, meta.PhotoAssetKindLivePhoto, owner.ID).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Table("xd_photo_resources AS r").
					Joins("JOIN xd_photo_assets AS a ON a.id = r.asset_id").
					Where("a.owner_id = ? AND r.role = ?", owner.ID, "motion").
					Count(&motionResources).Error; err != nil {
					t.Fatal(err)
				}
				if motionResources != int64(livePhotos) {
					t.Fatalf("mixed Live Photo motion resources=%d want=%d", motionResources, livePhotos)
				}
				var mismatchedMotion int64
				if err := db.Table("xd_photo_resources AS r").
					Joins("JOIN xd_photo_assets AS a ON a.id = r.asset_id").
					Joins("JOIN xd_nodes AS p ON p.id = a.primary_node_id").
					Where("a.owner_id = ? AND r.role = ? AND r.name <> ('motion-' || split_part(split_part(p.name,'-',2),'.',1) || '.mov')", owner.ID, "motion").
					Count(&mismatchedMotion).Error; err != nil || mismatchedMotion != 0 {
					t.Fatalf("crossed Live Photo pairs=%d err=%v", mismatchedMotion, err)
				}
			} else {
				if err := db.Exec(`INSERT INTO xd_nodes(owner_id,name,type,revision,created_at,updated_at)
     SELECT ?, 'photo-'||s::text||'.jpg','file',1,NOW(),NOW()
     FROM generate_series(1,?) AS s`, owner.ID, scale).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Exec(`INSERT INTO xd_photo_assets(owner_id,primary_node_id,kind,evidence_key,created_at,updated_at)
     SELECT owner_id,id,'image','selection-perf:'||id::text,NOW(),NOW()
     FROM xd_nodes WHERE owner_id=?`, owner.ID).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Exec(`INSERT INTO xd_photo_metadata(asset_id,media_kind,mime_type,created_at,updated_at)
     SELECT id,'image','image/jpeg',NOW(),NOW()
     FROM xd_photo_assets WHERE owner_id=?`, owner.ID).Error; err != nil {
					t.Fatal(err)
				}
			}
			var physicalCount int64
			if err := db.Model(&meta.Node{}).Where("owner_id = ?", owner.ID).
				Count(&physicalCount).Error; err != nil || physicalCount != int64(physicalNodes) {
				t.Fatalf("physical nodes=%d want=%d err=%v", physicalCount, physicalNodes, err)
			}
			var nodes []mediaSelectionNode
			selectionQuery := db.Model(&meta.Node{}).Select("id,revision").Where("owner_id=?", owner.ID)
			if mixed {
				selectionQuery = selectionQuery.Where("name NOT LIKE ?", "motion-%")
			}
			if err := selectionQuery.Order("id").Find(&nodes).Error; err != nil {
				t.Fatal(err)
			}
			if len(nodes) != scale {
				t.Fatalf("fixture nodes=%d expected=%d", len(nodes), scale)
			}
			memberIDs := make(map[uint64]struct{}, scale)
			for _, node := range nodes {
				memberIDs[node.ID] = struct{}{}
			}
			setupMS := time.Since(setup).Milliseconds()
			token := uuid.NewString()
			session := &mediaSelectionSnapshot{ownerID: owner.ID, nodes: nodes, memberIDs: memberIDs, excluded: map[uint64]struct{}{}, version: 1, createdAt: time.Now(), expiresAt: time.Now().Add(15 * time.Minute)}
			profile := newGallerySelectionDetailedProfiler()
			server := &Server{DB: db.Session(&gorm.Session{Logger: profile}), mediaSelections: map[string]*mediaSelectionSnapshot{token: session}}
			c, rec := newDurableJobContext(owner.ID, http.MethodPost, "/api/v1/media/selection-snapshots/"+token+"/jobs", `{"version":1,"action":"favorite","favorite":true,"confirm":true}`)
			c.Params = gin.Params{{Key: "token", Value: token}}
			runtime.GC()
			var before, after runtime.MemStats
			runtime.ReadMemStats(&before)
			started := time.Now()
			server.createMediaSelectionJob(c)
			enqueueMS := time.Since(started).Milliseconds()
			if rec.Code != http.StatusAccepted {
				t.Fatalf("enqueue HTTP %d %s", rec.Code, rec.Body.String())
			}
			var job meta.MediaSelectionJob
			if err := json.Unmarshal(rec.Body.Bytes(), &job); err != nil {
				t.Fatal(err)
			}
			if job.TotalItems != int64(scale) || server.mediaSelections[token] != nil {
				t.Fatalf("enqueue frozen mismatch: %+v", job)
			}
			statsMode := "original"
			statsRefreshMS := int64(0)
			if os.Getenv("XD_GALLERY_WORKER_FIXTURE_ANALYZE") == "1" {
				statsMode = "analyzed"
				statsStarted := time.Now()
				for _, table := range []string{"xd_nodes", "xd_photo_assets"} {
					if err := db.Exec("ANALYZE " + table).Error; err != nil {
						t.Fatal(err)
					}
				}
				statsRefreshMS = time.Since(statsStarted).Milliseconds()
			}
			// ANALYZE is performed only in this synthetic test schema,
			// outside the original durable Worker timing window. The Server
			// receives unchanged production SQL, retries and row-level locks.
			profile.setPhase("worker")
			runStarted := time.Now()
			chunks := 0
			for ; chunks < (scale/mediaSelectionJobChunk)+5; chunks++ {
				progressed, err := server.processNextMediaSelectionJob(c.Request.Context())
				if err != nil || !progressed {
					t.Fatalf("worker chunk=%d progressed=%v err=%v", chunks, progressed, err)
				}
				if err := db.Where("id=?", job.ID).Take(&job).Error; err != nil {
					t.Fatal(err)
				}
				if job.Status == mediaSelectionJobCompleted || job.Status == mediaSelectionJobPartial {
					chunks++
					break
				}
			}
			workerMS := time.Since(runStarted).Milliseconds()
			runtime.ReadMemStats(&after)
			if job.Status != mediaSelectionJobCompleted || job.ProcessedItems != int64(scale) || job.SucceededItems != int64(scale) || job.FailedItems != 0 {
				t.Fatalf("worker outcome mismatch %+v", job)
			}
			var changed int64
			if err := db.Table("xd_photo_assets AS a").Joins("JOIN xd_photo_metadata AS m ON m.asset_id=a.id").Where("a.owner_id=? AND m.favorite=?", owner.ID, true).Count(&changed).Error; err != nil {
				t.Fatal(err)
			}
			if changed != int64(scale) {
				t.Fatalf("changed=%d wanted=%d", changed, scale)
			}
			sqlProfile := profile.snapshot()
			if sqlProfile["enqueue"]["INSERT"].Statements < int64(scale/mediaSelectionJobChunk) ||
				sqlProfile["worker"]["UPDATE"].Statements == 0 {
				t.Fatalf("missing production enqueue/worker SQL observations: %+v", sqlProfile)
			}
			queryDetail := profile.selectDetailSnapshot()
			for _, name := range []string{"jobs", "items", "nodes", "assets", "metadata"} {
				if queryDetail[name].Statements != scale/mediaSelectionJobChunk {
					t.Fatalf("expected %d real %s SELECTs, got %+v",
						scale/mediaSelectionJobChunk, name, queryDetail[name])
				}
			}
			if len(queryDetail) != 5 {
				t.Fatalf("unexpected Worker SELECT stage: %+v", queryDetail)
			}
			result := struct {
				Scale              int                                             `json:"scale"`
				Samples            int                                             `json:"samples"`
				SetupMS            int64                                           `json:"fixture_ms"`
				EnqueueMS          int64                                           `json:"enqueue_ms"`
				WorkerMS           int64                                           `json:"worker_ms"`
				Chunks             int                                             `json:"chunks"`
				HeapBefore         uint64                                          `json:"heap_before_bytes"`
				HeapAfter          uint64                                          `json:"heap_after_bytes"`
				SQLProfile         map[string]map[string]gallerySelectionSQLBucket `json:"sql_profile"`
				WorkerSELECTDetail map[string]galleryWorkerSQLDetail               `json:"worker_select_detail"`

				StatsMode string `json:"stats_mode"`

				StatsRefreshMS  int64  `json:"stats_refresh_ms"`
				FixtureKind     string `json:"fixture_kind"`
				LogicalAssets   int    `json:"logical_assets"`
				PhysicalNodes   int    `json:"physical_nodes"`
				Images          int    `json:"images"`
				Videos          int    `json:"videos"`
				LivePhotos      int    `json:"live_photos"`
				MotionResources int64  `json:"motion_resources"`
			}{scale, 1, setupMS, enqueueMS, workerMS, chunks, before.Alloc, after.Alloc, sqlProfile, queryDetail, statsMode, statsRefreshMS, fixtureKind, scale, physicalNodes, images, videos, livePhotos, motionResources}
			b, _ := json.Marshal(result)
			t.Logf("G07_SELECTION_JOB_BASELINE %s", b)
		})
	}
}
