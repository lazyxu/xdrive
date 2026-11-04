//go:build linux

package offlinebundle

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func offlineProbeMockDocker(t *testing.T, m *Manifest, root string, actualPostgres string) {
	t.Helper()
	bin := t.TempDir()
	// Fail for every Docker mutation; only the three read-only CLI forms are
	// deliberately mocked. This also proves no container/image modifications.
	script := `#!/bin/sh
case "$1:$2" in
  info:--format)
    printf '%s\n' "$XD_TEST_DOCKER_ROOT"
    exit 0 ;;
  container:inspect)
    printf '%s|%s\n' "$XD_TEST_SERVER_REF" "$XD_TEST_SERVER_ID"
    exit 0 ;;
  image:inspect)
    if [ "$5" = "$XD_TEST_POSTGRES_REF" ]; then
      printf '%s\n' "$XD_TEST_POSTGRES_ID"
      exit 0
    fi
    if [ "$5" = "$XD_TEST_MEDIA_REF" ]; then
      printf '%s\n' "$XD_TEST_MEDIA_ID"
      exit 0
    fi
    exit 3 ;;
esac
exit 99
`
	if err := os.WriteFile(filepath.Join(bin, "docker"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
	t.Setenv("XD_TEST_DOCKER_ROOT", root)
	t.Setenv("XD_TEST_SERVER_REF", m.Images["server"].Ref)
	t.Setenv("XD_TEST_SERVER_ID", m.Images["server"].ID)
	t.Setenv("XD_TEST_POSTGRES_REF", m.Images["postgres"].Ref)
	t.Setenv("XD_TEST_POSTGRES_ID", actualPostgres)
	t.Setenv("XD_TEST_MEDIA_REF", m.Images["media-worker"].Ref)
	t.Setenv("XD_TEST_MEDIA_ID", m.Images["media-worker"].ID)
}

func containsHostProbeStatus(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestReadOnlyHostProbeChecksRealCachedPostgresAndDisk(t *testing.T) {
	t.Setenv("COMPOSE_PROFILES", "")
	dir := t.TempDir()
	home := t.TempDir()
	m, _ := populateIntegrationPackages(t, dir, false)
	offlineProbeMockDocker(t, m, home, m.Images["postgres"].ID)
	report, err := ProbeHostRuntime(context.Background(), m, []string{"app"}, home, 1, dir)
	if err != nil {
		t.Fatal(err)
	}
	if !report.ReadOnly || report.DockerStatus != "available" ||
		report.RunningServerImageRef != m.Images["server"].Ref ||
		report.RunningServerImageID != m.Images["server"].ID ||
		report.RunningServerEvidence != "live_container_image_identity_not_buildinfo" ||
		report.TemporarySpaceStatus != "sufficient_for_known_lower_bound" ||
		report.TemporaryFreeBytes == nil || report.DockerStorageFreeBytes == nil ||
		len(report.Images) != 1 || report.Images[0].Status != "verified_cached_identity" ||
		len(report.Blockers) != 0 {
		t.Fatalf("incorrect read-only Docker and disk report: %+v", report)
	}
	if _, err := os.Stat(filepath.Join(home, "state", "offline-installed.json")); !os.IsNotExist(err) {
		t.Fatal("Host probe wrote an installed-state receipt")
	}
}

func TestReadOnlyHostProbeBlocksMismatchedCachedPostgres(t *testing.T) {
	t.Setenv("COMPOSE_PROFILES", "")
	dir := t.TempDir()
	home := t.TempDir()
	m, _ := populateIntegrationPackages(t, dir, false)
	offlineProbeMockDocker(t, m, home, "sha256:"+strings.Repeat("e", 64))
	report, err := ProbeHostRuntime(context.Background(), m, []string{"app"}, home, 1, dir)
	if err != nil {
		t.Fatal(err)
	}
	if report.Images[0].Status != "identity_mismatch" ||
		!containsHostProbeStatus(report.Blockers, "pinned_postgres_image_unavailable_or_mismatched") {
		t.Fatalf("wrong cached PostgreSQL image was not rejected: %+v", report)
	}
}

func TestReadOnlyHostProbeDistinguishesInsufficientTemporarySpace(t *testing.T) {
	t.Setenv("COMPOSE_PROFILES", "")
	dir := t.TempDir()
	home := t.TempDir()
	m, _ := populateIntegrationPackages(t, dir, false)
	offlineProbeMockDocker(t, m, home, m.Images["postgres"].ID)
	report, err := ProbeHostRuntime(context.Background(), m, []string{"app"}, home, 1<<62, dir)
	if err != nil {
		t.Fatal(err)
	}
	if report.TemporarySpaceStatus != "insufficient_for_known_lower_bound" ||
		!containsHostProbeStatus(report.Blockers, "insufficient_private_temporary_space") {
		t.Fatalf("insufficient snapshot space was not flagged: %+v", report)
	}
}

func TestReadOnlyHostProbeKeepsUnknownDockerAsBlocker(t *testing.T) {
	t.Setenv("COMPOSE_PROFILES", "")
	t.Setenv("PATH", t.TempDir()) // no docker executable
	dir := t.TempDir()
	home := t.TempDir()
	m, _ := populateIntegrationPackages(t, dir, false)
	report, err := ProbeHostRuntime(context.Background(), m, []string{"app"}, home, 1, dir)
	if err != nil {
		t.Fatal(err)
	}
	if report.DockerStatus != "unavailable" ||
		!containsHostProbeStatus(report.Blockers, "docker_unavailable") {
		t.Fatalf("unavailable Docker must not be reported ready: %+v", report)
	}
}

func TestReadOnlyHostProbeShowsUnverifiedOptionalImage(t *testing.T) {
	t.Setenv("COMPOSE_PROFILES", "")
	dir := t.TempDir()
	home := t.TempDir()
	m, _ := populateIntegrationPackages(t, dir, false)
	offlineProbeMockDocker(t, m, home, m.Images["postgres"].ID)
	if err := os.MkdirAll(filepath.Join(home, "config"), 0700); err != nil {
		t.Fatal(err)
	}
	env := fmt.Sprintf("COMPOSE_PROFILES=media-worker\nXD_MEDIA_WORKER_IMAGE=%s\n", m.Images["media-worker"].Ref)
	if err := os.WriteFile(filepath.Join(home, "config", ".env"), []byte(env), 0600); err != nil {
		t.Fatal(err)
	}
	report, err := ProbeHostRuntime(context.Background(), m, []string{"app"}, home, 1, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Images) != 2 || report.Images[1].Status != "present_identity_not_established" ||
		!containsHostProbeStatus(report.RemainingHostChecks, "optional_image_compatibility_media-worker") {
		t.Fatalf("optional image existence incorrectly passed as compatibility: %+v", report)
	}
}

func TestReadOnlyHostProbeRejectsIncompleteOrInvalidSelection(t *testing.T) {
	dir := t.TempDir()
	m, _ := populateIntegrationPackages(t, dir, false)
	for _, selected := range [][]string{{"postgres"}, {"app", "ai-runtime"}, {"app", "app"}, {"app", "unknown"}} {
		if _, err := ProbeHostRuntime(context.Background(), m, selected, dir, 1, dir); err == nil {
			t.Fatalf("invalid Host probe selection accepted: %v", selected)
		}
	}
	if _, err := ProbeHostRuntime(context.Background(), m, []string{"app"}, dir, 0, dir); err == nil {
		t.Fatal("empty temporary space bound accepted")
	}
}
