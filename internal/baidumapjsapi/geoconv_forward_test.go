package baidumapjsapi

import (
	"context"
	"errors"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

const geoconvTestAK = "test-server-ak-do-not-use"

func TestBaiduGeoconvForwardRequestStrictFixedUpstreamAndOrder(t *testing.T) {
	coords := []WGS84Coordinate{{Longitude: 116.404, Latitude: 39.915}, {Longitude: 0, Latitude: 0}, {Longitude: -179.999999, Latitude: -45.1}}
	original := append([]WGS84Coordinate(nil), coords...)
	req, err := NewBaiduGeoconvForwardRequest(context.Background(), geoconvTestAK, coords)
	if err != nil {
		t.Fatal(err)
	}
	if req.Method != http.MethodGet || req.URL.Scheme != "https" || req.URL.Host != "api.map.baidu.com" || req.URL.Path != "/geoconv/v2/" {
		t.Fatal("bad pinned upstream route")
	}
	q := req.URL.Query()
	if len(q) != 4 || q.Get("ak") != geoconvTestAK || q.Get("model") != "2" || q.Get("output") != "json" || q.Get("coords") != "116.404,39.915;0,0;-179.999999,-45.1" ||
		req.Header.Get("Accept-Encoding") != "identity" || req.Header.Get("Authorization") != "" {
		t.Fatal("invalid model=2, canonical GPS order, or credential header")
	}
	if len(coords) != len(original) || coords[0] != original[0] {
		t.Fatal("mutated photo provenance")
	}
	if _, err := url.Parse(req.URL.String()); err != nil {
		t.Fatal(err)
	}
}

func TestBaiduGeoconvForwardRequestRejectsInvalidInputsWithoutNetwork(t *testing.T) {
	valid := []WGS84Coordinate{{Longitude: 0, Latitude: 0}}
	bad := [][]WGS84Coordinate{nil, {}, make([]WGS84Coordinate, 101), {{Longitude: math.NaN(), Latitude: 0}}, {{Longitude: math.Inf(1), Latitude: 0}}, {{Longitude: 181, Latitude: 0}}, {{Longitude: 0, Latitude: -91}}}
	for i, pts := range bad {
		if req, err := NewBaiduGeoconvForwardRequest(context.Background(), geoconvTestAK, pts); req != nil || !errors.Is(err, ErrBaiduGeoconvUnavailable) {
			t.Fatalf("accepted bad coords case %d", i)
		}
	}
	for _, key := range []string{"", " ", "line\nfeed", strings.Repeat("x", 513)} {
		if req, err := NewBaiduGeoconvForwardRequest(context.Background(), key, valid); req != nil || !errors.Is(err, ErrBaiduGeoconvUnavailable) {
			t.Fatal("accepted invalid AK")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if req, err := NewBaiduGeoconvForwardRequest(ctx, geoconvTestAK, valid); req != nil || err == nil {
		t.Fatal("accepted cancelled context")
	}
	if req, err := NewBaiduGeoconvForwardRequest(nil, geoconvTestAK, valid); req != nil || err == nil {
		t.Fatal("accepted nil context")
	}
}

func geoconvResponse(content string) *http.Response {
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(content)), ContentLength: int64(len(content))}
}

func TestBaiduGeoconvForwardResponseRejectsIncompleteAndLeakyResults(t *testing.T) {
	ok := `{"status":0,"result":[{"x":116.416,"y":39.922},{"x":0,"y":0}]}`
	pts, err := CheckBaiduGeoconvForwardResponse(geoconvResponse(ok), geoconvTestAK, 2)
	if err != nil || len(pts) != 2 || pts[0].Longitude != 116.416 || pts[1].Latitude != 0 {
		t.Fatal("bad canonical geoconv result")
	}
	invalid := []string{`{"status":4,"result":[{"x":0,"y":0}]}`, `{"result":[{"x":0,"y":0}]}`, `{"status":0,"result":[]}`, `{"status":0,"result":[{"x":0}]}`, `{"status":0,"result":[{"y":0}]}`, `{"status":0,"result":[{"x":181,"y":0}]}`, `{"status":0,"result":[{"x":0,"y":91}]}`, `{"status":0,"result":[{"x":0,"y":0}]} {} `, `{"status":0,"result":[{"x":0,"y":0}],"extra":"sensitive"}`, geoconvTestAK}
	for i, payload := range invalid {
		if p, e := CheckBaiduGeoconvForwardResponse(geoconvResponse(payload), geoconvTestAK, 1); p != nil || !errors.Is(e, ErrBaiduGeoconvUnavailable) {
			t.Fatalf("accepted invalid response %d", i)
		}
	}
	oversized := geoconvResponse(strings.Repeat("x", BaiduGeoconvMaxResponseBytes+1))
	if _, e := CheckBaiduGeoconvForwardResponse(oversized, geoconvTestAK, 1); e == nil {
		t.Fatal("accepted oversized response")
	}
	wrongType := geoconvResponse(ok)
	wrongType.Header.Set("Content-Type", "text/plain")
	if _, e := CheckBaiduGeoconvForwardResponse(wrongType, geoconvTestAK, 2); e == nil {
		t.Fatal("accepted non-JSON response")
	}
	gzip := geoconvResponse(ok)
	gzip.Header.Set("Content-Encoding", "gzip")
	if _, e := CheckBaiduGeoconvForwardResponse(gzip, geoconvTestAK, 2); e == nil {
		t.Fatal("accepted compressed response")
	}
	redirected := geoconvResponse(ok)
	redirected.Header.Set("Location", "https://elsewhere.invalid")
	if _, e := CheckBaiduGeoconvForwardResponse(redirected, geoconvTestAK, 2); e == nil {
		t.Fatal("accepted redirect")
	}
	if _, e := CheckBaiduGeoconvForwardResponse(geoconvResponse(ok), geoconvTestAK, 1); e == nil {
		t.Fatal("accepted mismatched length")
	}
}

func TestBaiduGeoconvForwardRequest100PointLimit(t *testing.T) {
	pts := make([]WGS84Coordinate, 100)
	for i := range pts {
		pts[i] = WGS84Coordinate{Longitude: float64(i) / 100, Latitude: float64(i) / 100}
	}
	req, err := NewBaiduGeoconvForwardRequest(context.Background(), geoconvTestAK, pts)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(req.URL.Query().Get("coords"), ";") != 99 {
		t.Fatal("truncated official bounded batch")
	}
	if _, err := NewBaiduGeoconvForwardRequest(context.Background(), geoconvTestAK, append(pts, WGS84Coordinate{})); err == nil {
		t.Fatal("accepted 101 points")
	}
}

type geoconvRoundTrip func(*http.Request) (*http.Response, error)

func (f geoconvRoundTrip) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func TestBaiduGeoconvForwardWithClientFakeAndContextAbort(t *testing.T) {
	fake := &http.Client{Transport: geoconvRoundTrip(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "api.map.baidu.com" || req.URL.Path != "/geoconv/v2/" {
			t.Fatal("unapproved endpoint")
		}
		if req.Context().Err() != nil {
			t.Fatal("request already canceled")
		}
		return geoconvResponse(`{"status":0,"result":[{"x":116.4,"y":39.9}]}`), nil
	})}
	got, err := forwardWGS84ToBD09WithClient(context.Background(), geoconvTestAK, []WGS84Coordinate{{Longitude: 116.404, Latitude: 39.915}}, fake)
	if err != nil || len(got) != 1 || got[0].Longitude != 116.4 {
		t.Fatal("offline fake HTTP failed")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = forwardWGS84ToBD09WithClient(ctx, geoconvTestAK, []WGS84Coordinate{{Longitude: 0, Latitude: 0}}, fake)
	if !errors.Is(err, ErrBaiduGeoconvUnavailable) {
		t.Fatal("cancelled job still requested remote GPS")
	}
}
