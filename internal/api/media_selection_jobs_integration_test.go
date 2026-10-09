package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func newDurableSelectionJobDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	rootSQL, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rootSQL.Close() })
	schema := "media_jobs_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error })
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
	sqlDB.SetMaxOpenConns(3)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&meta.User{}, &meta.Node{}, &meta.PhotoAsset{},
		&meta.PhotoMetadata{}, &meta.MediaSelectionJob{}, &meta.MediaSelectionJobItem{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func newDurableJobContext(uid uint64, method, path, body string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, path, strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("userID", uid)
	return c, rec
}

func TestDurableSelectionJobsPartialCancelAndRetryPostgres(t *testing.T) {
	db := newDurableSelectionJobDB(t)
	gin.SetMode(gin.TestMode)
	owner := meta.User{Username: "media-job-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	other := meta.User{Username: "media-job-other", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	for _, u := range []*meta.User{&owner, &other} {
		if err := db.Create(u).Error; err != nil {
			t.Fatal(err)
		}
	}
	node1 := meta.Node{OwnerID: owner.ID, Type: meta.NodeTypeFile, Name: "valid.jpg", Revision: 2}
	node2 := meta.Node{OwnerID: owner.ID, Type: meta.NodeTypeFile, Name: "stale.jpg", Revision: 5}
	node3 := meta.Node{OwnerID: other.ID, Type: meta.NodeTypeFile, Name: "cross-tenant.jpg", Revision: 1}
	for _, node := range []*meta.Node{&node1, &node2, &node3} {
		if err := db.Create(node).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{OwnerID: node.OwnerID, PrimaryNodeID: node.ID,
			Kind: meta.PhotoAssetKindImage, EvidenceKey: fmt.Sprintf("job:%d", node.ID)}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{AssetID: asset.ID, MediaKind: meta.MediaKindImage}).Error; err != nil {
			t.Fatal(err)
		}
	}
	token := uuid.NewString()
	frozen := []mediaSelectionNode{
		{ID: node1.ID, Revision: 2},
		{ID: node2.ID, Revision: 4}, // intentionally stale
		{ID: node3.ID, Revision: 1}, // intentionally foreign
	}
	session := &mediaSelectionSnapshot{
		ownerID: owner.ID, nodes: frozen, memberIDs: map[uint64]struct{}{
			node1.ID: {}, node2.ID: {}, node3.ID: {},
		}, excluded: map[uint64]struct{}{}, version: 7,
		expiresAt: time.Now().Add(time.Minute),
	}
	s := &Server{DB: db, mediaSelections: map[string]*mediaSelectionSnapshot{token: session}}
	urlPath := "/api/v1/media/selection-snapshots/" + token + "/jobs"
	c, rec := newDurableJobContext(owner.ID, http.MethodPost, urlPath,
		`{"version":6,"action":"favorite","favorite":true,"confirm":true}`)
	c.Params = gin.Params{{Key: "token", Value: token}}
	s.createMediaSelectionJob(c)
	if rec.Code != http.StatusConflict {
		t.Fatalf("stale version status=%d body=%s", rec.Code, rec.Body.String())
	}
	c, rec = newDurableJobContext(owner.ID, http.MethodPost, urlPath,
		`{"version":7,"action":"favorite","favorite":true,"confirm":true}`)
	c.Params = gin.Params{{Key: "token", Value: token}}
	s.createMediaSelectionJob(c)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("enqueue status=%d body=%s", rec.Code, rec.Body.String())
	}
	var queued meta.MediaSelectionJob
	if err := json.Unmarshal(rec.Body.Bytes(), &queued); err != nil {
		t.Fatal(err)
	}
	if queued.TotalItems != 3 || queued.Status != mediaSelectionJobQueued || s.mediaSelections[token] != nil {
		t.Fatalf("queue did not persist and consume token: %+v", queued)
	}
	progressed, err := s.processNextMediaSelectionJob(context.Background())
	if err != nil || !progressed {
		t.Fatalf("worker progressed=%v err=%v", progressed, err)
	}
	var done meta.MediaSelectionJob
	if err := db.Where("id = ?", queued.ID).Take(&done).Error; err != nil {
		t.Fatal(err)
	}
	if done.Status != mediaSelectionJobPartial || done.ProcessedItems != 3 ||
		done.SucceededItems != 1 || done.FailedItems != 2 {
		t.Fatalf("partial outcome=%+v", done)
	}
	var failures []meta.MediaSelectionJobItem
	if err := db.Where("job_id = ? AND status = ?", done.ID, mediaSelectionItemFailed).
		Order("node_id").Find(&failures).Error; err != nil {
		t.Fatal(err)
	}
	if len(failures) != 2 {
		t.Fatalf("failed items=%+v", failures)
	}
	byNode := map[uint64]string{}
	for _, row := range failures {
		byNode[row.NodeID] = row.FailureCode
	}
	if byNode[node2.ID] != "stale_revision" || byNode[node3.ID] != "node_unavailable" {
		t.Fatalf("failure codes=%v", byNode)
	}
	var ownerAsset, foreignAsset meta.PhotoAsset
	if err := db.Where("primary_node_id = ?", node1.ID).Take(&ownerAsset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("primary_node_id = ?", node3.ID).Take(&foreignAsset).Error; err != nil {
		t.Fatal(err)
	}
	var ownerMeta, foreignMeta meta.PhotoMetadata
	if err := db.Where("asset_id = ?", ownerAsset.ID).Take(&ownerMeta).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("asset_id = ?", foreignAsset.ID).Take(&foreignMeta).Error; err != nil {
		t.Fatal(err)
	}
	if !ownerMeta.Favorite || foreignMeta.Favorite {
		t.Fatal("cross-owner favorite update or valid favorite did not persist")
	}

	c, rec = newDurableJobContext(other.ID, http.MethodGet, "/api/v1/media/selection-jobs/"+done.ID, "")
	c.Params = gin.Params{{Key: "id", Value: done.ID}}
	s.getMediaSelectionJob(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("other user leaked job status=%d", rec.Code)
	}
	c, rec = newDurableJobContext(owner.ID, http.MethodPost, "/api/v1/media/selection-jobs/"+done.ID+"/retry", "")
	c.Params = gin.Params{{Key: "id", Value: done.ID}}
	s.retryMediaSelectionJob(c)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("retry status=%d body=%s", rec.Code, rec.Body.String())
	}
	var retried meta.MediaSelectionJob
	if err := json.Unmarshal(rec.Body.Bytes(), &retried); err != nil {
		t.Fatal(err)
	}
	if retried.TotalItems != 2 || retried.RetryOfID != done.ID {
		t.Fatalf("retry must retain only failed frozen revisions %+v", retried)
	}
	if progressed, err := s.processNextMediaSelectionJob(context.Background()); !progressed || err != nil {
		t.Fatalf("retry worker progressed=%v err=%v", progressed, err)
	}
	if err := db.Where("id = ?", retried.ID).Take(&retried).Error; err != nil {
		t.Fatal(err)
	}
	if retried.Status != mediaSelectionJobPartial || retried.SucceededItems != 0 || retried.FailedItems != 2 {
		t.Fatalf("retry must not auto-rebase stale revisions: %+v", retried)
	}
	// A separate queued selection can be cancelled without mutating favorites.
	cancel := meta.MediaSelectionJob{ID: uuid.NewString(), OwnerID: owner.ID, Action: "favorite",
		Status: mediaSelectionJobQueued, Favorite: false, TotalItems: 1}
	if err := db.Create(&cancel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.MediaSelectionJobItem{JobID: cancel.ID, OwnerID: owner.ID,
		NodeID: node1.ID, Revision: 2, Status: mediaSelectionJobQueued}).Error; err != nil {
		t.Fatal(err)
	}
	c, rec = newDurableJobContext(owner.ID, http.MethodPost, "/api/v1/media/selection-jobs/"+cancel.ID+"/cancel", "")
	c.Params = gin.Params{{Key: "id", Value: cancel.ID}}
	s.cancelMediaSelectionJob(c)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("cancel status=%d body=%s", rec.Code, rec.Body.String())
	}
	if progressed, err := s.processNextMediaSelectionJob(context.Background()); !progressed || err != nil {
		t.Fatalf("cancel worker progressed=%v err=%v", progressed, err)
	}
	if err := db.Where("id = ?", cancel.ID).Take(&cancel).Error; err != nil {
		t.Fatal(err)
	}
	if cancel.Status != mediaSelectionJobCancelled || cancel.CancelledItems != 1 {
		t.Fatalf("queued cancellation outcome %+v", cancel)
	}
	if err := db.Where("asset_id = ?", ownerAsset.ID).Take(&ownerMeta).Error; err != nil {
		t.Fatal(err)
	}
	if !ownerMeta.Favorite {
		t.Fatal("queued cancelled job unexpectedly mutated metadata")
	}
}

