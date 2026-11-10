package client

import (
	"encoding/json"
	"strings"
	"testing"
)

// Agent typed DTOs must preserve non-secret mask lengths from Server to IPC.
// Otherwise Desktop silently falls back to the legacy eight-star display.
func TestCredentialMaskLengthMetadataSurvivesAgentJSON(t *testing.T) {
	cases := []struct {
		name    string
		payload string
		target  any
		fields  []string
	}{
		{
			name: "AliDNS independent fields",
			payload: `{"configured":true,"access_key_id_length":18,"access_key_secret_length":37}`,
			target: &AdminCaddyAliDNSConfig{},
			fields: []string{`"access_key_id_length":18`, `"access_key_secret_length":37`},
		},
		{
			name: "Baidu Server AK",
			payload: `{"configured":true,"ak_length":23}`,
			target: &AdminBaiduMapConfig{},
			fields: []string{`"ak_length":23`},
		},
		{
			name: "Baidu Browser AK",
			payload: `{"configured":true,"browser_ak_length":29}`,
			target: &AdminBaiduJSAPIConfig{},
			fields: []string{`"browser_ak_length":29`},
		},
		{
			name: "Source Cookie and DSM password",
			payload: `{"source":{"id":10,"kind":"yike_photos"},"credential":{"configured":true,"value_length":53}}`,
			target: &SourceOverview{},
			fields: []string{`"value_length":53`},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := json.Unmarshal([]byte(tc.payload), tc.target); err != nil {
				t.Fatal(err)
			}
			out, err := json.Marshal(tc.target)
			if err != nil {
				t.Fatal(err)
			}
			for _, field := range tc.fields {
				if !strings.Contains(string(out), field) {
					t.Fatalf("agent dropped %s after typed JSON round trip: %s", field, out)
				}
			}
		})
	}
}
