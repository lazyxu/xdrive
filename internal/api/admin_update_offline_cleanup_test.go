package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func offlineImportCleanupTestMakeOld(t *testing.T, dir string, id string, filenames ...string) {
	t.Helper()
	then := time.Now().Add(-31 * 24 * time.Hour)
	for _, name := range filenames {
		path := filepath.Join(dir, id, name)
		if err := os.WriteFile(path, []byte("old candidate"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, then, then); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chtimes(filepath.Join(dir, id), then, then); err != nil {
		t.Fatal(err)
	}
}

func TestAdminOfflineImportCleanupRequiresConfirmationAndSkipsUnknownFiles(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only offline staging mount and unlink semantics")
	}
	s, root := offlineImportTestServer(t)
	old := offlineImportCreateTestID(t, s)
	newer := offlineImportCreateTestID(t, s)
	unsafe := offlineImportCreateTestID(t, s)
	offlineImportCleanupTestMakeOld(t, root, old, "manifest.json", "delivery.json")
	offlineImportCleanupTestMakeOld(t, root, unsafe, "manifest.json", "unmanaged-notes.txt")

	c, w := offlineImportTestContext(t, http.MethodGet, nil, "", "", "")
	s.adminCleanupOfflineUpdateImports(c)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), old) ||
		strings.Contains(w.Body.String(), newer) || strings.Contains(w.Body.String(), unsafe) {
		t.Fatalf("preview included non-expired or unmanaged data: %d %s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, old)); err != nil {
		t.Fatalf("read-only preview deleted an import: %v", err)
	}
	c, w = offlineImportTestContext(t, http.MethodPost, []byte(`{"confirm":false}`), "", "", "")
	c.Request.Header.Set("Content-Type", "application/json")
	s.adminCleanupOfflineUpdateImports(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("cleanup without affirmative confirmation returned %d", w.Code)
	}
	c, w = offlineImportTestContext(t, http.MethodPost, []byte(`{"confirm":true}`), "", "", "")
	c.Request.Header.Set("Content-Type", "application/json")
	s.adminCleanupOfflineUpdateImports(c)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"removed_count":1`) {
		t.Fatalf("confirmed cleanup failed: %d %s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(filepath.Join(root, old)); !os.IsNotExist(err) {
		t.Fatal("expired managed import was not deleted")
	}
	for _, id := range []string{newer, unsafe} {
		if _, err := os.Stat(filepath.Join(root, id)); err != nil {
			t.Fatalf("unexpired or unmanaged import was deleted (%s): %v", id, err)
		}
	}
}

func TestAdminOfflineImportCleanupHonorsRecentChunkWritesAndSymlinkGuards(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only offline staging mount and symlink semantics")
	}
	s, root := offlineImportTestServer(t)
	active := offlineImportCreateTestID(t, s)
	unsafe := offlineImportCreateTestID(t, s)
	offlineImportCleanupTestMakeOld(t, root, active, "manifest.json.part")
	offlineImportCleanupTestMakeOld(t, root, unsafe, "manifest.json")
	// The parent mtime stays stale while a resumed chunk changes only .part.
	if err := os.Chtimes(filepath.Join(root, active, "manifest.json.part"), time.Now(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("../manifest.json", filepath.Join(root, unsafe, "delivery.json")); err != nil {
		t.Fatal(err)
	}
	c, w := offlineImportTestContext(t, http.MethodGet, nil, "", "", "")
	s.adminCleanupOfflineUpdateImports(c)
	if w.Code != http.StatusOK || strings.Contains(w.Body.String(), active) ||
		strings.Contains(w.Body.String(), unsafe) {
		t.Fatalf("unsafe or recently touched imports became eligible: %d %s", w.Code, w.Body.String())
	}
}

func TestAdminOfflineImportCleanupRouteRequiresAdmin(t *testing.T) {
	s := &Server{}
	router := s.Router()
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		request := httptest.NewRequest(method, "/api/v1/admin/update/offline/cleanup", nil)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated cleanup %s returned %d", method, response.Code)
		}
	}
}
