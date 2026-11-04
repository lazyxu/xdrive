package offlinebundle

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestUpgradePlanReadsAuthenticatedReleaseWithoutDockerOrHostWrites(t *testing.T) {
	t.Setenv("COMPOSE_PROFILES", "")
	// Even with Docker unavailable, this is a static preflight and must not
	// invoke it or create any installation markers.
	t.Setenv("PATH", t.TempDir())
	dir := t.TempDir()
	home := t.TempDir()
	m, _ := populateIntegrationPackages(t, dir, false)
	plan, err := BuildUpgradePlan(dir, m, Components, home, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if !plan.ReadOnly || plan.Schema != 1 || plan.TargetSourceCommit != m.SourceCommit ||
		plan.CurrentVersionEvidence != "unknown" || len(plan.Components) != 5 ||
		plan.SelectedArchiveBytes <= 0 || plan.SelectedExpandedBytes <= 0 ||
		plan.MinimumTemporaryBytes != plan.SelectedArchiveBytes+plan.SelectedExpandedBytes ||
		plan.EstimatedFullDiskBytes != nil {
		t.Fatalf("unsafe or incomplete preview: %+v", plan)
	}
	for _, item := range plan.Components {
		if item.Action != "verify_and_install" || item.TargetSHA256 != m.Packages[item.Name].SHA256 ||
			item.ArchiveBytes != m.Packages[item.Name].Size {
			t.Fatalf("incorrect target component preview: %+v", item)
		}
	}
	raw, err := json.Marshal(plan)
	if err != nil || !strings.Contains(string(raw), `"read_only":true`) ||
		!strings.Contains(string(raw), `"estimated_full_disk_bytes":null`) {
		t.Fatalf("plan must be a typed, honest JSON preview: %v %s", err, raw)
	}
	if _, err := os.Stat(filepath.Join(home, "state", "offline-installed.json")); !os.IsNotExist(err) {
		t.Fatal("read-only plan wrote an installation receipt")
	}
}

func TestUpgradePlanTreatsPreviousReceiptAsRecordedNotLiveBuild(t *testing.T) {
	t.Setenv("COMPOSE_PROFILES", "")
	dir := t.TempDir()
	home := t.TempDir()
	m, _ := populateIntegrationPackages(t, dir, false)
	if err := os.MkdirAll(filepath.Join(home, "state"), 0700); err != nil {
		t.Fatal(err)
	}
	state := InstalledState{
		Schema: 1, SourceCommit: strings.Repeat("1", 40),
		Contracts: m.Contracts, Installed: map[string]InstalledComponent{
			"app": {
				SHA256:      m.Packages["app"].SHA256,
				Fingerprint: m.Packages["app"].Fingerprint,
				BuildCommit: m.Packages["app"].BuiltFromCommit,
			},
		},
	}
	data, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	statePath := filepath.Join(home, "state", "offline-installed.json")
	if err := os.WriteFile(statePath, data, 0600); err != nil {
		t.Fatal(err)
	}
	plan, err := BuildUpgradePlan(dir, m, []string{"app"}, home, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if plan.RecordedSourceCommit != state.SourceCommit ||
		plan.CurrentVersionEvidence != "previous_offline_install_receipt_not_live_build" ||
		len(plan.RequiresHostVerification) != 5 || !plan.Components[0].RecordedMatch ||
		plan.Components[1].Action != "not_selected" || plan.Components[1].ArchiveBytes != 0 {
		t.Fatalf("partial plan incorrectly claimed runtime parity or selected dependencies: %+v", plan)
	}
	if got, err := os.ReadFile(statePath); err != nil || string(got) != string(data) {
		t.Fatal("read-only plan mutated installed state")
	}
}

func TestUpgradePlanRejectsMissingAppHalfAIAndTamperedArchive(t *testing.T) {
	t.Setenv("COMPOSE_PROFILES", "")
	dir := t.TempDir()
	home := t.TempDir()
	m, _ := populateIntegrationPackages(t, dir, false)
	for _, selection := range [][]string{
		{"postgres"}, {"app", "ai-runtime"}, {"app", "app"},
		{"app", "unexpected"},
	} {
		if _, err := BuildUpgradePlan(dir, m, selection, home, false, false); err == nil {
			t.Fatalf("unsafe partial selection accepted: %v", selection)
		}
	}
	if _, err := BuildUpgradePlan(dir, m, []string{"app"}, home, true, false); err == nil {
		t.Fatal("enable-media without package accepted")
	}
	app := filepath.Join(dir, m.Packages["app"].Filename)
	if err := os.WriteFile(app, []byte("corrupt package"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := BuildUpgradePlan(dir, m, []string{"app"}, home, false, false); err == nil {
		t.Fatal("tampered App archive passed static preflight")
	}
}

func TestUpgradePlanRejectsUnknownEnabledProfileCompatibility(t *testing.T) {
	t.Setenv("COMPOSE_PROFILES", "")
	dir := t.TempDir()
	home := t.TempDir()
	m, _ := populateIntegrationPackages(t, dir, false)
	if err := os.Mkdir(filepath.Join(home, "config"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "config", ".env"), []byte("COMPOSE_PROFILES=media-worker\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := BuildUpgradePlan(dir, m, []string{"app"}, home, false, false); err == nil {
		t.Fatal("missing compatible active Media Worker package not flagged")
	}
}

func TestUpgradePlanDistinguishesMissingCandidateFromUnselectedPackage(t *testing.T) {
	t.Setenv("COMPOSE_PROFILES", "")
	dir := t.TempDir()
	home := t.TempDir()
	m, _ := populateIntegrationPackages(t, dir, false)
	if err := os.Remove(filepath.Join(dir, m.Packages["postgres"].Filename)); err != nil {
		t.Fatal(err)
	}
	plan, err := BuildUpgradePlan(dir, m, []string{"app"}, home, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Components[1].Action != "not_supplied" ||
		plan.Components[1].ArchivePresent ||
		plan.Components[2].Action != "not_selected" ||
		!plan.Components[2].ArchivePresent {
		t.Fatalf("missing package must not be mistaken for an unselected available archive: %+v", plan.Components)
	}
}
