package caddyhostidentity

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func fixture() (string, string) {
	return strings.Repeat("a", 64) + "|2026-10-22T00:15:00Z|123|true|healthy\n", strings.Repeat("b", 64) + "  -\n"
}
func TestReadOnlyDockerArgsAndBound(t *testing.T) {
	inspect, ok := privateDockerReadOnlyArguments(privateHostDockerGeneration)
	if !ok || len(inspect) != 4 || inspect[0] != "inspect" || inspect[2] != privateInspectTemplate || inspect[3] != "xdrive-caddy" {
		t.Fatal("unsafe inspect args")
	}
	active, ok := privateDockerReadOnlyArguments(privateHostCaddyLiveConfig)
	if !ok || len(active) != 5 || active[0] != "exec" || active[1] != "xdrive-caddy" || active[4] != privateLiveHashScript {
		t.Fatal("unsafe active args")
	}
	if args, ok := privateDockerReadOnlyArguments(255); ok || args != nil {
		t.Fatal("arbitrary Docker allowed")
	}
	o := &privateLimitedDockerOutput{}
	if n, err := o.Write([]byte(strings.Repeat("x", 200))); err != nil || n != 200 {
		t.Fatal("bounded output rejected")
	}
	if n, err := o.Write([]byte(strings.Repeat("y", 57))); err == nil || n != 0 || len(o.bytes) != 200 {
		t.Fatal("output overflow admitted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := runPrivateFixedDockerSample(ctx, privateHostDockerGeneration); err == nil {
		t.Fatal("executed canceled Docker")
	}
}
func TestReadOnlyRuntimeWindow(t *testing.T) {
	inspect, digest := fixture()
	calls := []string{}
	run := func(_ context.Context, k privateHostSampleKind) ([]byte, error) {
		if k == privateHostDockerGeneration {
			calls = append(calls, "inspect")
			return []byte(inspect), nil
		}
		calls = append(calls, "config")
		return []byte(digest), nil
	}
	now := time.Date(2026, 10, 22, 0, 18, 0, 0, time.UTC)
	got, err := privateObserveStableCaddyWindow(context.Background(), run, func(context.Context) error { calls = append(calls, "probe"); return nil }, now)
	if err != nil || !validDigest(got.instanceSHA) || !validDigest(got.generationSHA) || got.liveConfigSHA != strings.Repeat("b", 64) {
		t.Fatal("stable window failed", err)
	}
	if strings.Join(calls, ",") != "inspect,config,probe,inspect,config" {
		t.Fatalf("bad sequence %v", calls)
	}
	result, err := json.Marshal(got)
	if err != nil || string(result) != "{}" {
		t.Fatal("raw host identity exposed")
	}
}
func TestReadOnlyRuntimeWindowRejectsChanges(t *testing.T) {
	inspect, digest := fixture()
	now := time.Date(2026, 10, 22, 0, 18, 0, 0, time.UTC)
	changes := []struct{ name, inspect, digest string }{
		{"restart", strings.Replace(inspect, "|123|", "|124|", 1), digest},
		{"recreate", strings.Repeat("c", 64) + inspect[64:], digest},
		{"reload", inspect, strings.Repeat("d", 64) + "  -\n"},
		{"bad hash", inspect, "INVALID"},
		{"other inspect line", inspect + "additional\n", digest},
	}
	for _, tt := range changes {
		t.Run(tt.name, func(t *testing.T) {
			calls := 0
			run := func(_ context.Context, k privateHostSampleKind) ([]byte, error) {
				calls++
				if calls <= 2 {
					if k == privateHostDockerGeneration {
						return []byte(inspect), nil
					}
					return []byte(digest), nil
				}
				if k == privateHostDockerGeneration {
					return []byte(tt.inspect), nil
				}
				return []byte(tt.digest), nil
			}
			got, err := privateObserveStableCaddyWindow(context.Background(), run, func(context.Context) error { return nil }, now)
			if err == nil || got != (boundPrivateCaddyRuntime{}) {
				t.Fatal("mixed observation admitted")
			}
		})
	}
}
func TestReadOnlyRuntimeRejectsMalformedAndCanceled(t *testing.T) {
	inspect, digest := fixture()
	now := time.Date(2026, 10, 22, 0, 18, 0, 0, time.UTC)
	good := func(_ context.Context, k privateHostSampleKind) ([]byte, error) {
		if k == privateHostDockerGeneration {
			return []byte(inspect), nil
		}
		return []byte(digest), nil
	}
	if _, err := privateObserveStableCaddyWindow(context.Background(), good, nil, now); err == nil {
		t.Fatal("nil probe admitted")
	}
	if _, err := privateObserveStableCaddyWindow(context.Background(), nil, func(context.Context) error { return nil }, now); err == nil {
		t.Fatal("nil sampler admitted")
	}
	if _, err := privateObserveStableCaddyWindow(context.Background(), good, func(context.Context) error { return errors.New("unsafe") }, now); err == nil {
		t.Fatal("failed probe admitted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := privateObserveStableCaddyWindow(ctx, good, func(context.Context) error { return nil }, now); err == nil {
		t.Fatal("canceled sample accepted")
	}
	for _, bad := range []string{inspect + "\n", inspect + "other\n", strings.Repeat("Z", 64) + inspect[64:], strings.Repeat("x", 257), ""} {
		_, err := privateReadCaddyRuntimeSample(context.Background(), func(_ context.Context, k privateHostSampleKind) ([]byte, error) {
			if k == privateHostDockerGeneration {
				return []byte(bad), nil
			}
			return []byte(digest), nil
		})
		if err == nil {
			t.Fatal("bad inspect accepted")
		}
	}
	for _, bad := range []string{strings.Repeat("b", 64) + "\n", strings.Repeat("b", 64) + "  *\n", strings.Repeat("0", 64) + "  -\n", emptySHA256 + "  -\n", strings.Repeat("B", 64) + "  -\n"} {
		_, err := privateReadCaddyRuntimeSample(context.Background(), func(_ context.Context, k privateHostSampleKind) ([]byte, error) {
			if k == privateHostDockerGeneration {
				return []byte(inspect), nil
			}
			return []byte(bad), nil
		})
		if err == nil {
			t.Fatal("bad hash accepted")
		}
	}
}
