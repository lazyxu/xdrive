//go:build linux

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceagent"
	"github.com/lazyxu/xdrive/internal/sourceagentconfig"
)

func TestMigrateRootFingerprintsSeedsLegacyConfig(t *testing.T) {
	root := t.TempDir()
	legacy, err := sourceagent.RootIdentity("shared", root)
	if err != nil {
		t.Fatal(err)
	}
	cfg := sourceagentconfig.Config{
		SharedRoot:   root,
		SharedRootID: legacy,
	}
	changed, err := migrateRootFingerprints(&cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || cfg.SharedRootFingerprint == "" {
		t.Fatalf("fingerprint migration did not seed config: %+v", cfg)
	}
	first := cfg.SharedRootFingerprint

	changed, err = migrateRootFingerprints(&cfg)
	if err != nil {
		t.Fatal(err)
	}
	if changed || cfg.SharedRootFingerprint != first {
		t.Fatalf("stable root unexpectedly changed: changed=%t cfg=%+v", changed, cfg)
	}
}

func TestMigrateRootFingerprintsRejectsReplacedRoot(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "photo")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	legacy, err := sourceagent.RootIdentity("shared", root)
	if err != nil {
		t.Fatal(err)
	}
	fingerprint, err := sourceagent.RootFingerprint("shared", root)
	if err != nil {
		t.Fatal(err)
	}
	cfg := sourceagentconfig.Config{
		SharedRoot:            root,
		SharedRootID:          legacy,
		SharedRootFingerprint: fingerprint,
	}

	old := filepath.Join(parent, "old-photo")
	if err := os.Rename(root, old); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := migrateRootFingerprints(&cfg); err == nil {
		t.Fatal("replaced root was accepted")
	}
}

func TestMigrateRootFingerprintsAllowsLegacyDeviceChange(t *testing.T) {
	root := t.TempDir()
	currentLegacy, err := sourceagent.RootIdentity("shared", root)
	if err != nil {
		t.Fatal(err)
	}
	currentFingerprint, err := sourceagent.RootFingerprint("shared", root)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(currentFingerprint, "root:btime:") {
		t.Skip("filesystem does not expose statx birth time; cross-device migration intentionally fails closed")
	}
	_, inode, ok := sourceagent.ParseLegacyRootIdentity("shared", currentLegacy)
	if !ok {
		t.Fatalf("cannot parse current root identity %q", currentLegacy)
	}
	cfg := sourceagentconfig.Config{
		SharedRoot:   root,
		SharedRootID: fmt.Sprintf("fs:shared:%d:%d", uint64(999999), inode),
	}
	changed, err := migrateRootFingerprints(&cfg)
	if err != nil {
		t.Fatal(err)
	}
	if !changed || cfg.SharedRootFingerprint == "" {
		t.Fatalf("device-change migration failed: %+v", cfg)
	}
}

func TestResolveRunTriggerPendingRequestForcesManual(t *testing.T) {
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	last := now.Add(-time.Minute)
	requested := now.Add(-time.Second)
	trigger, run, err := resolveRunTrigger(client.Source{
		Status: meta.SourceStatusActive, LastRunAt: &last, RunRequestedAt: &requested,
	}, meta.SyncRunTriggerScheduled, true, 6*time.Hour, now)
	if err != nil {
		t.Fatal(err)
	}
	if !run || trigger != meta.SyncRunTriggerManual {
		t.Fatalf("trigger=%q run=%t want manual/true", trigger, run)
	}
}

func TestResolveRunTriggerDueSchedule(t *testing.T) {
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	recent := now.Add(-time.Hour)
	trigger, run, err := resolveRunTrigger(client.Source{
		Status: meta.SourceStatusActive, LastRunAt: &recent,
	}, meta.SyncRunTriggerScheduled, true, 6*time.Hour, now)
	if err != nil {
		t.Fatal(err)
	}
	if run || trigger != meta.SyncRunTriggerScheduled {
		t.Fatalf("recent source trigger=%q run=%t want scheduled/false", trigger, run)
	}

	expired := now.Add(-7 * time.Hour)
	trigger, run, err = resolveRunTrigger(client.Source{
		Status: meta.SourceStatusActive, LastRunAt: &expired,
	}, meta.SyncRunTriggerScheduled, true, 6*time.Hour, now)
	if err != nil {
		t.Fatal(err)
	}
	if !run || trigger != meta.SyncRunTriggerScheduled {
		t.Fatalf("expired source trigger=%q run=%t want scheduled/true", trigger, run)
	}
}

func TestResolveRunTriggerUsesPerSourceCron(t *testing.T) {
	last := time.Date(2026, 9, 26, 19, 30, 0, 0, time.UTC)
	source := client.Source{
		Status: meta.SourceStatusActive, LastRunAt: &last,
		ScheduleType: "cron", ScheduleExpression: "0 3 * * *", ScheduleTimezone: "Asia/Shanghai",
	}
	before := time.Date(2026, 9, 27, 18, 59, 59, 0, time.UTC)
	trigger, run, err := resolveRunTrigger(source, meta.SyncRunTriggerScheduled, true, 6*time.Hour, before)
	if err != nil {
		t.Fatal(err)
	}
	if run || trigger != meta.SyncRunTriggerScheduled {
		t.Fatalf("early cron trigger=%q run=%t", trigger, run)
	}
	at := time.Date(2026, 9, 27, 19, 0, 0, 0, time.UTC)
	trigger, run, err = resolveRunTrigger(source, meta.SyncRunTriggerScheduled, true, 6*time.Hour, at)
	if err != nil {
		t.Fatal(err)
	}
	if !run || trigger != meta.SyncRunTriggerScheduled {
		t.Fatalf("due cron trigger=%q run=%t", trigger, run)
	}
}

