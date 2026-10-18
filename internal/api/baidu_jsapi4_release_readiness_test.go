package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
)

func hasBaiduJSAPI4Blocker(values []string, reason string) bool {
	for _, value := range values {
		if value == reason {
			return true
		}
	}
	return false
}

func TestBaiduJSAPI4ReleaseReadinessActualSourceGates(t *testing.T) {
	server := &Server{AllowedOrigin: "http://lan.example"}
	var empty baiduJSAPIDesiredConfig
	want := []string{
		baiduJSAPI4MissingBrowserAK, baiduJSAPI4DesiredDisabled,
		baiduJSAPI4EncryptionMissing, baiduJSAPI4HTTPSOriginInvalid,
		baiduJSAPI4SignerUnpinned, baiduJSAPI4ResourcesUnreviewed,
	}
	got := server.baiduJSAPI4ReleaseBlockers(empty, false)
	if len(got) != len(want) {
		t.Fatalf("incorrect release blockers count: %v", got)
	}
	for i, blocker := range want {
		if got[i] != blocker {
			t.Fatalf("blocker %d = %q, want %q", i, got[i], blocker)
		}
	}
	// Desired enablement (even with claimed saved AK) is never a runtime grant.
	desired := server.baiduJSAPI4ReleaseBlockers(baiduJSAPIDesiredConfig{
		DesiredEnabled: true, Configured: true, Revision: 5,
	}, false)
	if hasBaiduJSAPI4Blocker(desired, baiduJSAPI4MissingBrowserAK) ||
		hasBaiduJSAPI4Blocker(desired, baiduJSAPI4DesiredDisabled) ||
		!hasBaiduJSAPI4Blocker(desired, baiduJSAPI4SignerUnpinned) ||
		!hasBaiduJSAPI4Blocker(desired, baiduJSAPI4ResourcesUnreviewed) ||
		baidumapjsapi.JSAPI4ProductionSignerPinned() ||
		baidumapjsapi.JSAPI4ChildInventoryComplete() {
		t.Fatalf("unreviewed policy activated by admin desired intent: %v", desired)
	}
}

func TestBaiduJSAPI4AdminReadinessIsNoStoreAndAKFree(t *testing.T) {
	gin.SetMode(gin.TestMode)
	server := &Server{AllowedOrigin: "http://lan.example", BaiduMapAK: "static-secret-canary"}
	out := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(out)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/admin/services/baidu-jsapi", nil)
	server.adminBaiduJSAPIConfig(ctx)
	// Read the exact JSON field names rather than Go's case-insensitive names.
	var raw map[string]any
	if err := json.Unmarshal(out.Body.Bytes(), &raw); err != nil {
		t.Fatal("invalid admin JSON")
	}
	blockersAny, ok := raw["release_blockers"].([]any)
	if out.Code != http.StatusOK || !ok ||
		len(blockersAny) < 4 || raw["runtime_enabled"] != false ||
		raw["activation_state"] != "blocked_pending_licence_and_proxy" ||
		!strings.Contains(out.Body.String(), baiduJSAPI4SignerUnpinned) ||
		!strings.Contains(out.Body.String(), baiduJSAPI4ResourcesUnreviewed) ||
		strings.Contains(out.Body.String(), server.BaiduMapAK) ||
		out.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("admin readiness leaked credentials, cacheability or false runtime")
	}
}
