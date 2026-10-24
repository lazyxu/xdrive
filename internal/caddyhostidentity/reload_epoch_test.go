package caddyhostidentity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestCaddyReloadMetricStrictCurrentParse(t *testing.T) {
	now := time.Date(2026, 10, 24, 3, 40, 0, 0, time.UTC)
	stamp := float64(now.Add(-time.Minute).Unix()) + 0.125
	good := fmt.Sprintf("caddy_config_last_reload_successful 1\ncaddy_config_last_reload_success_timestamp_seconds %.3f\n", stamp)
	got, err := privateParseCaddyReloadEpoch([]byte(good), now)
	if err != nil || got.successAt != stamp || !validDigest(got.mutationSHA) {
		t.Fatalf("valid Caddy reload time was rejected: %v", err)
	}
	for name, raw := range map[string]string{
		"missing success":     strings.SplitN(good, "\n", 2)[1],
		"failed reload":       strings.Replace(good, "successful 1", "successful 0", 1),
		"duplicate gauge":     good + "caddy_config_last_reload_successful 1\n",
		"trailing response":   good + "HTTP 200 OK\n",
		"untrusted label":     strings.Replace(good, "successful 1", "successful{host=\"old\"} 1", 1),
		"missing trailing LF": strings.TrimSuffix(good, "\n"),
		"future timestamp":    strings.Replace(good, fmt.Sprintf("%.3f", stamp), fmt.Sprintf("%d", now.Add(time.Hour).Unix()), 1),
		"NaN timestamp":       strings.Replace(good, fmt.Sprintf("%.3f", stamp), "NaN", 1),
		"infinite timestamp":  strings.Replace(good, fmt.Sprintf("%.3f", stamp), "+Inf", 1),
		"zero timestamp":      strings.Replace(good, fmt.Sprintf("%.3f", stamp), "0", 1),
		"oversize":            strings.Repeat("x", privateSampleBytesMax+1),
		"HTTP error body":     "503 backend unavailable\n",
	} {
		t.Run(name, func(t *testing.T) {
			got, err := privateParseCaddyReloadEpoch([]byte(raw), now)
			if err == nil || got != (privateCaddyReloadEpoch{}) {
				t.Fatal("untrusted reload gauge accepted")
			}
		})
	}
	if _, err := privateParseCaddyReloadEpoch([]byte(good), time.Time{}); err == nil {
		t.Fatal("missing wall clock accepted")
	}
}

func TestReloadCheckpointRejectsSameConfigABAAndMissingGauge(t *testing.T) {
	baseline := privateIngressTransportCandidates{
		runtime:     boundPrivateCaddyRuntime{hostLocalGenerationSHA: strings.Repeat("b", 64)},
		routeDigest: strings.Repeat("c", 64),
	}
	for _, tc := range []struct {
		name           string
		second         float64
		secondMutation string
		failRead       bool
		failProbe      bool
		wantOK         bool
	}{
		{name: "stable same runtime", second: 1700000000.125, wantOK: true},
		{name: "A-B-A successful reload same SHA", second: 1700000000.250},
		{name: "forced same JSON reload", second: 1700000000.500},
		{name: "failed admin mutation with unchanged success timestamp", second: 1700000000.125, secondMutation: strings.Repeat("b", 64)},
		{name: "missing metrics after probe", second: 1700000000.125, failRead: true},
		{name: "failed original observation", second: 1700000000.125, failProbe: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var trace []string
			reads := 0
			read := func(context.Context) (privateCaddyReloadEpoch, error) {
				reads++
				trace = append(trace, "metrics")
				if tc.failRead && reads == 2 {
					return privateCaddyReloadEpoch{}, errors.New("metrics not available")
				}
				if reads == 1 {
					return privateCaddyReloadEpoch{successAt: 1700000000.125, mutationSHA: strings.Repeat("a", 64)}, nil
				}
				mutation := tc.secondMutation
				if mutation == "" {
					mutation = strings.Repeat("a", 64)
				}
				return privateCaddyReloadEpoch{successAt: tc.second, mutationSHA: mutation}, nil
			}
			observe := func(context.Context) (privateIngressTransportCandidates, error) {
				trace = append(trace, "original-host-tls-route")
				if tc.failProbe {
					return privateIngressTransportCandidates{}, errors.New("old source changed")
				}
				return baseline, nil
			}
			candidate, err := privateObserveWithCaddyReloadCheckpoint(context.Background(), read, observe)
			if tc.wantOK {
				if err != nil || !validDigest(candidate.reloadCheckpointDigest) || candidate.runtime != baseline.runtime ||
					strings.Join(trace, ",") != "metrics,original-host-tls-route,metrics" {
					t.Fatalf("stable source checkpoint not retained: %v (%v)", err, trace)
				}
				out, marshalErr := json.Marshal(candidate)
				if marshalErr != nil || string(out) != "{}" {
					t.Fatal("Host private reload evidence exposed via serialization")
				}
			} else if err == nil || candidate != (privateIngressTransportCandidates{}) {
				t.Fatal("reloaded/failed source accepted as stable")
			}
		})
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	read := func(context.Context) (privateCaddyReloadEpoch, error) {
		t.Fatal("cancelled request must not read Caddy")
		return privateCaddyReloadEpoch{}, nil
	}
	if _, err := privateObserveWithCaddyReloadCheckpoint(cancelled, read, nil); err == nil {
		t.Fatal("missing observer accepted")
	}
	if _, err := privateReadCurrentCaddyReloadEpoch(cancelled); err == nil {
		t.Fatal("cancelled Docker metrics query accepted")
	}
	if _, err := privateReadCurrentCaddyReloadEpoch(nil); err == nil {
		t.Fatal("nil context Docker metrics query accepted")
	}
	if !strings.Contains(privateCaddyReloadMetricScript, "http://127.0.0.1:2019/metrics") ||
		strings.Contains(privateCaddyReloadMetricScript, "https://") {
		t.Fatal("Caddy reload gauge unexpectedly accepted an external URL")
	}
}

