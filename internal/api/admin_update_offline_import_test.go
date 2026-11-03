package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func offlineImportTestContext(t *testing.T, method string, body []byte, id, name, index string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, "/api/v1/admin/update/offline/imports", bytes.NewReader(body))
	c.Params = gin.Params{{Key: "id", Value: id}, {Key: "name", Value: name}, {Key: "index", Value: index}}
	return c, w
}

func offlineImportTestServer(t *testing.T) (*Server, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	return &Server{OfflineUpdateImportDir: root}, root
}

func offlineImportCreateTestID(t *testing.T, s *Server) string {
	t.Helper()
	c, w := offlineImportTestContext(t, http.MethodPost, nil, "", "", "")
	s.adminCreateOfflineUpdateImport(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("create offline import HTTP %d: %s", w.Code, w.Body.String())
	}
	var response struct{ ID string `json:"id"` }
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !offlineImportIDPattern.MatchString(response.ID) {
		t.Fatalf("noncanonical Host import ID: %q", response.ID)
	}
	return response.ID
}

func offlineImportUploadTestFile(t *testing.T, s *Server, id, name string, data []byte) {
	t.Helper()
	checksum := sha256.Sum256(data)
	meta := offlineImportFileMetadata{
		Name: name, Size: int64(len(data)), SHA256: hex.EncodeToString(checksum[:]),
	}
	requestBody, _ := json.Marshal(meta)
	c, w := offlineImportTestContext(t, http.MethodPost, requestBody, id, name, "")
	c.Request.Header.Set("Content-Type", "application/json")
	s.adminRegisterOfflineUpdateFile(c)
	if w.Code != http.StatusOK {
		t.Fatalf("register %s: HTTP %d: %s", name, w.Code, w.Body.String())
	}
	for n := 0; n*offlineImportChunkBytes < len(data); n++ {
		start := n * offlineImportChunkBytes
		stop := start + offlineImportChunkBytes
		if stop > len(data) {
			stop = len(data)
		}
		chunk := data[start:stop]
		hash := sha256.Sum256(chunk)
		c, w = offlineImportTestContext(t, http.MethodPut, chunk, id, name, fmt.Sprint(n))
		c.Request.Header.Set("X-XDrive-Chunk-SHA256", hex.EncodeToString(hash[:]))
		s.adminUploadOfflineUpdateChunk(c)
		if w.Code != http.StatusOK {
			t.Fatalf("chunk %s/%d: HTTP %d: %s", name, n, w.Code, w.Body.String())
		}
		if n == 0 {
			c, w = offlineImportTestContext(t, http.MethodPut, chunk, id, name, "0")
			c.Request.Header.Set("X-XDrive-Chunk-SHA256", hex.EncodeToString(hash[:]))
			s.adminUploadOfflineUpdateChunk(c)
			if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"already_received":true`) {
				t.Fatalf("idempotent upload returned %d: %s", w.Code, w.Body.String())
			}
		}
	}
	c, w = offlineImportTestContext(t, http.MethodPost, nil, id, name, "")
	s.adminFinalizeOfflineUpdateFile(c)
	if w.Code != http.StatusOK {
		t.Fatalf("finalize %s: HTTP %d: %s", name, w.Code, w.Body.String())
	}
}

func TestAdminOfflineUpdateImportSupportsBoundedResumeAndVerifiedFinalize(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only Server offline update staging mount")
	}
	s, dir := offlineImportTestServer(t)
	id := offlineImportCreateTestID(t, s)
	filename := "xdrive-app-" + strings.Repeat("a", 12) + ".tar.gz"
	payload := bytes.Repeat([]byte("q"), offlineImportChunkBytes+27)
	offlineImportUploadTestFile(t, s, id, filename, payload)
	stored, err := os.ReadFile(filepath.Join(dir, id, filename))
	if err != nil || !bytes.Equal(stored, payload) {
		t.Fatalf("finalized offline bytes differ from upload: %v", err)
	}
	offlineImportUploadTestFile(t, s, id, "manifest.json", []byte(`{"schema":2,"platform":"linux/amd64"}`))
	binary := filepath.Join(dir, id, "xdrive-offline-linux-amd64")
	if err := os.WriteFile(binary, []byte("not executed by Server API"), 0o660); err != nil {
		t.Fatal(err)
	}
	c, w := offlineImportTestContext(t, http.MethodGet, nil, id, "", "")
	s.adminGetOfflineUpdateImport(c)
	if w.Code != http.StatusOK {
		t.Fatalf("import inventory status %d: %s", w.Code, w.Body.String())
	}
	var result offlineImportStatus
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.ID != id || !result.ReadyToVerify || len(result.Files) != 3 {
		t.Fatalf("Host inventory must not claim publisher trust: %+v", result)
	}
}

func TestAdminOfflineImportRejectsTraversalHashMismatchAndIncompleteFinalize(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only Server offline update staging mount")
	}
	s, dir := offlineImportTestServer(t)
	id := offlineImportCreateTestID(t, s)
	c, w := offlineImportTestContext(t, http.MethodPost, []byte("{}"), id, "../outside", "")
	s.adminRegisterOfflineUpdateFile(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("path traversal registration returned %d", w.Code)
	}
	if _, err := os.Stat(filepath.Join(dir, "outside")); !os.IsNotExist(err) {
		t.Fatal("unauthorized Host path was created")
	}
	name := "manifest.json"
	body := []byte(`{"schema":2}`)
	hash := sha256.Sum256(body)
	meta, _ := json.Marshal(offlineImportFileMetadata{
		Name: name, Size: int64(len(body)), SHA256: hex.EncodeToString(hash[:]),
	})
	c, w = offlineImportTestContext(t, http.MethodPost, meta, id, name, "")
	c.Request.Header.Set("Content-Type", "application/json")
	s.adminRegisterOfflineUpdateFile(c)
	if w.Code != http.StatusOK {
		t.Fatalf("valid upload metadata %d: %s", w.Code, w.Body.String())
	}
	c, w = offlineImportTestContext(t, http.MethodPost, nil, id, name, "")
	s.adminFinalizeOfflineUpdateFile(c)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("incomplete file accepted: %d", w.Code)
	}
	c, w = offlineImportTestContext(t, http.MethodPut, body, id, name, "0")
	c.Request.Header.Set("X-XDrive-Chunk-SHA256", strings.Repeat("0", 64))
	s.adminUploadOfflineUpdateChunk(c)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("corrupt chunk accepted: %d", w.Code)
	}
	c, w = offlineImportTestContext(t, http.MethodPut, body, id, name, "5")
	c.Request.Header.Set("X-XDrive-Chunk-SHA256", hex.EncodeToString(hash[:]))
	s.adminUploadOfflineUpdateChunk(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("out-of-range chunk accepted: %d", w.Code)
	}
	short := sha256.Sum256(body[:len(body)-1])
	c, w = offlineImportTestContext(t, http.MethodPut, body[:len(body)-1], id, name, "0")
	c.Request.Header.Set("X-XDrive-Chunk-SHA256", hex.EncodeToString(short[:]))
	s.adminUploadOfflineUpdateChunk(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("truncated chunk accepted: %d", w.Code)
	}
	c, w = offlineImportTestContext(t, http.MethodPut, body, id, name, "0")
	c.Request.Header.Set("X-XDrive-Chunk-SHA256", hex.EncodeToString(hash[:]))
	s.adminUploadOfflineUpdateChunk(c)
	if w.Code != http.StatusOK {
		t.Fatalf("complete chunk failed: %d %s", w.Code, w.Body.String())
	}
	if err := os.WriteFile(filepath.Join(dir, id, name+".part"), []byte(`{"schema":3}`), 0o660); err != nil {
		t.Fatal(err)
	}
	c, w = offlineImportTestContext(t, http.MethodPost, nil, id, name, "")
	s.adminFinalizeOfflineUpdateFile(c)
	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("tampered staged file passed final verification: %d", w.Code)
	}
	if _, err := os.Stat(filepath.Join(dir, id, name)); !os.IsNotExist(err) {
		t.Fatal("unverified bytes were promoted")
	}
}

func TestAdminOfflineImportTransportDoesNotClaimPublisherTrust(t *testing.T) {
	s, _ := offlineImportTestServer(t)
	id := offlineImportCreateTestID(t, s)
	if !offlineImportAllowedFile("xdrive-ai-models-"+strings.Repeat("a", 12)+".tar.gz") ||
		offlineImportAllowedFile("xdrive-host-installer.sh") ||
		offlineImportAllowedFile("another-blob.bin") ||
		offlineImportAllowedFile("../manifest.json") {
		t.Fatal("offline upload file allowlist unexpectedly expanded")
	}
	c, w := offlineImportTestContext(t, http.MethodGet, nil, id, "", "")
	s.adminGetOfflineUpdateImport(c)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), `"trusted":true`) ||
		strings.Contains(w.Body.String(), `"verified":true`) {
		t.Fatal("transport inventory falsely claims trusted release")
	}
}

func TestAdminOfflineImportRoutesRequireAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{}
	router := s.Router()
	expected := map[string]bool{
		"POST /api/v1/admin/update/offline/imports": false,
		"GET /api/v1/admin/update/offline/imports/:id": false,
		"POST /api/v1/admin/update/offline/imports/:id/files/:name": false,
		"PUT /api/v1/admin/update/offline/imports/:id/files/:name/chunks/:index": false,
		"POST /api/v1/admin/update/offline/imports/:id/files/:name/finalize": false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, ok := expected[key]; ok {
			expected[key] = true
		}
	}
	for route, present := range expected {
		if !present {
			t.Fatalf("missing admin-only offline route: %s", route)
		}
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/update/offline/imports", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous offline import unexpectedly returned %d", response.Code)
	}
}
