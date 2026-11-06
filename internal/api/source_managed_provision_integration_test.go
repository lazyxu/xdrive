package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestCreateSynologyPullManagedTargetWithoutClaimingLegacyFolder(t *testing.T) {
	db, srv, owner, other, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name
		ON xd_nodes(owner_id, parent_id, lower(name))
		WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_sources_owner_direction_name
		ON xd_sources(owner_id, direction, lower(name))`).Error; err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	srv.Auth = auth.New("managed-pull-create-test", time.Hour)
	router := srv.Router()
	token, err := srv.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}

	ordinary := createFilePropertiesDir(t, db, owner.ID, root.ID, "用户普通目录")
	legacyInput := fmt.Sprintf(
		`{"name":"我的文档","kind":"synology_files","direction":"pull","sync_mode":"backup","run_mode":"sync","target_node_id":%d}`,
		ordinary.ID,
	)
	// An old client-supplied target is no longer accepted, even if it is
	// an Owner-owned folder. The caller may only supply the last leaf name.
	request(t, router, http.MethodPost, "/api/v1/sources", token,
		strings.NewReader(legacyInput), http.StatusBadRequest)
	createdRes := request(t, router, http.MethodPost, "/api/v1/sources", token,
		strings.NewReader(`{"name":"我的文档","kind":"synology_files","direction":"pull","sync_mode":"backup","run_mode":"sync"}`),
		http.StatusCreated)
	var created sourceDTO
	if err := json.Unmarshal(createdRes.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.TargetNodeID == nil ||
		*created.TargetNodeID == ordinary.ID || created.Status != meta.SourceStatusPaused ||
		created.Revision != 1 ||
		created.TargetPath != "同步文件夹/Pull/Synology Files/我的文档" {
		t.Fatalf("Server did not create the canonical exclusive managed Pull target: %+v", created)
	}
	var savedSource meta.Source
	if err := db.First(&savedSource, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !savedSource.TargetManaged || savedSource.TargetNodeID == nil ||
		*savedSource.TargetNodeID != *created.TargetNodeID {
		t.Fatalf("managed target provenance or binding not saved: %+v", savedSource)
	}
	var savedOriginal meta.Node
	if err := db.First(&savedOriginal, ordinary.ID).Error; err != nil {
		t.Fatal(err)
	}
	if savedOriginal.Name != ordinary.Name || savedOriginal.ParentID == nil ||
		*savedOriginal.ParentID != root.ID || savedOriginal.Revision != ordinary.Revision {
		t.Fatalf("old user folder was claimed or modified: %+v", savedOriginal)
	}
	var actualTarget meta.Node
	if err := db.First(&actualTarget, *created.TargetNodeID).Error; err != nil {
		t.Fatal(err)
	}
	if actualTarget.Type != meta.NodeTypeDir || actualTarget.Name != created.Name {
		t.Fatalf("managed target=%+v", actualTarget)
	}
	var childCount int64
	if err := db.Model(&meta.Node{}).Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL",
		owner.ID, ordinary.ID).Count(&childCount).Error; err != nil {
		t.Fatal(err)
	}
	if childCount != 0 {
		t.Fatalf("legacy user folder unexpectedly gained %d managed children", childCount)
	}
	// The 5B rename from the preceding PR must work on a Source that was
	// actually created by the Server, not just on test-provided provenance.
	rename := requestWithHeaders(t, router, http.MethodPatch,
		fmt.Sprintf("/api/v1/sources/%d", created.ID), token,
		strings.NewReader(`{"name":"我的文档新名字"}`), http.StatusOK,
		map[string]string{"If-Match": `"1"`})
	var renamed sourceDTO
	if err := json.Unmarshal(rename.Body.Bytes(), &renamed); err != nil {
		t.Fatal(err)
	}
	if renamed.TargetNodeID == nil || *renamed.TargetNodeID != *created.TargetNodeID ||
		renamed.Revision != 2 ||
		renamed.TargetPath != "同步文件夹/Pull/Synology Files/我的文档新名字" {
		t.Fatalf("5B rename after managed provisioning=%+v", renamed)
	}
	if err := db.First(&actualTarget, *created.TargetNodeID).Error; err != nil {
		t.Fatal(err)
	}
	if actualTarget.ID != *created.TargetNodeID || actualTarget.Name != "我的文档新名字" ||
		actualTarget.Revision != 2 {
		t.Fatalf("5B changed root ID or did not rename it: %+v", actualTarget)
	}

	// Normal new Source callers do not need any target_node_id.
	photosRes := request(t, router, http.MethodPost, "/api/v1/sources", token,
		strings.NewReader(`{"name":"照片备份","kind":"synology_photos","direction":"pull","schedule_type":"manual"}`),
		http.StatusCreated)
	var photos sourceDTO
	if err := json.Unmarshal(photosRes.Body.Bytes(), &photos); err != nil {
		t.Fatal(err)
	}
	if photos.TargetNodeID == nil || photos.TargetPath != "同步文件夹/Pull/Synology Photos/照片备份" ||
		photos.Status != meta.SourceStatusPaused {
		t.Fatalf("Photos Pull not server-provisioned: %+v", photos)
	}
	// Canonical leaf collisions, including ordinary folders, fail before
	// any Source can claim the directory.
	occupied := createFilePropertiesDir(t, db, owner.ID, *actualTarget.ParentID, "占用")
	conflict := request(t, router, http.MethodPost, "/api/v1/sources", token,
		strings.NewReader(`{"name":"占用","kind":"synology_files","direction":"pull"}`),
		http.StatusConflict)
	if !strings.Contains(conflict.Body.String(), "managed source target name/path is occupied") {
		t.Fatalf("unexpected managed path conflict: %s", conflict.Body.String())
	}
	var occupiedAfter meta.Node
	if err := db.First(&occupiedAfter, occupied.ID).Error; err != nil {
		t.Fatal(err)
	}
	if occupiedAfter.ID != occupied.ID || occupiedAfter.ParentID == nil ||
		*occupiedAfter.ParentID != *actualTarget.ParentID {
		t.Fatalf("collision modified unrelated node: %+v", occupiedAfter)
	}
	var failedSourceCount int64
	if err := db.Model(&meta.Source{}).
		Where("owner_id = ? AND name = ?", owner.ID, "占用").
		Count(&failedSourceCount).Error; err != nil {
		t.Fatal(err)
	}
	if failedSourceCount != 0 {
		t.Fatal("source row remained after managed path collision")
	}

	// A stale old client may send a different Owner's NodeID. It must not
	// be accepted even if Server will ignore valid picker values.
	foreignRoot := meta.Node{OwnerID: other.ID, Name: "", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&foreignRoot).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodPost, "/api/v1/sources", token,
		strings.NewReader(fmt.Sprintf(
			`{"name":"外部目标","kind":"synology_files","direction":"pull","target_node_id":%d}`, foreignRoot.ID)),
		http.StatusBadRequest)
	var foreignCreated int64
	if err := db.Model(&meta.Source{}).
		Where("owner_id = ? AND name = ?", owner.ID, "外部目标").
		Count(&foreignCreated).Error; err != nil {
		t.Fatal(err)
	}
	if foreignCreated != 0 {
		t.Fatal("foreign legacy target bypassed owner validation")
	}

	// Treat a legacy Source targeting the canonical connector directory
	// as ownership overlap. Never nest a new Source beneath it.
	connectorID := *actualTarget.ParentID
	legacySource := meta.Source{
		OwnerID: owner.ID, Name: "旧占用上级", Kind: "test",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &connectorID,
	}
	if err := db.Create(&legacySource).Error; err != nil {
		t.Fatal(err)
	}
	overlap := request(t, router, http.MethodPost, "/api/v1/sources", token,
		strings.NewReader(`{"name":"不能嵌套","kind":"synology_files","direction":"pull"}`),
		http.StatusConflict)
	if !strings.Contains(overlap.Body.String(), "managed source hierarchy overlaps") {
		t.Fatalf("missing overlapping root guard: %s", overlap.Body.String())
	}
}

func TestManagedSynologyPullTargetPathCollisionRollsBackEntireCreation(t *testing.T) {
	db, srv, owner, _, root := setupFilePropertiesTestDB(t)
	gin.SetMode(gin.TestMode)
	srv.Auth = auth.New("managed-pull-conflict-test", time.Hour)
	router := srv.Router()
	token, err := srv.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	// The canonical umbrella is occupied by an existing ordinary file.
	existing := createFilePropertiesFile(t, db, owner.ID, root.ID,
		yikeTargetRootName, 1)
	response := request(t, router, http.MethodPost, "/api/v1/sources", token,
		strings.NewReader(`{"name":"拉取1","kind":"synology_files","direction":"pull"}`),
		http.StatusConflict)
	if !strings.Contains(response.Body.String(), "managed source target name/path is occupied") {
		t.Fatalf("expected occupied canonical parent, got %s", response.Body.String())
	}
	var count int64
	if err := db.Model(&meta.Source{}).Where("owner_id = ?", owner.ID).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("failed create leaked %d Source rows", count)
	}
	var unchanged meta.Node
	if err := db.First(&unchanged, existing.ID).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.Type != meta.NodeTypeFile || unchanged.Name != yikeTargetRootName ||
		unchanged.Revision != existing.Revision {
		t.Fatalf("failed create changed occupied parent: %+v", unchanged)
	}
}
