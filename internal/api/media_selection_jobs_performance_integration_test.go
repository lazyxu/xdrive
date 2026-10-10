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
	for _, scale := range []int{10000, 100000} {
		t.Run(fmt.Sprintf("%d", scale), func(t *testing.T) {
			owner := meta.User{Username: fmt.Sprintf("selection-perf-%d", scale), PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
			if err := db.Create(&owner).Error; err != nil {
				t.Fatal(err)
			}
			setup := time.Now()
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
			var nodes []mediaSelectionNode
			if err := db.Model(&meta.Node{}).Select("id,revision").Where("owner_id=?", owner.ID).Order("id").Find(&nodes).Error; err != nil {
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
			profile := newGallerySelectionSQLProfiler()
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
			result := struct {
				Scale      int                                             `json:"scale"`
				Samples    int                                             `json:"samples"`
				SetupMS    int64                                           `json:"fixture_ms"`
				EnqueueMS  int64                                           `json:"enqueue_ms"`
				WorkerMS   int64                                           `json:"worker_ms"`
				Chunks     int                                             `json:"chunks"`
				HeapBefore uint64                                          `json:"heap_before_bytes"`
				HeapAfter  uint64                                          `json:"heap_after_bytes"`
				SQLProfile map[string]map[string]gallerySelectionSQLBucket `json:"sql_profile"`
			}{scale, 1, setupMS, enqueueMS, workerMS, chunks, before.Alloc, after.Alloc, sqlProfile}
			b, _ := json.Marshal(result)
			t.Logf("G07_SELECTION_JOB_BASELINE %s", b)
		})
	}
}
