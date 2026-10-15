package api

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPrivatePhotoHostBearerNeverMeansSafeStop(t *testing.T) {
	yes, no := true, false
	legacy := []photoHostModelInfoCheck{{ID: "photo-face", State: "ready"}}
	explicitFalse := []photoHostModelInfoCheck{{ID: "photo-face", State: "ready", auth: &no}}
	explicitTrue := []photoHostModelInfoCheck{{ID: "photo-face", State: "ready", auth: &yes}}
	failed := []photoHostModelInfoCheck{{ID: "photo-face", State: "failed", auth: &no}}
	if got := photoHostPrivateIngressAuthBlockerState(false, true, nil); got != "blocked" {
		t.Fatalf("local model missing token was not a blocker: %s", got)
	}
	if got := photoHostPrivateIngressAuthBlockerState(false, false, nil); got != "unverified" {
		t.Fatalf("absent analyzer was not unverified: %s", got)
	}
	if got := photoHostPrivateIngressAuthBlockerState(true, true, explicitFalse); got != "blocked" {
		t.Fatalf("model self-reported tokenless was not blocked: %s", got)
	}
	for _, checks := range [][]photoHostModelInfoCheck{nil, legacy, explicitTrue, failed} {
		if got := photoHostPrivateIngressAuthBlockerState(true, true, checks); got != "unverified" {
			t.Fatalf("configured/old/failed Info produced false safe status: %s", got)
		}
	}
	raw, err := json.Marshal(explicitFalse)
	if err != nil || strings.Contains(string(raw), "private_bearer_auth_required") ||
		strings.Contains(string(raw), "auth") {
		t.Fatalf("private model authentication proof escaped admin JSON: %s / %v", raw, err)
	}
}
