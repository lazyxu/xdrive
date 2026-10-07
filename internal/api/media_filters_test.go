package api

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestMediaQueryFromRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	req := httptest.NewRequest(
		"GET",
		"/api/v1/media/items?q=iPhone&asset_kind=live_photo&category=panorama&captured_from=2026-09-01T00:00:00Z&captured_to=2026-10-01T00:00:00Z&has_location=true&favorite=true&tag=Travel&person=Alice",
		nil,
	)
	ctx.Request = req

	query, ok := mediaQueryFromRequest(ctx)
	if !ok {
		t.Fatalf("query rejected: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if query.Search != "iPhone" ||
		query.AssetKind != "live_photo" ||
		query.Category != "panorama" ||
		query.HasLocation == nil || !*query.HasLocation ||
		query.Favorite == nil || !*query.Favorite ||
		query.Tag != "Travel" ||
		query.Person != "Alice" {
		t.Fatalf("query=%+v", query)
	}
	if query.CapturedFrom == nil ||
		!query.CapturedFrom.Equal(time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("captured_from=%v", query.CapturedFrom)
	}
	if query.CapturedTo == nil ||
		!query.CapturedTo.Equal(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)) {
		t.Fatalf("captured_to=%v", query.CapturedTo)
	}
}

func TestMediaQueryFromRequestRejectsInvalidCategory(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		"GET",
		"/api/v1/media/items?category=screenshot",
		nil,
	)

	if _, ok := mediaQueryFromRequest(ctx); ok {
		t.Fatal("unsupported inferred media category was accepted")
	}
	if recorder.Code != 400 {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestMediaQueryFromRequestRejectsInvalidRange(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		"GET",
		"/api/v1/media/items?captured_from=2026-10-02T00:00:00Z&captured_to=2026-10-01T00:00:00Z",
		nil,
	)

	if _, ok := mediaQueryFromRequest(ctx); ok {
		t.Fatal("invalid capture range was accepted")
	}
	if recorder.Code != 400 {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestMediaQueryFromRequestRejectsInvalidAssetKind(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		"GET",
		"/api/v1/media/items?asset_kind=provider_magic",
		nil,
	)

	if _, ok := mediaQueryFromRequest(ctx); ok {
		t.Fatal("invalid asset kind was accepted")
	}
	if recorder.Code != 400 {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestMediaQueryFromRequestRejectsInvalidFavorite(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		"GET",
		"/api/v1/media/items?favorite=maybe",
		nil,
	)

	if _, ok := mediaQueryFromRequest(ctx); ok {
		t.Fatal("invalid favorite filter was accepted")
	}
	if recorder.Code != 400 {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestMediaQueryFromRequestRejectsInvalidTag(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		"GET",
		"/api/v1/media/items?tag="+strings.Repeat("x", mediaTagMaxRunes+1),
		nil,
	)

	if _, ok := mediaQueryFromRequest(ctx); ok {
		t.Fatal("oversized tag filter was accepted")
	}
	if recorder.Code != 400 {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestMediaQueryFromRequestRejectsInvalidPerson(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		"GET",
		"/api/v1/media/items?person="+strings.Repeat("x", mediaPersonMaxRunes+1),
		nil,
	)

	if _, ok := mediaQueryFromRequest(ctx); ok {
		t.Fatal("oversized person filter was accepted")
	}
	if recorder.Code != 400 {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}
