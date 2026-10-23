package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// Privacy-only fixed Server route; no GPS positions or photo identifiers.
type MediaBaiduMapCoverage struct {
	Scope                             string `json:"scope"`
	ValidGPSAssets                    int64  `json:"valid_gps_assets"`
	EligibleBD09Assets                int64  `json:"eligible_bd09_assets"`
	NotEligibleBD09Assets             int64  `json:"not_eligible_bd09_assets"`
	SourceOutsideCameraLatitudeAssets int64  `json:"source_outside_camera_latitude_assets"`
	MapRuntimeVerified                bool   `json:"map_runtime_verified"`
}

// Every field must be present. A missing count is NOT a genuine 0 photo
// result, and unreviewed fields must not enter the Desktop count channel.
func (v *MediaBaiduMapCoverage) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	fields := map[string]any{
		"scope":                                 &v.Scope,
		"valid_gps_assets":                      &v.ValidGPSAssets,
		"eligible_bd09_assets":                  &v.EligibleBD09Assets,
		"not_eligible_bd09_assets":              &v.NotEligibleBD09Assets,
		"source_outside_camera_latitude_assets": &v.SourceOutsideCameraLatitudeAssets,
		"map_runtime_verified":                  &v.MapRuntimeVerified,
	}
	if len(raw) != len(fields) {
		return fmt.Errorf("invalid map coverage response fields")
	}
	for key, dest := range fields {
		value, ok := raw[key]
		if !ok || len(value) == 0 || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("missing map coverage field")
		}
		if err := json.Unmarshal(value, dest); err != nil {
			return fmt.Errorf("invalid map coverage field: %w", err)
		}
	}
	if !v.ValidForTransport() {
		return fmt.Errorf("invalid map coverage counts")
	}
	return nil
}

func (v MediaBaiduMapCoverage) ValidForTransport() bool {
	return v.Scope == "indexed_ready_photoassets" && !v.MapRuntimeVerified &&
		v.ValidGPSAssets >= 0 && v.EligibleBD09Assets >= 0 &&
		v.EligibleBD09Assets <= v.ValidGPSAssets &&
		v.NotEligibleBD09Assets == v.ValidGPSAssets-v.EligibleBD09Assets &&
		v.SourceOutsideCameraLatitudeAssets >= 0 &&
		v.SourceOutsideCameraLatitudeAssets <= v.ValidGPSAssets
}

func (c *Client) MediaBaiduMapCoverage(ctx context.Context) (MediaBaiduMapCoverage, error) {
	var out MediaBaiduMapCoverage
	if ctx == nil || ctx.Err() != nil {
		return out, fmt.Errorf("invalid map coverage context")
	}
	err := c.json(ctx, http.MethodGet, "/api/v1/media/places/baidu-jsapi/coverage", nil, &out)
	if err != nil {
		return MediaBaiduMapCoverage{}, err
	}
	if ctx.Err() != nil || !out.ValidForTransport() {
		return MediaBaiduMapCoverage{}, fmt.Errorf("map coverage unavailable")
	}
	return out, nil
}