func TestResolveRunTriggerDueSkipsPausedButExplicitRunStillRuns(t *testing.T) {
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	trigger, run, err := resolveRunTrigger(client.Source{
		Status: meta.SourceStatusPaused,
	}, meta.SyncRunTriggerScheduled, true, 6*time.Hour, now)
	if err != nil {
		t.Fatal(err)
	}
	if run || trigger != meta.SyncRunTriggerScheduled {
		t.Fatalf("paused due source trigger=%q run=%t want scheduled/false", trigger, run)
	}

	trigger, run, err = resolveRunTrigger(client.Source{
		Status: meta.SourceStatusPaused,
	}, meta.SyncRunTriggerManual, false, 6*time.Hour, now)
	if err != nil {
		t.Fatal(err)
	}
	if !run || trigger != meta.SyncRunTriggerManual {
		t.Fatalf("explicit source trigger=%q run=%t want manual/true", trigger, run)
	}
}

type fakeSetupSourceAPI struct {
	byID    map[uint64]client.Source
	sources []client.Source
	err     error
}

func (f fakeSetupSourceAPI) Source(_ context.Context, id uint64) (client.Source, error) {
	if f.err != nil {
		return client.Source{}, f.err
	}
	if source, ok := f.byID[id]; ok {
		return source, nil
	}
	return client.Source{}, &client.APIError{Status: 404, Msg: "not found"}
}

func (f fakeSetupSourceAPI) Sources(context.Context) ([]client.Source, error) {
	if f.err != nil {
		return nil, f.err
	}
	return append([]client.Source(nil), f.sources...), nil
}

func TestResolveSetupSourcePrefersExplicitSourceID(t *testing.T) {
	target := uint64(77)
	api := fakeSetupSourceAPI{
		byID: map[uint64]client.Source{
			12: {
				ID: 12, Name: "UI 创建的群晖来源", Kind: sourceagent.SynologyKind,
				Direction: meta.SourceDirectionPush, TargetNodeID: &target,
			},
		},
		sources: []client.Source{{
			ID: 99, Name: "Synology Photos", Kind: sourceagent.SynologyKind,
			Direction: meta.SourceDirectionPush,
		}},
	}
	got, err := resolveSetupSource(context.Background(), api, 99, 12, "")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != 12 {
		t.Fatalf("resolved source=%d want=12", got.ID)
	}
}

func TestResolveSetupSourceExplicitMissingIDDoesNotFallBackByName(t *testing.T) {
	api := fakeSetupSourceAPI{
		byID: map[uint64]client.Source{},
		sources: []client.Source{{
			ID: 99, Name: "Synology Photos", Kind: sourceagent.SynologyKind,
			Direction: meta.SourceDirectionPush,
		}},
	}
	got, err := resolveSetupSource(context.Background(), api, 0, 12, "Synology Photos")
	if err == nil {
		t.Fatalf("explicit missing source unexpectedly resolved: %+v", got)
	}
	var apiErr *client.APIError
	if !errors.As(err, &apiErr) || apiErr.Status != 404 {
		t.Fatalf("explicit missing source error=%v want API 404", err)
	}
}

func TestResolveSetupSourceConfiguredMissingIDFallsBackByName(t *testing.T) {
	api := fakeSetupSourceAPI{
		byID: map[uint64]client.Source{},
		sources: []client.Source{{
			ID: 99, Name: "Synology Photos", Kind: sourceagent.SynologyKind,
			Direction: meta.SourceDirectionPush,
		}},
	}
	got, err := resolveSetupSource(context.Background(), api, 12, 0, "")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != 99 {
		t.Fatalf("fallback source=%d want=99", got.ID)
	}
}

func TestSetupTargetPreservesExistingTargetUnlessOverridden(t *testing.T) {
	target := uint64(42)
	remote := client.Source{ID: 7, TargetNodeID: &target}

	id, path := setupTarget(remote, "")
	if id != 42 || path != "" {
		t.Fatalf("preserved target id=%d path=%q want=42/empty", id, path)
	}

	id, path = setupTarget(remote, "Photos/Manual")
	if id != 0 || path != "Photos/Manual" {
		t.Fatalf("explicit target id=%d path=%q want=0/Photos/Manual", id, path)
	}

	id, path = setupTarget(client.Source{}, "")
	if id != 0 || path != "Photos/Synology" {
		t.Fatalf("new-source default id=%d path=%q want=0/Photos/Synology", id, path)
	}
}

func TestSetupSourceNamePreservesExistingName(t *testing.T) {
	remote := client.Source{ID: 7, Name: "家庭照片"}
	if got := setupSourceName(remote, ""); got != "家庭照片" {
		t.Fatalf("preserved name=%q want=家庭照片", got)
	}
	if got := setupSourceName(remote, "办公室照片"); got != "办公室照片" {
		t.Fatalf("explicit name=%q want=办公室照片", got)
	}
	if got := setupSourceName(client.Source{}, ""); got != "Synology Photos" {
		t.Fatalf("new-source default name=%q", got)
	}
}

func TestSourceScheduleText(t *testing.T) {
	if got := sourceScheduleText(client.Source{ScheduleType: "interval", ScheduleExpression: "6h"}); got != "every 6h" {
		t.Fatalf("interval schedule text=%q", got)
	}
	if got := sourceScheduleText(client.Source{
		ScheduleType: "cron", ScheduleExpression: "0 3 * * *", ScheduleTimezone: "Asia/Shanghai",
	}); got != "cron 0 3 * * * (Asia/Shanghai)" {
		t.Fatalf("cron schedule text=%q", got)
	}
	if got := sourceScheduleText(client.Source{}); got != "legacy fallback" {
		t.Fatalf("legacy schedule text=%q", got)
	}
}
