package client

import (
	"encoding/json"
	"testing"
)

func TestAdminPhotoHostTransportDoesNotInferAppliedFromHostHealth(t *testing.T) {
	payloads := []string{
		`{"desired_enabled":true,"revision":7,"source":"saved","apply_state":"pending","editable":true,"apply_supported":false,"host_observed":true,"host_runtime_state":"healthy","host_profile_configured":true}`,
		`{"desired_enabled":false,"revision":0,"source":"default","apply_state":"unmanaged","editable":true,"apply_supported":false,"host_observed":false,"host_runtime_state":"unknown"}`,
	}
	for i, raw := range payloads {
		var got AdminPhotoHostConfig
		if err := json.Unmarshal([]byte(raw), &got); err != nil {
			t.Fatal(err)
		}
		if got.ApplySupported || got.ApplyState == "applied" {
			t.Fatalf("host desired transport invented apply capability: %+v", got)
		}
		if i == 0 && (got.HostProfileConfigured == nil || !*got.HostProfileConfigured || !got.HostObserved) {
			t.Fatalf("host profile true lost over transport: %+v", got)
		}
		if i == 1 && (got.HostProfileConfigured != nil || got.HostObserved || got.DesiredEnabled) {
			t.Fatalf("unmanaged/missing host evidence falsely ready: %+v", got)
		}
	}
}
