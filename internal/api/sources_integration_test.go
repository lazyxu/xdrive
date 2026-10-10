package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSourceControlPlaneAndIsolation(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(
		&meta.LocalSourceBinding{}, &meta.ClientDevice{}, &meta.SourceConnectorConfig{}, &meta.SourceCredential{}, &meta.SourceItemAlias{}, &meta.SourceRunFailure{}, &meta.SyncRun{}, &meta.SourceItem{}, &meta.Source{}, &meta.AuditEvent{}, &meta.Share{},
		&meta.UploadPart{}, &meta.UploadSession{}, &meta.ContentBlob{}, &meta.FileVersion{}, &meta.File{},
		&meta.Node{}, &meta.RefreshToken{}, &meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.AuditEvent{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SourceItemAlias{}, &meta.SyncRun{}, &meta.SourceRunFailure{},
		&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.SourceCredential{}, &meta.SourceConnectorConfig{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_sources_owner_name ON xd_sources(owner_id, lower(name))`).Error; err != nil {
		t.Fatal(err)
	}

	router := (&Server{
		DB: db, Auth: auth.New("source-test-secret", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}).Router()

	tokenA := createTestUser(t, db, router, "source-alice", "password-a")
	tokenB := createTestUser(t, db, router, "source-bob", "password-b")
	rootA := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenA, nil, http.StatusOK)
	rootB := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", tokenB, nil, http.StatusOK)
	targetA := requestNode(t, router, http.MethodPost, fmt.Sprintf("/api/v1/nodes/%d/directories", rootA.ID),
		tokenA, strings.NewReader(`{"name":"Synology"}`), http.StatusCreated)

	// Yike targets are server-managed and are bound only after credential
	// validation reveals the remote account identity.
	yikeWithTarget := fmt.Sprintf(`{"name":"Yike invalid target","kind":"yike_photos","direction":"pull","sync_mode":"backup","run_mode":"scan","target_node_id":%d}`, targetA.ID)
	request(t, router, http.MethodPost, "/api/v1/sources", tokenA, strings.NewReader(yikeWithTarget), http.StatusBadRequest)
	yikeCreate := request(t, router, http.MethodPost, "/api/v1/sources", tokenA,
		strings.NewReader(`{"name":"Yike managed","kind":"yike_photos","direction":"pull","sync_mode":"backup","run_mode":"scan","schedule_type":"manual","target_node_id":0}`),
		http.StatusCreated)
	var yikeManaged sourceDTO
	if err := json.Unmarshal(yikeCreate.Body.Bytes(), &yikeManaged); err != nil {
		t.Fatal(err)
	}
	if yikeManaged.TargetNodeID != nil || yikeManaged.TargetPath != "" ||
		yikeManaged.Status != meta.SourceStatusPaused || yikeManaged.Revision != 1 ||
		yikeManaged.ScheduleType != "manual" || yikeManaged.ScheduleExpression != "" || yikeManaged.ScheduleTimezone != "" {
		t.Fatalf("unexpected managed Yike source: %+v", yikeManaged)
	}
	requestWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", yikeManaged.ID), tokenA,
		strings.NewReader(`{"status":"active"}`), http.StatusConflict,
		map[string]string{"If-Match": `"1"`})
	requestWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", yikeManaged.ID), tokenA,
		strings.NewReader(`{"target_node_id":`+fmt.Sprint(rootA.ID)+`}`), http.StatusBadRequest,
		map[string]string{"If-Match": `"1"`})
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/sources/%d", yikeManaged.ID), tokenA,
		nil, http.StatusNoContent, map[string]string{"If-Match": `"1"`})

	// File Station Pull is a generic file source. It starts paused and cannot
	// become active until both an encrypted DSM credential record and a valid
	// non-empty root configuration exist.
	filePush := fmt.Sprintf(`{"name":"Files push invalid","kind":"synology_files","direction":"push","sync_mode":"backup","run_mode":"scan","target_node_id":%d}`, targetA.ID)
	request(t, router, http.MethodPost, "/api/v1/sources", tokenA, strings.NewReader(filePush), http.StatusBadRequest)

	fileCreateBody := fmt.Sprintf(`{"name":"Synology Files","kind":"synology_files","direction":"pull","sync_mode":"backup","run_mode":"sync","target_node_id":%d}`, targetA.ID)
	fileCreate := request(t, router, http.MethodPost, "/api/v1/sources", tokenA, strings.NewReader(fileCreateBody), http.StatusCreated)
	var fileSource sourceDTO
	if err := json.Unmarshal(fileCreate.Body.Bytes(), &fileSource); err != nil {
		t.Fatal(err)
	}
	if fileSource.Status != meta.SourceStatusPaused || fileSource.Revision != 1 || fileSource.TargetPath != "Synology" {
		t.Fatalf("File Station source should start paused with its persisted target path: %+v", fileSource)
	}
	filePath := fmt.Sprintf("/api/v1/sources/%d", fileSource.ID)
	requestWithHeaders(t, router, http.MethodPatch, filePath, tokenA,
		strings.NewReader(`{"status":"active"}`), http.StatusConflict,
		map[string]string{"If-Match": `"1"`})

	if err := db.Create(&meta.SourceCredential{
		SourceID: fileSource.ID, Ciphertext: []byte("test-only"), KeyVersion: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodPatch, filePath, tokenA,
		strings.NewReader(`{"status":"active"}`), http.StatusConflict,
		map[string]string{"If-Match": `"1"`})

	if err := db.Create(&meta.SourceConnectorConfig{
		SourceID: fileSource.ID, Payload: `{"roots":["/documents"]}`, Revision: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}
	activatedFiles := requestWithHeaders(t, router, http.MethodPatch, filePath, tokenA,
		strings.NewReader(`{"status":"active"}`), http.StatusOK,
		map[string]string{"If-Match": `"1"`})
	var activeFileSource sourceDTO
	if err := json.Unmarshal(activatedFiles.Body.Bytes(), &activeFileSource); err != nil {
		t.Fatal(err)
	}
	if activeFileSource.Status != meta.SourceStatusActive || activeFileSource.Revision != 2 {
		t.Fatalf("File Station source did not activate after readiness: %+v", activeFileSource)
	}
	requestWithHeaders(t, router, http.MethodDelete, filePath, tokenA,
		nil, http.StatusNoContent, map[string]string{"If-Match": `"2"`})

	// L01-A: the universal local-folder connector is server-recognized but
	// deliberately fail-closed until an agent-bound root and executor exist.
	localPull := fmt.Sprintf(`{"name":"Local invalid pull","kind":"local_folder","direction":"pull","target_node_id":%d}`, targetA.ID)
	request(t, router, http.MethodPost, "/api/v1/sources", tokenA, strings.NewReader(localPull), http.StatusBadRequest)
	localCreateBody := fmt.Sprintf(`{"name":"Local Desktop Files","kind":"local_folder","direction":"push","sync_mode":"backup","run_mode":"sync","schedule_type":"manual","target_node_id":%d}`, targetA.ID)
	localCreate := request(t, router, http.MethodPost, "/api/v1/sources", tokenA, strings.NewReader(localCreateBody), http.StatusCreated)
	var localCreated sourceDTO
	if err := json.Unmarshal(localCreate.Body.Bytes(), &localCreated); err != nil {
		t.Fatal(err)
	}
	if localCreated.ID == 0 || localCreated.Kind != meta.SourceKindLocalFolder ||
		localCreated.Direction != meta.SourceDirectionPush || localCreated.Status != meta.SourceStatusPaused ||
		localCreated.Revision != 1 || localCreated.TargetNodeID == nil || *localCreated.TargetNodeID != targetA.ID {
		t.Fatalf("local folder must start paused and owner-bound: %+v", localCreated)
	}
	localURL := fmt.Sprintf("/api/v1/sources/%d", localCreated.ID)
	requestWithHeaders(t, router, http.MethodPatch, localURL, tokenA,
		strings.NewReader(`{"status":"active"}`), http.StatusForbidden,
		map[string]string{"If-Match": `"1"`})
	request(t, router, http.MethodPost, localURL+"/trigger", tokenA, nil, http.StatusForbidden)
	request(t, router, http.MethodPost, localURL+"/runs", tokenA,
		strings.NewReader(fmt.Sprintf(`{"run_id":%q}`, uuid.NewString())), http.StatusForbidden)
	// Even an accidentally forced "active" status must not let a local-folder
	// Source execute without the future device-bound authorization protocol.
	if err := db.Model(&meta.Source{}).Where("id = ?", localCreated.ID).
		Update("status", meta.SourceStatusActive).Error; err != nil {
		t.Fatal(err)
	}
	request(t, router, http.MethodPost, localURL+"/runs", tokenA,
		strings.NewReader(fmt.Sprintf(`{"run_id":%q}`, uuid.NewString())), http.StatusForbidden)
	var localRunCount int64
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", localCreated.ID).Count(&localRunCount).Error; err != nil {
		t.Fatal(err)
	}
	if localRunCount != 0 {
		t.Fatalf("unbound local folder unexpectedly started %d runs", localRunCount)
	}
	// Remote owner JWT alone cannot remove an unbound local Push Source.
	requestWithHeaders(t, router, http.MethodDelete, localURL, tokenA, nil,
		http.StatusForbidden, map[string]string{"If-Match": `"1"`})
	// Integration fixture cleanup bypasses the HTTP API intentionally: the
	// public mutation remains forbidden until native device ownership is proven.
	if err := db.Delete(&meta.Source{}, localCreated.ID).Error; err != nil {
		t.Fatal(err)
	}

	createBody := fmt.Sprintf(`{
		"name":"Synology Photos",
		"kind":"synology_photos",
		"direction":"push",
		"sync_mode":"backup",
		"run_mode":"scan",
		"target_node_id":%d,
		"ignore_rules":"@eaDir/\n\\#recycle/\n*.tmp\n"
	}`, targetA.ID)
	createdRes := request(t, router, http.MethodPost, "/api/v1/sources", tokenA, strings.NewReader(createBody), http.StatusCreated)
	var created sourceDTO
	if err := json.Unmarshal(createdRes.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.Revision != 1 || created.RunMode != meta.SourceRunModeScan ||
		created.SyncMode != meta.SourceSyncModeBackup || created.Status != meta.SourceStatusActive ||
		created.TargetNodeID == nil || *created.TargetNodeID != targetA.ID || created.TargetPath != "Synology" ||
		created.ScheduleType != "interval" || created.ScheduleExpression != "6h" {
		t.Fatalf("unexpected created source: %+v", created)
	}

	// Mirror is an explicit local trash policy; provider-side deletion remains unsupported.
	mirrorBody := fmt.Sprintf(`{"name":"Mirror","kind":"test","direction":"push","sync_mode":"mirror","target_node_id":%d}`, targetA.ID)
	mirrorRes := request(t, router, http.MethodPost, "/api/v1/sources", tokenA, strings.NewReader(mirrorBody), http.StatusCreated)
	var mirrorSource sourceDTO
	if err := json.Unmarshal(mirrorRes.Body.Bytes(), &mirrorSource); err != nil {
		t.Fatal(err)
	}
	if mirrorSource.SyncMode != meta.SourceSyncModeMirror || mirrorSource.Revision != 1 {
		t.Fatalf("unexpected mirror source: %+v", mirrorSource)
	}
	requestWithHeaders(
		t, router, http.MethodDelete, fmt.Sprintf("/api/v1/sources/%d", mirrorSource.ID), tokenA,
		nil, http.StatusNoContent, map[string]string{"If-Match": `"1"`},
	)

	// A source cannot target another user's directory.
	foreignBody := fmt.Sprintf(`{"name":"Foreign","kind":"test","direction":"pull","target_node_id":%d}`, rootB.ID)
	request(t, router, http.MethodPost, "/api/v1/sources", tokenA, strings.NewReader(foreignBody), http.StatusBadRequest)

	// Names are unique per owner, case-insensitively.
	duplicateBody := fmt.Sprintf(`{"name":"synology photos","kind":"test","direction":"push","target_node_id":%d}`, targetA.ID)
	request(t, router, http.MethodPost, "/api/v1/sources", tokenA, strings.NewReader(duplicateBody), http.StatusConflict)

	listA := request(t, router, http.MethodGet, "/api/v1/sources", tokenA, nil, http.StatusOK)
	var sourcesA []sourceDTO
	if err := json.Unmarshal(listA.Body.Bytes(), &sourcesA); err != nil {
		t.Fatal(err)
	}
	if len(sourcesA) != 1 || sourcesA[0].ID != created.ID || sourcesA[0].TargetPath != "Synology" {
		t.Fatalf("unexpected owner source list: %+v", sourcesA)
	}
	overviewRes := request(t, router, http.MethodGet, "/api/v1/sources/overview", tokenA, nil, http.StatusOK)
	var overview []sourceOverviewDTO
	if err := json.Unmarshal(overviewRes.Body.Bytes(), &overview); err != nil {
		t.Fatal(err)
	}
	if len(overview) != 1 || overview[0].Source.ID != created.ID || overview[0].LatestRun != nil || overview[0].Credential != nil {
		t.Fatalf("unexpected source overview: %+v", overview)
	}
	listB := request(t, router, http.MethodGet, "/api/v1/sources", tokenB, nil, http.StatusOK)
	var sourcesB []sourceDTO
	if err := json.Unmarshal(listB.Body.Bytes(), &sourcesB); err != nil {
		t.Fatal(err)
	}
	if len(sourcesB) != 0 {
		t.Fatalf("other user saw sources: %+v", sourcesB)
	}
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d", created.ID), tokenB, nil, http.StatusNotFound)

	triggeredRes := request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/trigger", created.ID),
		tokenA, nil, http.StatusAccepted)
	var triggered sourceDTO
	if err := json.Unmarshal(triggeredRes.Body.Bytes(), &triggered); err != nil {
		t.Fatal(err)
	}
	if triggered.RunRequestedAt == nil || triggered.Revision != created.Revision {
		t.Fatalf("unexpected triggered source: %+v", triggered)
	}
	request(t, router, http.MethodPost, fmt.Sprintf("/api/v1/sources/%d/trigger", created.ID),
		tokenB, nil, http.StatusNotFound)
	var triggeredStored meta.Source
	if err := db.First(&triggeredStored, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if triggeredStored.RunRequestedAt == nil {
		t.Fatal("manual run request was not persisted")
	}

	// Source mutations use the same optimistic revision contract as node mutations.
	request(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", created.ID), tokenA,
		strings.NewReader(`{"run_mode":"sync"}`), http.StatusPreconditionRequired)
	requestWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", created.ID), tokenA,
		strings.NewReader(`{"schedule_type":"cron","schedule_expression":"0 3 * *","schedule_timezone":"UTC"}`), http.StatusBadRequest,
		map[string]string{"If-Match": `"1"`})
	updatedRes := requestWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", created.ID), tokenA,
		strings.NewReader(`{"run_mode":"sync","status":"paused","ignore_rules":"*.tmp\n","schedule_type":"cron","schedule_expression":"0 3 * * *","schedule_timezone":"Asia/Shanghai"}`), http.StatusOK,
		map[string]string{"If-Match": `"1"`})
	var updated sourceDTO
	if err := json.Unmarshal(updatedRes.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 || updated.RunMode != meta.SourceRunModeSync ||
		updated.Status != meta.SourceStatusPaused || updated.IgnoreRules != "*.tmp\n" ||
		updated.ScheduleType != "cron" || updated.ScheduleExpression != "0 3 * * *" ||
		updated.ScheduleTimezone != "Asia/Shanghai" {
		t.Fatalf("unexpected updated source: %+v", updated)
	}
	requestWithHeaders(t, router, http.MethodPatch, fmt.Sprintf("/api/v1/sources/%d", created.ID), tokenA,
		strings.NewReader(`{"status":"active"}`), http.StatusConflict, map[string]string{"If-Match": `"1"`})

	now := time.Now().UTC().Truncate(time.Second)
	finished := now.Add(time.Minute)
	run := meta.SyncRun{
		ID: uuid.NewString(), SourceID: created.ID, Mode: meta.SourceRunModeScan,
		Trigger: meta.SyncRunTriggerScheduled, Status: meta.SyncRunStatusCompleted,
		ScannedItems: 100, ScannedBytes: 1000, IgnoredItems: 10, IgnoredBytes: 100,
		NewItems: 20, NewBytes: 300, ChangedItems: 5, ChangedBytes: 200,
		UnchangedItems: 65, UnchangedBytes: 400, MissingItems: 2, MissingBytes: 20,
		PlannedTransferItems: 25, PlannedTransferBytes: 500,
		StartedAt: now, FinishedAt: &finished,
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}

	runsRes := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/runs?limit=10", created.ID),
		tokenA, nil, http.StatusOK)
	var runs []syncRunDTO
	if err := json.Unmarshal(runsRes.Body.Bytes(), &runs); err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || runs[0].ID != run.ID || runs[0].PlannedTransferBytes != 500 ||
		runs[0].IgnoredItems != 10 {
		t.Fatalf("unexpected source runs: %+v", runs)
	}
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/runs/%s", created.ID, run.ID),
		tokenA, nil, http.StatusOK)
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/runs", created.ID),
		tokenB, nil, http.StatusNotFound)

	activeRun := meta.SyncRun{
		ID: uuid.NewString(), SourceID: created.ID, Mode: meta.SourceRunModeSync,
		Trigger: meta.SyncRunTriggerManual, Status: meta.SyncRunStatusRunning,
		StartedAt: now.Add(2 * time.Minute),
	}
	if err := db.Create(&activeRun).Error; err != nil {
		t.Fatal(err)
	}
	pagedRes := request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/runs?limit=1&offset=1", created.ID),
		tokenA, nil, http.StatusOK)
	var pagedRuns []syncRunDTO
	if err := json.Unmarshal(pagedRes.Body.Bytes(), &pagedRuns); err != nil {
		t.Fatal(err)
	}
	if len(pagedRuns) != 1 || pagedRuns[0].ID != run.ID {
		t.Fatalf("unexpected paged source runs: %+v", pagedRuns)
	}
	request(t, router, http.MethodGet, fmt.Sprintf("/api/v1/sources/%d/runs?offset=-1", created.ID),
		tokenA, nil, http.StatusBadRequest)
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/sources/%d", created.ID), tokenA,
		nil, http.StatusConflict, map[string]string{"If-Match": `"2"`})
	activeFinished := now.Add(3 * time.Minute)
	if err := db.Model(&meta.SyncRun{}).Where("id = ?", activeRun.ID).Updates(map[string]any{
		"status": meta.SyncRunStatusCancelled, "finished_at": &activeFinished,
	}).Error; err != nil {
		t.Fatal(err)
	}

	// Source deletion removes only source metadata/history. The target xDrive node remains.
	requestWithHeaders(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/sources/%d", created.ID), tokenA,
		nil, http.StatusNoContent, map[string]string{"If-Match": `"2"`})
	if err := db.First(&meta.Source{}, created.ID).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("source survived deletion: %v", err)
	}
	if err := db.First(&meta.Node{}, targetA.ID).Error; err != nil {
		t.Fatalf("source deletion removed target node: %v", err)
	}
	var runCount int64
	if err := db.Model(&meta.SyncRun{}).Where("source_id = ?", created.ID).Count(&runCount).Error; err != nil {
		t.Fatal(err)
	}
	if runCount != 0 {
		t.Fatalf("source runs survived source deletion: %d", runCount)
	}
}
