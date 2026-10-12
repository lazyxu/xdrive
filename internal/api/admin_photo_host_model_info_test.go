package api

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestPhotoHostModelInfoRequiresExactHostRequestToken(t *testing.T) {
	desired := photoHostDesired{Revision: 7, Enabled: true}
	gate := meta.AdminPhotoHostApply{
		Revision: 7, State: "host-verified", RequestID: "0123456789abcdef01234567",
	}
	if !photoHostModelInfoAllowed(desired, gate, true, "host-verified") {
		t.Fatal("fresh exact host receipt should permit a manual Info check")
	}
	for name, tc := range map[string]struct {
		desired photoHostDesired
		gate    meta.AdminPhotoHostApply
		present bool
		receipt string
	}{
		"no saved revision": {photoHostDesired{}, gate, true, "host-verified"},
		"saved disable":     {photoHostDesired{Revision: 7}, gate, true, "host-verified"},
		"missing gate":      {desired, gate, false, "host-verified"},
		"stale revision":    {photoHostDesired{Revision: 8, Enabled: true}, gate, true, "host-verified"},
		"queued":            {desired, meta.AdminPhotoHostApply{Revision: 7, State: "queued", RequestID: gate.RequestID}, true, "host-verified"},
		"bad token":         {desired, meta.AdminPhotoHostApply{Revision: 7, State: "host-verified", RequestID: "raw-client-id"}, true, "host-verified"},
		"host drift":        {desired, gate, true, ""},
	} {
		t.Run(name, func(t *testing.T) {
			if photoHostModelInfoAllowed(tc.desired, tc.gate, tc.present, tc.receipt) {
				t.Fatal("untrusted host evidence authorized model readiness")
			}
		})
	}
}

func TestPhotoHostModelInfoIndependentAndRedacted(t *testing.T) {
	leak := "SECRET_MODEL_PATH_/run/private"
	probes := []photoHostModelInfoTask{
		{ID: "photo-face", Configured: true, Probe: func(context.Context) error { return nil }},
		{ID: "photo-smart", Configured: true, Probe: func(context.Context) error { return errors.New(leak) }},
		{ID: "photo-semantic", Configured: false},
		{ID: "photo-creative", Configured: true, Probe: func(context.Context) error { return nil }},
	}
	out := runPhotoHostModelInfoChecks(context.Background(), probes)
	if len(out) != 4 {
		t.Fatalf("expected four fixed states, got %+v", out)
	}
	for i, expected := range []string{"ready", "failed", "unconfigured", "ready"} {
		if out[i].ID != probes[i].ID || out[i].State != expected {
			t.Fatalf("model %d incorrectly reported: %+v", i, out[i])
		}
		if strings.Contains(out[i].Detail, leak) {
			t.Fatal("raw model error escaped trusted boundary")
		}
	}
	for _, item := range unverifiedPhotoHostModelInfoChecks() {
		if item.State != "unknown" {
			t.Fatalf("unproven host was presented as active: %+v", item)
		}
	}
}

func TestPhotoHostModelInfoTimeoutFailsClosed(t *testing.T) {
	block := make(chan struct{})
	defer close(block)
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	begin := time.Now()
	out := runPhotoHostModelInfoChecks(ctx, []photoHostModelInfoTask{
		{ID: "photo-face", Configured: true, Probe: func(context.Context) error {
			<-block
			return nil
		}},
	})
	if time.Since(begin) > time.Second || len(out) != 1 || out[0].State != "unknown" {
		t.Fatalf("timed-out model probe produced false success or blocked request: %+v", out)
	}
}
