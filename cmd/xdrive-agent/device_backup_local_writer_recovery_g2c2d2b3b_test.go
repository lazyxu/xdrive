package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localpushrunner"
	"github.com/lazyxu/xdrive/internal/localpushwriter"
)

func testHistoricalOriginalWriterScope(t *testing.T, session string) localpushwriter.Scope {
	t.Helper()
	configDir := filepath.Join(t.TempDir(), "agent-config")
	rootDir := filepath.Join(t.TempDir(), "backup-root")
	for _, dir := range []string{configDir, rootDir} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	scope, err := localpushwriter.NewScope(
		configDir, rootDir, "https://example.invalid", "local-owner", session,
		"device-original", "root-original", strings.Repeat("a", 64),
		42, 3, 9, strings.Repeat("b", 64), strings.Repeat("c", 64))
	if err != nil {
		t.Fatal(err)
	}
	return scope
}

func TestHistoricalOriginalWriterRecoveryRequiresQuarantineAndExcludesLiveWriter(t *testing.T) {
	ctx := context.Background()
	scope := testHistoricalOriginalWriterScope(t, "session-original")
	reads := 0
	inspect := func(context.Context) (localpushrunner.FirstLeafResult, error) {
		reads++
		return localpushrunner.FirstLeafResult{Confirmed: true}, nil
	}
	if result, err := withHistoricalOriginalWriterReadOnly(ctx, scope, inspect); err == nil ||
		result.Confirmed || !result.Uncertain || reads != 0 {
		t.Fatalf("missing original Writer claim accepted: %+v %v", result, err)
	}
	// The read-only call must not O_CREATE an original marker.
	claim, err := localpushwriter.Begin(ctx, scope)
	if err != nil {
		t.Fatal("a prior read-only attempt created a Writer claim:", err)
	}
	t.Cleanup(func() { _ = claim.Close() })
	if result, err := withHistoricalOriginalWriterReadOnly(ctx, scope, inspect); err == nil ||
		result.Confirmed || !result.Uncertain || reads != 0 {
		t.Fatalf("live Writer lock was accepted: %+v %v", result, err)
	}
	if err := claim.Close(); err != nil {
		t.Fatal(err)
	}
	result, err := withHistoricalOriginalWriterReadOnly(ctx, scope, inspect)
	if err != nil || !result.Confirmed || result.Uncertain || reads != 1 {
		t.Fatalf("historical original read did not run exactly once: %+v %v", result, err)
	}
	if _, err := localpushwriter.Begin(ctx, scope); err == nil {
		t.Fatal("read-only historical recovery released original O_EXCL quarantine")
	}
}

func TestHistoricalOriginalWriterRecoveryRedactsFailureAndPreservesUncertainty(t *testing.T) {
	ctx := context.Background()
	scope := testHistoricalOriginalWriterScope(t, "session-original")
	claim, err := localpushwriter.Begin(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = claim.Close() })
	if err := claim.Close(); err != nil {
		t.Fatal(err)
	}
	denied, err := withHistoricalOriginalWriterReadOnly(ctx, scope,
		func(context.Context) (localpushrunner.FirstLeafResult, error) {
			return localpushrunner.FirstLeafResult{Uncertain: true},
				errors.New("private /home/owner/secret")
		})
	if !errors.Is(err, localpushrunner.ErrUncertain) || denied.Confirmed ||
		!denied.Uncertain || strings.Contains(err.Error(), "/home") {
		t.Fatalf("private error became a successful or public recovery: %+v %v", denied, err)
	}
	denied, err = withHistoricalOriginalWriterReadOnly(ctx, scope,
		func(context.Context) (localpushrunner.FirstLeafResult, error) {
			return localpushrunner.FirstLeafResult{Confirmed: false}, nil
		})
	if !errors.Is(err, localpushrunner.ErrUncertain) || denied.Confirmed || !denied.Uncertain {
		t.Fatalf("missing exact physical proof was accepted: %+v %v", denied, err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	count := 0
	denied, err = withHistoricalOriginalWriterReadOnly(canceled, scope,
		func(context.Context) (localpushrunner.FirstLeafResult, error) {
			count++
			return localpushrunner.FirstLeafResult{Confirmed: true}, nil
		})
	if err == nil || denied.Confirmed || !denied.Uncertain || count != 0 {
		t.Fatalf("canceled original observation succeeded: %+v %v", denied, err)
	}
	if _, err := localpushwriter.Begin(ctx, scope); err == nil {
		t.Fatal("uncertain historical observation allowed a new physical Writer")
	}
}
