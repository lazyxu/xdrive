package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestUploadConflictOverwritePolicy(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)

	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "upload_overwrite_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()

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
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{},
		&meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{}, &meta.AuditEvent{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	router := (&Server{
		DB:             db,
		Store:          store,
		Auth:           auth.New("upload-overwrite-secret", time.Hour),
		RefreshTTL:     24 * time.Hour,
		AllowedOrigin:  "http://localhost",
		MaxUploadBytes: 32 << 20,
	}).Router()

	token := createTestUser(t, db, router, "overwrite-user", "overwrite-password")
	root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", token, nil, http.StatusOK)
	var rootModel meta.Node
	if err := db.First(&rootModel, root.ID).Error; err != nil {
		t.Fatal(err)
	}
	const chunkSize = int64(4 << 20)

	upload := func(name, resumeKey string, data []byte) uploadSessionDTO {
		t.Helper()
		hash := sha256Hex(data)
		body := fmt.Sprintf(
			`{"parent_id":%d,"name":%q,"size":%d,"chunk_size":%d,"sha256":%q,"resume_key":%q}`,
			root.ID, name, len(data), chunkSize, hash, resumeKey,
		)
		init := request(t, router, http.MethodPost, "/api/v1/uploads", token, strings.NewReader(body), http.StatusCreated)
		var session uploadSessionDTO
		if err := json.Unmarshal(init.Body.Bytes(), &session); err != nil {
			t.Fatal(err)
		}
		requestWithHeaders(
			t, router, http.MethodPut,
			fmt.Sprintf("/api/v1/uploads/%s/chunks/0", session.ID),
			token, strings.NewReader(string(data)), http.StatusCreated,
			map[string]string{"Content-Type": "application/octet-stream", "X-Chunk-SHA256": hash},
		)
		final := request(
			t, router, http.MethodPost, "/api/v1/uploads/"+session.ID+"/finalize",
			token, strings.NewReader(`{}`), http.StatusOK,
		)
		var result uploadSessionDTO
		if err := json.Unmarshal(final.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}

	originalData := []byte("overwrite-original")
	original := upload("same.bin", "original", originalData)
	if original.Result == nil || original.Result.Revision != 1 {
		t.Fatalf("original upload=%+v", original)
	}

	preflight := request(
		t, router, http.MethodPost, "/api/v1/uploads/preflight", token,
		strings.NewReader(fmt.Sprintf(`{"parent_id":%d,"name":"same.bin"}`, root.ID)),
		http.StatusOK,
	)
	var filePreflight uploadConflictPreflightDTO
	if err := json.Unmarshal(preflight.Body.Bytes(), &filePreflight); err != nil {
		t.Fatal(err)
	}
	if !filePreflight.Conflict || filePreflight.TargetType != meta.NodeTypeFile || !filePreflight.CanOverwrite {
		t.Fatalf("file preflight=%+v", filePreflight)
	}

	dir := meta.Node{
		ParentID: &root.ID, Name: "same-dir", Type: meta.NodeTypeDir,
		OwnerID: rootModel.OwnerID, Revision: 1,
	}
	if err := db.Create(&dir).Error; err != nil {
		t.Fatal(err)
	}
	dirPreflight := request(
		t, router, http.MethodPost, "/api/v1/uploads/preflight", token,
		strings.NewReader(fmt.Sprintf(`{"parent_id":%d,"name":"same-dir"}`, root.ID)),
		http.StatusOK,
	)
	var folderConflict uploadConflictPreflightDTO
	if err := json.Unmarshal(dirPreflight.Body.Bytes(), &folderConflict); err != nil {
		t.Fatal(err)
	}
	if !folderConflict.Conflict || folderConflict.TargetType != meta.NodeTypeDir || folderConflict.CanOverwrite {
		t.Fatalf("directory preflight=%+v", folderConflict)
	}
	request(
		t, router, http.MethodPost, "/api/v1/uploads", token,
		strings.NewReader(fmt.Sprintf(
			`{"parent_id":%d,"name":"same-dir","size":0,"chunk_size":%d,"resume_key":"dir-overwrite","conflict_policy":"overwrite"}`,
			root.ID, chunkSize,
		)),
		http.StatusConflict,
	)

	overwriteData := []byte("overwrite-new")
	overwriteHash := sha256Hex(overwriteData)
	overwriteBody := fmt.Sprintf(
		`{"parent_id":%d,"name":"same.bin","size":%d,"chunk_size":%d,"sha256":%q,"resume_key":"overwrite","conflict_policy":"overwrite"}`,
		root.ID, len(overwriteData), chunkSize, overwriteHash,
	)
	overwriteInit := request(
		t, router, http.MethodPost, "/api/v1/uploads", token,
		strings.NewReader(overwriteBody), http.StatusCreated,
	)
	var overwriteSession uploadSessionDTO
	if err := json.Unmarshal(overwriteInit.Body.Bytes(), &overwriteSession); err != nil {
		t.Fatal(err)
	}
	if overwriteSession.NodeID == nil || *overwriteSession.NodeID != original.Result.ID ||
		overwriteSession.ParentID == nil || *overwriteSession.ParentID != root.ID ||
		overwriteSession.ExpectedRevision != 1 ||
		overwriteSession.ConflictPolicy != meta.UploadConflictPolicyOverwrite ||
		overwriteSession.RequestedName != "same.bin" {
		t.Fatalf("overwrite session=%+v", overwriteSession)
	}
	requestWithHeaders(
		t, router, http.MethodPut,
		fmt.Sprintf("/api/v1/uploads/%s/chunks/0", overwriteSession.ID),
		token, strings.NewReader(string(overwriteData)), http.StatusCreated,
		map[string]string{"Content-Type": "application/octet-stream", "X-Chunk-SHA256": overwriteHash},
	)
	overwriteFinal := request(
		t, router, http.MethodPost, "/api/v1/uploads/"+overwriteSession.ID+"/finalize",
		token, strings.NewReader(`{}`), http.StatusOK,
	)
	var overwritten uploadSessionDTO
	if err := json.Unmarshal(overwriteFinal.Body.Bytes(), &overwritten); err != nil {
		t.Fatal(err)
	}
	if overwritten.Result == nil || overwritten.Result.ID != original.Result.ID ||
		overwritten.Result.Revision != 2 || overwritten.Result.SHA256 != overwriteHash {
		t.Fatalf("overwrite result=%+v", overwritten.Result)
	}
	var history []meta.FileVersion
	if err := db.Where("node_id = ?", original.Result.ID).Order("revision ASC").Find(&history).Error; err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 || history[0].Revision != 1 || history[0].SHA256 != sha256Hex(originalData) {
		t.Fatalf("overwrite history=%+v", history)
	}

	staleData := []byte("overwrite-stale")
	staleHash := sha256Hex(staleData)
	staleBody := fmt.Sprintf(
		`{"parent_id":%d,"name":"same.bin","size":%d,"chunk_size":%d,"sha256":%q,"resume_key":"stale-overwrite","conflict_policy":"overwrite"}`,
		root.ID, len(staleData), chunkSize, staleHash,
	)
	staleInit := request(
		t, router, http.MethodPost, "/api/v1/uploads", token,
		strings.NewReader(staleBody), http.StatusCreated,
	)
	var staleSession uploadSessionDTO
	if err := json.Unmarshal(staleInit.Body.Bytes(), &staleSession); err != nil {
		t.Fatal(err)
	}
	if staleSession.ExpectedRevision != 2 {
		t.Fatalf("stale session expected_revision=%d", staleSession.ExpectedRevision)
	}
	requestWithHeaders(
		t, router, http.MethodPut,
		fmt.Sprintf("/api/v1/uploads/%s/chunks/0", staleSession.ID),
		token, strings.NewReader(string(staleData)), http.StatusCreated,
		map[string]string{"Content-Type": "application/octet-stream", "X-Chunk-SHA256": staleHash},
	)
	winner := requestNodeWithHeaders(
		t, router, http.MethodPut, fmt.Sprintf("/api/v1/files/%d/content", original.Result.ID),
		token, strings.NewReader("winner"), http.StatusOK,
		map[string]string{"If-Match": `"2"`},
	)
	if winner.Revision != 3 {
		t.Fatalf("winner revision=%d", winner.Revision)
	}
	request(
		t, router, http.MethodPost, "/api/v1/uploads/"+staleSession.ID+"/finalize",
		token, strings.NewReader(`{}`), http.StatusConflict,
	)
	current := request(
		t, router, http.MethodGet, fmt.Sprintf("/api/v1/files/%d/content", original.Result.ID),
		token, nil, http.StatusOK,
	)
	if current.Body.String() != "winner" {
		t.Fatalf("stale overwrite replaced winner: %q", current.Body.String())
	}

	restarted := request(
		t, router, http.MethodPost, "/api/v1/uploads", token,
		strings.NewReader(staleBody), http.StatusCreated,
	)
	var restartedSession uploadSessionDTO
	if err := json.Unmarshal(restarted.Body.Bytes(), &restartedSession); err != nil {
		t.Fatal(err)
	}
	if restartedSession.ID == staleSession.ID || restartedSession.ExpectedRevision != 3 {
		t.Fatalf("stale overwrite session was not reset: old=%+v new=%+v", staleSession, restartedSession)
	}
	request(t, router, http.MethodDelete, "/api/v1/uploads/"+restartedSession.ID, token, nil, http.StatusNoContent)
}
