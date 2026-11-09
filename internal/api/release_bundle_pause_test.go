package api

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestReleaseBundleDependencyPauseBlocksAndResumesRead(t *testing.T) {
	dir := t.TempDir()
	marker := filepath.Join(dir, "dependency-busy")
	if err := os.WriteFile(marker, []byte("installer\n"), 0644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	reader := releaseBundlePausedReader{
		src: strings.NewReader("package-data"), ctx: ctx, marker: marker,
	}
	type outcome struct {
		count int
		err   error
		bytes string
	}
	result := make(chan outcome, 1)
	go func() {
		buffer := make([]byte, 20)
		n, err := reader.Read(buffer)
		result <- outcome{n, err, string(buffer[:n])}
	}()
	select {
	case got := <-result:
		t.Fatalf("release bytes escaped while server dependency lane was busy: %+v", got)
	case <-time.After(80 * time.Millisecond):
	}
	if err := os.Remove(marker); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-result:
		if got.err != nil || got.bytes != "package-data" || got.count != len("package-data") {
			t.Fatalf("not resumed correctly: %+v", got)
		}
	case <-ctx.Done():
		t.Fatal("paused package read did not resume when installer finished")
	}
}

func TestReleaseBundleDependencyPauseCancelDoesNotHang(t *testing.T) {
	dir := t.TempDir()
	marker := filepath.Join(dir, "dependency-busy")
	if err := os.WriteFile(marker, []byte("installer\n"), 0644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	reader := releaseBundlePausedReader{
		src: strings.NewReader("secret"), ctx: ctx, marker: marker,
	}
	done := make(chan error, 1)
	go func() {
		_, err := reader.Read(make([]byte, 8))
		done <- err
	}()
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("wanted canceled read, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled HTTP read remained stuck on dependency marker")
	}
}

func TestReleaseBundleAuthenticatedRangeDeliveryResumesAfterPause(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root, body, manifest := bundleTestFixture(t)
	marker := filepath.Join(root, "dependency-busy")
	if err := os.WriteFile(marker, []byte("installer\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if got := readReleaseBundleListing(root); got.State != "paused_for_server" {
		t.Fatalf("cached release should expose pause status, got %+v", got)
	}
	t.Setenv("XD_RELEASE_BUNDLE_DIR", root)
	server := &Server{}
	request := httptest.NewRequest(http.MethodGet,
		"/api/v1/release-bundles/current/artifacts/xDrive-unsigned.ipa", nil)
	request.Header.Set("Range", "bytes=0-9")
	recorder := httptest.NewRecorder()
	done := make(chan struct{}, 1)
	go func() {
		c, _ := gin.CreateTestContext(recorder)
		c.Request = request
		c.Params = gin.Params{{Key: "name", Value: manifest.Artifacts[0].Filename}}
		server.releaseBundleArtifactDownload(c)
		close(done)
	}()
	select {
	case <-done:
		t.Fatal("HTTP download completed while Server dependencies were active")
	case <-time.After(80 * time.Millisecond):
	}
	if err := os.Remove(marker); err != nil {
		t.Fatal(err)
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("HTTP Range download did not resume")
	}
	if recorder.Code != http.StatusPartialContent || !bytes.Equal(recorder.Body.Bytes(), body[:10]) {
		t.Fatalf("range mismatch after resume: %d, %q", recorder.Code, recorder.Body.String())
	}
	if got := readReleaseBundleListing(root); got.State != "ready" {
		t.Fatalf("expected ready after installer finished, got %+v", got)
	}
}
