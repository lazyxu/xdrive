package client

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMediaBaiduMapCoverageRejectsMalformedCounts(t *testing.T) {
	good := MediaBaiduMapCoverage{
		Scope: "indexed_ready_photoassets", ValidGPSAssets: 10,
		EligibleBD09Assets: 6, NotEligibleBD09Assets: 4,
		SourceOutsideCameraLatitudeAssets: 2,
	}
	if !good.ValidForTransport() {
		t.Fatal("valid Owner aggregate rejected")
	}
	for _, mutate := range []func(*MediaBaiduMapCoverage){
		func(v *MediaBaiduMapCoverage) { v.Scope = "all_asset_ids" },
		func(v *MediaBaiduMapCoverage) { v.ValidGPSAssets = -1 },
		func(v *MediaBaiduMapCoverage) { v.EligibleBD09Assets = 11 },
		func(v *MediaBaiduMapCoverage) { v.NotEligibleBD09Assets = 0 },
		func(v *MediaBaiduMapCoverage) { v.SourceOutsideCameraLatitudeAssets = 11 },
		func(v *MediaBaiduMapCoverage) { v.MapRuntimeVerified = true },
	} {
		sample := good
		mutate(&sample)
		if sample.ValidForTransport() {
			t.Fatalf("invalid map coverage accepted: %+v", sample)
		}
	}
	if !(MediaBaiduMapCoverage{Scope: "indexed_ready_photoassets"}).ValidForTransport() {
		t.Fatal("genuine empty indexed Owner count should be valid")
	}
}

func TestMediaBaiduMapCoverageJSONRequiresEveryReviewedField(t *testing.T) {
	good := `{"scope":"indexed_ready_photoassets","valid_gps_assets":5,"eligible_bd09_assets":3,"not_eligible_bd09_assets":2,"source_outside_camera_latitude_assets":0,"map_runtime_verified":false}`
	var parsed MediaBaiduMapCoverage
	if err := json.Unmarshal([]byte(good), &parsed); err != nil || !parsed.ValidForTransport() {
		t.Fatalf("valid map coverage JSON rejected: %v", err)
	}
	for _, fragment := range []string{
		strings.Replace(good, `"valid_gps_assets":5,`, "", 1),
		strings.Replace(good, `"eligible_bd09_assets":3,`, "", 1),
		strings.Replace(good, `"not_eligible_bd09_assets":2,`, "", 1),
		strings.Replace(good, `"source_outside_camera_latitude_assets":0,`, "", 1),
		strings.Replace(good, `"map_runtime_verified":false`, `"map_runtime_verified":null`, 1),
		strings.Replace(good, `"valid_gps_assets":5`, `"valid_gps_assets":null`, 1),
		strings.Replace(good, `"valid_gps_assets":5`, `"valid_gps_assets":5.3`, 1),
		strings.Replace(good, `"scope":"indexed_ready_photoassets"`, `"scope":null`, 1),
		strings.Replace(good, `"map_runtime_verified":false`, `"map_runtime_verified":false,"source_longitude":119.9`, 1),
	} {
		var got MediaBaiduMapCoverage
		if err := json.Unmarshal([]byte(fragment), &got); err == nil {
			t.Fatalf("incomplete or sensitive map coverage accepted: %s", fragment)
		}
	}
}
