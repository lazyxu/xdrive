package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// Privacy-only fixed Server route; no GPS positions or photo identifiers.
type MediaBaiduMapCoverageReasons struct {
	Scope                      string `json:"scope"`
	ValidGPSAssets             int64  `json:"valid_gps_assets"`
	EligibleBD09Assets         int64  `json:"eligible_bd09_assets"`
	NotEligibleBD09Assets      int64  `json:"not_eligible_bd09_assets"`
	ConsentUnavailableAssets   int64  `json:"consent_unavailable_assets"`
	ConsentSourceChangedAssets int64  `json:"consent_source_changed_assets"`
	DerivedMissingAssets       int64  `json:"derived_missing_assets"`
	DerivedInvalidAssets       int64  `json:"derived_invalid_assets"`
	MapRuntimeVerified         bool   `json:"map_runtime_verified"`
}

// Every field must be present. A missing count is NOT a genuine 0 photo
// result, and unreviewed fields must not enter the Desktop count channel.
func (v *MediaBaiduMapCoverageReasons) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	fields := map[string]any{
		"scope":                         &v.Scope,
		"valid_gps_assets":              &v.ValidGPSAssets,
		"eligible_bd09_assets":          &v.EligibleBD09Assets,
		"not_eligible_bd09_assets":      &v.NotEligibleBD09Assets,
		"consent_unavailable_assets":    &v.ConsentUnavailableAssets,
		"consent_source_changed_assets": &v.ConsentSourceChangedAssets,
		"derived_missing_assets":        &v.DerivedMissingAssets,
		"derived_invalid_assets":        &v.DerivedInvalidAssets,
		"map_runtime_verified":          &v.MapRuntimeVerified,
	}
	if len(raw) != len(fields) {
		return fmt.Errorf("invalid map coverage reasons response fields")
	}
	for key, dest := range fields {
		value, ok := raw[key]
		if !ok || len(value) == 0 || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("missing map coverage reasons field")
		}
		if err := json.Unmarshal(value, dest); err != nil {
			return fmt.Errorf("invalid map coverage reasons field: %w", err)
		}
	}
	if !v.ValidForTransport() {
		return fmt.Errorf("invalid map coverage reasons counts")
	}
	return nil
}

func (v MediaBaiduMapCoverageReasons) ValidForTransport() bool {
	if v.Scope != "indexed_ready_photoassets" || v.MapRuntimeVerified ||
		v.ValidGPSAssets < 0 || v.EligibleBD09Assets < 0 ||
		v.EligibleBD09Assets > v.ValidGPSAssets ||
		v.NotEligibleBD09Assets != v.ValidGPSAssets-v.EligibleBD09Assets {
		return false
	}
	remaining := v.NotEligibleBD09Assets
	for _, part := range []int64{v.ConsentUnavailableAssets, v.ConsentSourceChangedAssets,
		v.DerivedMissingAssets, v.DerivedInvalidAssets} {
		if part < 0 || part > remaining {
			return false
		}
		remaining -= part
	}
	return remaining == 0
}

func (c *Client) MediaBaiduMapCoverageReasons(ctx context.Context) (MediaBaiduMapCoverageReasons, error) {
	var out MediaBaiduMapCoverageReasons
	if ctx == nil || ctx.Err() != nil {
		return out, fmt.Errorf("invalid map coverage reasons context")
	}
	err := c.json(ctx, http.MethodGet, "/api/v1/media/places/baidu-jsapi/coverage-reasons", nil, &out)
	if err != nil {
		return MediaBaiduMapCoverageReasons{}, err
	}
	if ctx.Err() != nil || !out.ValidForTransport() {
		return MediaBaiduMapCoverageReasons{}, fmt.Errorf("map coverage reasons unavailable")
	}
	return out, nil
}
