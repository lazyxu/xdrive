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
		"/api/v1/media/items?q=iPhone&asset_kind=live_photo&category=panorama&camera=SONY%20ILCE-7M4&camera=Apple%20iPhone%2015%20Pro&format=VIDEO%2FQUICKTIME&format=image%2Fjpeg&captured_from=2026-09-01T00:00:00Z&captured_to=2026-10-01T00:00:00Z&has_location=true&favorite=true&tag=Travel&person=Alice",
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
		query.Person != "Alice" ||
		strings.Join(query.Cameras, ",") != "apple iphone 15 pro,sony ilce-7m4" ||
		strings.Join(query.Formats, ",") != "image/jpeg,video/quicktime" {
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

func TestNormalizeMediaFacetValuesRejectsOversizedSelection(t *testing.T) {
	values := make([]string, mediaFacetMaxValues+1)
	for index := range values {
		values[index] = "camera-" + strings.Repeat("x", index+1)
	}
	if _, err := normalizeMediaFacetValues("camera", values); err == nil {
		t.Fatal("oversized camera facet selection was accepted")
	}
}

func TestMediaSmartAlbumQueryPersistsCameraAndFormatFilters(t *testing.T) {
	normalized, err := normalizeMediaSmartAlbumQuery(mediaSmartAlbumQuery{
		Cameras: []string{"SONY ILCE-7M4", "apple iphone 15 pro", "Apple iPhone 15 Pro"},
		Formats: []string{"VIDEO/QUICKTIME", "image/jpeg"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(normalized.Cameras, ","); got != "apple iphone 15 pro,sony ilce-7m4" {
		t.Fatalf("cameras=%q", got)
	}
	if got := strings.Join(normalized.Formats, ","); got != "image/jpeg,video/quicktime" {
		t.Fatalf("formats=%q", got)
	}
	encoded, err := encodeMediaSmartAlbumQuery(normalized)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeMediaSmartAlbumQuery(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(decoded.options().Cameras, ","); got != "apple iphone 15 pro,sony ilce-7m4" {
		t.Fatalf("decoded cameras=%q", got)
	}
	if got := strings.Join(decoded.options().Formats, ","); got != "image/jpeg,video/quicktime" {
		t.Fatalf("decoded formats=%q", got)
	}
}
