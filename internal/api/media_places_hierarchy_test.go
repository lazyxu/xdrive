package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestMediaPlaceHierarchyIdentityRoundTrip(t *testing.T) {
	tests := []mediaPlaceHierarchyKey{
		{Level: "country", Country: "JP"},
		{Level: "region", Country: "JP", Region: "13"},
		{Level: "city", Country: "JP", Region: "13", CityID: 1850147},
		{Level: "city", Country: "US", Region: "MA", CityID: 123456},
	}
	for _, item := range tests {
		raw := item.String()
		parsed, ok := parseMediaPlaceHierarchyKey(raw)
		if !ok || parsed != item {
			t.Fatalf("key %q parsed %+v (%v), expected %+v", raw, parsed, ok, item)
		}
	}
}

func TestMediaPlaceHierarchyRejectsAmbiguousKeys(t *testing.T) {
	for _, raw := range []string{
		"", "country", "country:", "country:JP:13", "country:J", "country:JPN",
		"country:jp", "country:0P", "country:J0", "region:JP", "region:JP:",
		"region:JP:13:1850147", "region:JP:13!", "city:JP:13",
		"city:JP:13:0", "city:JP:13:-1", "city:JP:13:01", "city:JP:13:hi",
		"city:JP:13:9223372036854775808", "city:JP:XX:1:2",
		"place:123:456", "country:JP%0a", "city:JP:13:1 OR 1=1",
	} {
		if parsed, ok := parseMediaPlaceHierarchyKey(raw); ok {
			t.Fatalf("accepted invalid key %q as %+v", raw, parsed)
		}
	}
}

func TestMediaPlaceHierarchyValidParents(t *testing.T) {
	tests := []struct {
		level, country, region string
		want                   bool
	}{
		{"country", "", "", true},
		{"country", "JP", "", false},
		{"region", "JP", "", true},
		{"region", "JP", "13", false},
		{"city", "JP", "13", true},
		{"city", "JP", "", false},
		{"city", "", "13", false},
		{"region", "jp", "", false},
		{"city", "JP", "13;DROP TABLE", false},
		{"district", "JP", "13", false},
	}
	for _, tt := range tests {
		if _, ok := mediaPlaceHierarchyParent(tt.level, tt.country, tt.region); ok != tt.want {
			t.Fatalf("parent %+v valid=%v, want %v", tt, ok, tt.want)
		}
	}
}

func TestMediaPlaceHierarchyHTTPRejectsBadUntrustedInputs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	s := &Server{}
	for _, query := range []string{
		"level=province",
		"level=region",
		"level=city&country=JP",
		"level=city&country=JP&region=13&cursor=city:US:MA:123",
		"level=country&cursor=city:JP:13:123",
		"level=country&cursor=country:XX&cursor=country:YY",
		"level=country&limit=0",
		"level=country&limit=101",
		"level=country&limit=abc",
		"level=country&search=foo&search=bar",
		"level=country&region=13",
		"level=city&country=JP&region=13&album=invalid/id",
	} {
		record := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(record)
		ctx.Request = httptest.NewRequest(http.MethodGet, "/api/v1/media/places/hierarchy?"+query, nil)
		s.listMediaPlaceHierarchy(ctx)
		if record.Code != http.StatusBadRequest {
			t.Fatalf("query %q: expected 400, got %d: %s", query, record.Code, record.Body.String())
		}
	}
}

func TestMediaHierarchyFilterRequestIsIndependentFromLegacyPlaceGrid(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet,
		"/api/v1/media/items?place_hierarchy=city:JP:13:1850147&favorite=true&range=true", nil)
	options, ok := mediaQueryFromRequest(ctx)
	if !ok || options.PlaceHierarchy == nil || options.PlaceHierarchy.CityID != 1850147 ||
		options.Place != nil || options.Favorite == nil || !*options.Favorite {
		t.Fatalf("hierarchy filter not parsed independently: %+v valid=%v body=%s", options, ok, recorder.Body.String())
	}
	for _, raw := range []string{
		"place_hierarchy=city:JP:13:0",
		"place_hierarchy=city:JP:13:1&place_hierarchy=city:JP:13:2",
		"place_hierarchy=region:JP:",
		"place_hierarchy=place:1:2",
	} {
		out := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(out)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/v1/media/items?"+raw, nil)
		if _, valid := mediaQueryFromRequest(c); valid || out.Code != http.StatusBadRequest {
			t.Fatalf("accepted %q, status=%d body=%s", raw, out.Code, out.Body.String())
		}
	}
}
