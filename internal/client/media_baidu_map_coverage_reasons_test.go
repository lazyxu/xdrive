package client

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMediaBaiduMapCoverageReasonsStrictTransport(t *testing.T) {
	good := `{"scope":"indexed_ready_photoassets","valid_gps_assets":9,"eligible_bd09_assets":2,"not_eligible_bd09_assets":7,"consent_unavailable_assets":3,"consent_source_changed_assets":1,"derived_missing_assets":2,"derived_invalid_assets":1,"map_runtime_verified":false}`
	var v MediaBaiduMapCoverageReasons
	if err := json.Unmarshal([]byte(good), &v); err != nil || !v.ValidForTransport() {
		t.Fatalf("safe counts denied: %v", err)
	}
	invalid := []string{
		strings.Replace(good, `"derived_invalid_assets":1`, `"derived_invalid_assets":2`, 1),
		strings.Replace(good, `"derived_missing_assets":2,`, "", 1),
		strings.Replace(good, `"eligible_bd09_assets":2`, `"eligible_bd09_assets":-1`, 1),
		strings.Replace(good, `"eligible_bd09_assets":2`, `"eligible_bd09_assets":3.5`, 1),
		strings.Replace(good, `"map_runtime_verified":false`, `"map_runtime_verified":true`, 1),
		strings.Replace(good, `"scope":"indexed_ready_photoassets"`, `"scope":"all-users"`, 1),
		strings.Replace(good, `"valid_gps_assets":9`, `"valid_gps_assets":null`, 1),
		strings.Replace(good, `"scope":"indexed_ready_photoassets"`, `"scope":"indexed_ready_photoassets","owner_id":42`, 1),
		strings.Replace(good, `"scope":"indexed_ready_photoassets"`, `"scope":"indexed_ready_photoassets","latitude":39.9`, 1),
	}
	for _, input := range invalid {
		var bad MediaBaiduMapCoverageReasons
		if err := json.Unmarshal([]byte(input), &bad); err == nil {
			t.Fatalf("unsafe response accepted: %s", input)
		}
	}
}
