package api

import (
	"os"
	"strings"
	"testing"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/storage"
)

func TestViewerCacheReaderLeaseIsWiredBeforeServingDerivative(t *testing.T) {
	data, err := os.ReadFile("media_derivatives.go")
	if err != nil {
		t.Fatal(err)
	}
	code := string(data)
	if !strings.Contains(code, "provider.OpenPinnedViewerCache(c.Request.Context(), key)") ||
		!strings.Contains(code, "defer file.Close()") ||
		!strings.Contains(code, "defer release()") {
		t.Fatal("Viewer still may serve a source without the foreground read lease")
	}
	_, _ = mediapkg.ViewerPreviewVersion, storage.ViewerCacheLifecycleLockFile
}
