package baidumapjsapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Baidu Web Geoconv v2 uses model=2 for GPS/WGS84 -> BD-09 longitude/latitude.
// JSAPI4 BMap.Convertor uses different from=1,to=5 identifiers. Never invert
// BD-09 to manufacture original GPS or replace PhotoAsset provenance.
const (
	BaiduGeoconvMaxBatch         = 100
	BaiduGeoconvMaxResponseBytes = 64 << 10
	baiduGeoconvForwardURL       = "https://api.map.baidu.com/geoconv/v2/"
	baiduGeoconvMaxQueryBytes    = 20 << 10
)

var ErrBaiduGeoconvUnavailable = errors.New("baidu forward coordinate conversion unavailable")

type WGS84Coordinate struct {
	Longitude float64
	Latitude  float64
}

type BD09Coordinate struct {
	Longitude float64
	Latitude  float64
}

func geoconvFinite(value, min, max float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= min && value <= max
}

// NewBaiduGeoconvForwardRequest is an internal-only, fixed-host builder.
// The AK-bearing request must never be logged, returned from a public API,
// included in an Agent IPC, or handled by a renderer. Caller must first prove
// Owner authorization, effective location privacy policy and current revision.
// No production caller exists in this phase and no map proxy route is added.
func NewBaiduGeoconvForwardRequest(ctx context.Context, serverAK string, coordinates []WGS84Coordinate) (*http.Request, error) {
	if ctx == nil || ctx.Err() != nil || len(coordinates) == 0 || len(coordinates) > BaiduGeoconvMaxBatch ||
		len(serverAK) == 0 || len(serverAK) > 512 {
		return nil, ErrBaiduGeoconvUnavailable
	}
	for _, r := range serverAK {
		if r < '!' || r > '~' {
			return nil, ErrBaiduGeoconvUnavailable
		}
	}
	values := make([]string, 0, len(coordinates))
	for _, coordinate := range coordinates {
		if !geoconvFinite(coordinate.Longitude, -180, 180) || !geoconvFinite(coordinate.Latitude, -90, 90) {
			return nil, ErrBaiduGeoconvUnavailable
		}
		lng := strconv.FormatFloat(coordinate.Longitude, 'f', -1, 64)
		lat := strconv.FormatFloat(coordinate.Latitude, 'f', -1, 64)
		values = append(values, lng+","+lat)
	}
	endpoint, _ := url.Parse(baiduGeoconvForwardURL)
	query := url.Values{}
	query.Set("ak", serverAK)
	query.Set("coords", strings.Join(values, ";"))
	query.Set("model", "2") // Official Geoconv v2: GPS -> bd09ll; NOT JSAPI Convertor's 1->5.
	query.Set("output", "json")
	endpoint.RawQuery = query.Encode()
	if len(endpoint.RawQuery) > baiduGeoconvMaxQueryBytes {
		return nil, ErrBaiduGeoconvUnavailable
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, ErrBaiduGeoconvUnavailable
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Encoding", "identity")
	return req, nil
}

// CheckBaiduGeoconvForwardResponse rejects untrusted or truncated provider
// responses. Only the expected bounded numeric BD-09 pairs escape; no raw
// response, server AK or private source GPS ever leaves this Server package.
func CheckBaiduGeoconvForwardResponse(response *http.Response, serverAK string, expected int) ([]BD09Coordinate, error) {
	if response == nil || response.Body == nil || response.StatusCode != http.StatusOK ||
		len(serverAK) == 0 || expected <= 0 || expected > BaiduGeoconvMaxBatch ||
		response.ContentLength > BaiduGeoconvMaxResponseBytes ||
		response.Header.Get("Location") != "" {
		return nil, ErrBaiduGeoconvUnavailable
	}
	encoding := response.Header.Get("Content-Encoding")
	if encoding != "" && !strings.EqualFold(encoding, "identity") {
		return nil, ErrBaiduGeoconvUnavailable
	}
	contentType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || contentType != "application/json" {
		return nil, ErrBaiduGeoconvUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, BaiduGeoconvMaxResponseBytes+1))
	if err != nil || len(body) == 0 || len(body) > BaiduGeoconvMaxResponseBytes {
		return nil, ErrBaiduGeoconvUnavailable
	}
	for _, secret := range []string{serverAK, url.QueryEscape(serverAK),
		base64.StdEncoding.EncodeToString([]byte(serverAK))} {
		if secret != "" && bytes.Contains(body, []byte(secret)) {
			return nil, ErrBaiduGeoconvUnavailable
		}
	}
	var payload struct {
		Status *int `json:"status"`
		Result []struct {
			X *float64 `json:"x"`
			Y *float64 `json:"y"`
		} `json:"result"`
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil || payload.Status == nil ||
		*payload.Status != 0 || len(payload.Result) != expected {
		return nil, ErrBaiduGeoconvUnavailable
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return nil, ErrBaiduGeoconvUnavailable
	}
	converted := make([]BD09Coordinate, 0, len(payload.Result))
	for _, point := range payload.Result {
		if point.X == nil || point.Y == nil ||
			!geoconvFinite(*point.X, -180, 180) || !geoconvFinite(*point.Y, -90, 90) {
			return nil, ErrBaiduGeoconvUnavailable
		}
		converted = append(converted, BD09Coordinate{Longitude: *point.X, Latitude: *point.Y})
	}
	return converted, nil
}

// ForwardWGS84ToBD09 performs the pinned Server-only Baidu Geoconv v2 request.
// No current production caller exists. The caller must bind every point to a
// currently authorized owner and source revision before invoking this helper;
// it must independently enforce privacy, operator intent and per-owner quotas.
func ForwardWGS84ToBD09(ctx context.Context, serverAK string, coordinates []WGS84Coordinate) ([]BD09Coordinate, error) {
	return forwardWGS84ToBD09WithClient(ctx, serverAK, coordinates, SafeHTTPClient())
}

// Injecting an HTTP client is deliberately package-private and for isolated
// tests only. Production always uses SafeHTTPClient (no environment proxy,
// no redirects, TLS verification, fixed 5-second deadline).
func forwardWGS84ToBD09WithClient(ctx context.Context, serverAK string, coordinates []WGS84Coordinate, client *http.Client) ([]BD09Coordinate, error) {
	if client == nil {
		return nil, ErrBaiduGeoconvUnavailable
	}
	request, err := NewBaiduGeoconvForwardRequest(ctx, serverAK, coordinates)
	if err != nil {
		return nil, ErrBaiduGeoconvUnavailable
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, ErrBaiduGeoconvUnavailable
	}
	defer response.Body.Close()
	return CheckBaiduGeoconvForwardResponse(response, serverAK, len(coordinates))
}
