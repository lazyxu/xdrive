package offlinebundle

// Upgrade previews are read-only summaries of authenticated offline releases.
// They must never be used as an installation authorization: the Host rechecks
// publisher trust, snapshots exact bytes, verifies Docker image identity, and
// performs backup/rollback admission independently at installation time.
import (
	"os"
	"path/filepath"
)

type UpgradePlanComponent struct {
	Name                string `json:"name"`
	Filename            string `json:"filename"`
	TargetSHA256        string `json:"target_sha256"`
	TargetFingerprint   string `json:"target_fingerprint,omitempty"`
	TargetBuildCommit   string `json:"target_build_commit,omitempty"`
	Action              string `json:"action"`          // verify_and_install | not_selected | not_supplied
	ArchivePresent      bool   `json:"archive_present"` // transport state only
	RecordedSHA256      string `json:"recorded_sha256,omitempty"`
	RecordedFingerprint string `json:"recorded_fingerprint,omitempty"`
	RecordedMatch       bool   `json:"recorded_match"`
	ArchiveBytes        int64  `json:"archive_bytes"`
	ExpandedBytes       int64  `json:"expanded_bytes"`
}

type UpgradePlan struct {
	Schema                   int                    `json:"schema"`
	ReadOnly                 bool                   `json:"read_only"`
	TrustBasis               string                 `json:"trust_basis"`
	Source                   string                 `json:"source"`
	Channel                  string                 `json:"channel"`
	Platform                 string                 `json:"platform"`
	TargetSourceCommit       string                 `json:"target_source_commit"`
	RecordedSourceCommit     string                 `json:"recorded_source_commit,omitempty"`
	CurrentVersionEvidence   string                 `json:"current_version_evidence"`
	Components               []UpgradePlanComponent `json:"components"`
	SelectedArchiveBytes     int64                  `json:"selected_archive_bytes"`
	SelectedExpandedBytes    int64                  `json:"selected_expanded_bytes"`
	MinimumTemporaryBytes    int64                  `json:"minimum_temporary_bytes"`
	EstimatedFullDiskBytes   *int64                 `json:"estimated_full_disk_bytes"` // null: Docker and backup cannot be predicted
	HostProbe                *HostRuntimeProbe      `json:"host_probe,omitempty"`      // opt-in live read-only observations
	RequiresHostVerification []string               `json:"requires_host_verification"`
}

// BuildUpgradePlan assumes the calling Host has already authenticated the
// Manifest using an independent digest or signed release. This function does
// not read publisher trust roots, inspect Docker, or change any on-disk state.
// Only selected archives are verified; unselected components are not certified.
func BuildUpgradePlan(dir string, m *Manifest, selection []string, home string, enableMedia, enableAI bool) (*UpgradePlan, error) {
	if m == nil || home == "" {
		return nil, fail("upgrade preview requires a Manifest and local home")
	}
	selected := selectedSet(selection)
	if len(selected) != len(selection) {
		return nil, fail("duplicate component in upgrade preview")
	}
	for name := range selected {
		if !componentSet()[name] {
			return nil, fail("unknown component in upgrade preview: %s", name)
		}
	}
	if !selected["app"] {
		return nil, fail("offline upgrade requires App package")
	}
	if selected["ai-runtime"] != selected["ai-models"] {
		return nil, fail("AI Runtime and AI Models must be upgraded together")
	}
	if enableMedia && !selected["media-worker"] {
		return nil, fail("enabled Media Worker requires its package")
	}
	if enableAI && !selected["ai-runtime"] {
		return nil, fail("enabled photo intelligence requires runtime and model packages")
	}
	if err := checkExistingPostgresSetting(home, m); err != nil {
		return nil, err
	}
	env, err := readEnvironment(home)
	if err != nil {
		return nil, err
	}
	profiles, err := activeProfiles(env, enableMedia, enableAI)
	if err != nil {
		return nil, err
	}
	old, err := validateContracts(home, m, selected, profiles)
	if err != nil {
		return nil, err
	}
	result := &UpgradePlan{
		Schema: 1, ReadOnly: true, Source: m.Source, Channel: m.Channel, Platform: m.Platform,
		TargetSourceCommit: m.SourceCommit, RecordedSourceCommit: old.SourceCommit,
		CurrentVersionEvidence: "unknown",
		Components:             make([]UpgradePlanComponent, 0, len(Components)),
		RequiresHostVerification: []string{
			"publisher_trust_and_private_snapshot",
			"actual_running_build_and_docker_image_identity",
			"docker_storage_and_backup_disk_capacity",
			"host_backup_maintenance_health_and_rollback",
		},
	}
	if old.Schema == 1 {
		result.CurrentVersionEvidence = "previous_offline_install_receipt_not_live_build"
	}
	if !selected["postgres"] {
		result.RequiresHostVerification = append(result.RequiresHostVerification, "pinned_cached_postgres_image")
	}
	present := CandidatePresence(dir, m)
	for _, name := range Components {
		p := m.Packages[name]
		component := UpgradePlanComponent{
			Name: name, Filename: p.Filename, TargetSHA256: p.SHA256,
			TargetFingerprint: p.Fingerprint, TargetBuildCommit: p.BuiltFromCommit,
			Action: "not_selected", ArchivePresent: present[name],
		}
		if !present[name] {
			component.Action = "not_supplied"
		}
		if prev, ok := old.Installed[name]; ok {
			component.RecordedSHA256 = prev.SHA256
			component.RecordedFingerprint = prev.Fingerprint
			component.RecordedMatch = prev.SHA256 == p.SHA256 && prev.Fingerprint == p.Fingerprint
		}
		if selected[name] {
			// Verify every compressed byte and declared tar member without
			// decompression to disk, running Docker, or invoking the installer.
			if err := VerifyArchive(filepath.Join(dir, p.Filename), p, ""); err != nil {
				return nil, err
			}
			component.Action = "verify_and_install"
			component.ArchiveBytes = p.Size
			for _, member := range p.Members {
				component.ExpandedBytes += member.Size
			}
			result.SelectedArchiveBytes += component.ArchiveBytes
			result.SelectedExpandedBytes += component.ExpandedBytes
		}
		result.Components = append(result.Components, component)
	}
	// This is only a lower bound for the private archive snapshot and
	// extraction; it excludes Docker layers, images, database and file backup.
	result.MinimumTemporaryBytes = result.SelectedArchiveBytes + result.SelectedExpandedBytes
	return result, nil
}

// CandidatePresence reports only whether a selected package is a regular
// file; it never treats this transport state as publisher authentication.
func CandidatePresence(dir string, m *Manifest) map[string]bool {
	present := make(map[string]bool, len(Components))
	for _, name := range Components {
		p := m.Packages[name]
		info, err := os.Lstat(filepath.Join(dir, p.Filename))
		present[name] = err == nil && info.Mode().IsRegular()
	}
	return present
}