func TestDurableMediaSelectionSubmitIsOwnerBound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	token := uuid.NewString()
	s := &Server{mediaSelections: map[string]*mediaSelectionSnapshot{
		token: {ownerID: 11, version: 1, nodes: []mediaSelectionNode{{ID: 1, Revision: 1}},
			memberIDs: map[uint64]struct{}{1: {}}, excluded: map[uint64]struct{}{},
			expiresAt: time.Now().Add(time.Minute)},
	}}
	c, rec := newDurableJobContext(12, http.MethodPost, "/api/v1/media/selection-snapshots/"+token+"/jobs",
		`{"version":1,"action":"favorite","favorite":true,"confirm":true}`)
	c.Params = gin.Params{{Key: "token", Value: token}}
	s.createMediaSelectionJob(c)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("other-owner submission status=%d", rec.Code)
	}
	if s.mediaSelections[token].submitting {
		t.Fatal("unauthorized submission locked another owner's snapshot")
	}
	// Verify that malformed or non-confirmed mutations never reach the DB.
	for _, body := range []string{
		`{"version":1,"action":"delete","confirm":true}`,
		`{"version":1,"action":"favorite","favorite":true,"confirm":false}`,
		`{"version":0,"action":"favorite","favorite":true,"confirm":true}`,
	} {
		c, rec = newDurableJobContext(11, http.MethodPost, "/api/v1/media/selection-snapshots/"+token+"/jobs", body)
		c.Params = gin.Params{{Key: "token", Value: token}}
		s.createMediaSelectionJob(c)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid body=%s status=%d", body, rec.Code)
		}
	}
}