func TestReloadEpochIncludesCompletedAdminMutationCounters(t *testing.T) {
	now := time.Date(2026, 10, 24, 13, 30, 0, 0, time.UTC)
	ordinary := "caddy_config_last_reload_successful 1\ncaddy_config_last_reload_success_timestamp_seconds 1792848500\n"
	load := `caddy_admin_http_requests_total{code="200",handler="load",method="POST",path="/load"} 1` + "\n"
	failed := `caddy_admin_http_requests_total{code="400",handler="load",method="POST",path="/load"} 1` + "\n"
	first, err := privateParseCaddyReloadEpoch([]byte(ordinary+load), now)
	if err != nil || !validDigest(first.mutationSHA) {
		t.Fatalf("valid Caddy admin metrics rejected: %v", err)
	}
	second, err := privateParseCaddyReloadEpoch([]byte(ordinary+load+failed), now)
	if err != nil || first.mutationSHA == second.mutationSHA || first.successAt != second.successAt {
		t.Fatal("a completed failed reload with the same successful timestamp went undetected")
	}
	for _, malformed := range []string{
		ordinary + load + load,
		ordinary + `caddy_admin_http_requests_total{method="POST"} 1` + "\n",
		ordinary + `caddy_admin_http_requests_total{code="200",handler="load",method="POST",path="/load"} 1.5` + "\n",
	} {
		if _, err := privateParseCaddyReloadEpoch([]byte(malformed), now); err == nil {
			t.Fatal("ambiguous admin mutation sample accepted")
		}
	}
}

func TestCaddyAdminReadCountDoesNotChangeReloadCheckpoint(t *testing.T) {
	now := time.Date(2026, 10, 24, 13, 30, 0, 0, time.UTC)
	gauges := "caddy_config_last_reload_successful 1\ncaddy_config_last_reload_success_timestamp_seconds 1792848500\n"
	write := `caddy_admin_http_requests_total{code="200",handler="load",method="POST",path="/load"} 1` + "\n"
	readA := `caddy_admin_http_requests_total{code="200",handler="metrics",method="GET",path="/metrics"} 5` + "\n"
	readB := `caddy_admin_http_requests_total{code="200",handler="metrics",method="GET",path="/metrics"} 500` + "\n"
	before, err := privateParseCaddyReloadEpoch([]byte(gauges+write+readA), now)
	if err != nil {
		t.Fatal(err)
	}
	after, err := privateParseCaddyReloadEpoch([]byte(gauges+readB+write), now)
	if err != nil || before.mutationSHA != after.mutationSHA {
		t.Fatalf("read-only metrics scrape mutated the epoch: %v", err)
	}
	calls := 0
	reader := func(context.Context) (privateCaddyReloadEpoch, error) {
		calls++
		if calls == 1 {
			return before, nil
		}
		return after, nil
	}
	observe := func(context.Context) (privateIngressTransportCandidates, error) {
		return privateIngressTransportCandidates{
			routeDigest: strings.Repeat("a", 64),
			runtime:     boundPrivateCaddyRuntime{hostLocalGenerationSHA: strings.Repeat("b", 64)},
		}, nil
	}
	got, err := privateObserveWithCaddyReloadCheckpoint(context.Background(), reader, observe)
	if err != nil || !validDigest(got.reloadCheckpointDigest) {
		t.Fatalf("stable Caddy with changing GET count was rejected: %v", err)
	}
}

func TestReloadEpochRejectsCompletedAdminErrorCounterAdvance(t *testing.T) {
	now := time.Date(2026, 10, 24, 13, 30, 0, 0, time.UTC)
	reload := "caddy_config_last_reload_successful 1\ncaddy_config_last_reload_success_timestamp_seconds 1792848500\n"
	write := `caddy_admin_http_requests_total{code="200",handler="load",method="POST",path="/load"} 1` + "\n"
	errorCount := `caddy_admin_http_request_errors_total{handler="load",method="POST",path="/load"} 1` + "\n"
	first, err := privateParseCaddyReloadEpoch([]byte(reload+write), now)
	if err != nil || !validDigest(first.mutationSHA) {
		t.Fatalf("baseline Caddy metrics unexpectedly invalid: %v", err)
	}
	second, err := privateParseCaddyReloadEpoch([]byte(reload+write+errorCount), now)
	if err != nil || !validDigest(second.mutationSHA) || first.successAt != second.successAt ||
		first.mutationSHA == second.mutationSHA {
		t.Fatalf("completed Admin error did not invalidate unchanged reload epoch: %v", err)
	}
	for _, malformed := range []string{
		reload + errorCount + errorCount,
		reload + `caddy_admin_http_request_errors_total{handler="load",method="TRACE",path="/load"} 1` + "\n",
		reload + `caddy_admin_http_request_errors_total{handler="load",method="POST",path="/load",other="x"} 1` + "\n",
	} {
		if _, err := privateParseCaddyReloadEpoch([]byte(malformed), now); err == nil {
			t.Fatal("ambiguous Caddy Admin error metric accepted")
		}
	}
	if !strings.Contains(privateCaddyReloadMetricScript, "caddy_admin_http_request_errors_total") {
		t.Fatal("the fixed Caddy sampler omitted Admin error metrics")
	}
}
