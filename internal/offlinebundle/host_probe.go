package offlinebundle

// Read-only observations of the actual Docker Host for an already authenticated
// upgrade plan. These findings are evidence for the UI, not an authorization to
// activate a release: the installer repeats all final checks on private bytes.
import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type HostImageObservation struct {
	Name       string `json:"name"`
	Reference  string `json:"reference"`
	ExpectedID string `json:"expected_id,omitempty"`
	ObservedID string `json:"observed_id,omitempty"`
	Status     string `json:"status"`
}

type HostRuntimeProbe struct {
	Schema                    int                    `json:"schema"`
	ReadOnly                  bool                   `json:"read_only"`
	Platform                  string                 `json:"platform"`
	DockerStatus              string                 `json:"docker_status"`
	RunningServerImageRef     string                 `json:"running_server_image_ref,omitempty"`
	RunningServerImageID      string                 `json:"running_server_image_id,omitempty"`
	RunningServerEvidence     string                 `json:"running_server_evidence"`
	TemporaryFreeBytes        *uint64                `json:"temporary_free_bytes"`
	TemporaryRequiredMinBytes int64                  `json:"temporary_required_min_bytes"`
	TemporarySpaceStatus      string                 `json:"temporary_space_status"`
	DockerStorageFreeBytes    *uint64                `json:"docker_storage_free_bytes"`
	Images                    []HostImageObservation `json:"images"`
	Blockers                  []string               `json:"blockers"`
	RemainingHostChecks       []string               `json:"remaining_host_checks"`
}

func dockerReadOnly(ctx context.Context, args ...string) (string, error) {
	limited, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	command := exec.CommandContext(limited, "docker", args...)
	command.Stdin = nil
	output, err := command.Output()
	if err != nil {
		return "", err
	}
	result := strings.TrimSpace(string(output))
	if len(result) > 4096 {
		return "", fail("Docker read-only output exceeds limit")
	}
	return result, nil
}

// ProbeHostRuntime inspects only Docker status/images and filesystem space.
// It deliberately does not call docker load/pull/build/start or any backup
// command, nor use a previous receipt as proof of the live container build.
func ProbeHostRuntime(ctx context.Context, m *Manifest, selection []string, home string, minTempBytes int64, tempDir string) (*HostRuntimeProbe, error) {
	if m == nil || home == "" || minTempBytes <= 0 {
		return nil, fail("Host probe requires a Manifest, home and positive temporary-space bound")
	}
	if runtime.GOOS != "linux" {
		return nil, fail("Host runtime probe requires Linux")
	}
	selected := selectedSet(selection)
	if len(selection) != len(selected) || !selected["app"] ||
		selected["ai-runtime"] != selected["ai-models"] {
		return nil, fail("invalid Host probe component selection")
	}
	for name := range selected {
		if !componentSet()[name] {
			return nil, fail("unknown Host probe component")
		}
	}
	if tempDir == "" {
		tempDir = os.TempDir()
	}
	result := &HostRuntimeProbe{
		Schema: 1, ReadOnly: true, Platform: "linux/amd64",
		DockerStatus: "unavailable", RunningServerEvidence: "unknown",
		TemporaryRequiredMinBytes: minTempBytes, TemporarySpaceStatus: "unknown",
		Images:   make([]HostImageObservation, 0, 3),
		Blockers: make([]string, 0),
		RemainingHostChecks: []string{
			"real_running_server_buildinfo",
			"publisher_trust_and_candidate_bytes_at_install_time",
			"full_docker_image_layer_and_backup_capacity",
			"backup_maintenance_health_and_rollback",
		},
	}
	if free, err := hostFilesystemFreeBytes(tempDir); err == nil {
		result.TemporaryFreeBytes = &free
		result.TemporarySpaceStatus = "sufficient_for_known_lower_bound"
		if uint64(minTempBytes) > free {
			result.TemporarySpaceStatus = "insufficient_for_known_lower_bound"
			result.Blockers = append(result.Blockers, "insufficient_private_temporary_space")
		}
	} else {
		result.Blockers = append(result.Blockers, "temporary_space_unavailable")
	}
	dockerRoot, err := dockerReadOnly(ctx, "info", "--format", "{{.DockerRootDir}}")
	if err != nil || !filepath.IsAbs(dockerRoot) {
		result.Blockers = append(result.Blockers, "docker_unavailable")
		return result, nil
	}
	result.DockerStatus = "available"
	if free, err := hostFilesystemFreeBytes(dockerRoot); err == nil {
		result.DockerStorageFreeBytes = &free
	}
	if current, err := dockerReadOnly(ctx, "container", "inspect", "--format", "{{.Config.Image}}|{{.Image}}", "xdrive-server"); err == nil {
		parts := strings.Split(current, "|")
		if len(parts) == 2 && len(parts[0]) > 0 && len(parts[0]) <= 1024 && imagePattern.MatchString(parts[1]) {
			result.RunningServerImageRef = parts[0]
			result.RunningServerImageID = parts[1]
			result.RunningServerEvidence = "live_container_image_identity_not_buildinfo"
		}
	}
	if !selected["postgres"] {
		img := m.Images["postgres"]
		check := HostImageObservation{Name: "postgres", Reference: img.Ref, ExpectedID: img.ID, Status: "unavailable"}
		actual, err := dockerReadOnly(ctx, "image", "inspect", "--format", "{{.Id}}", img.Ref)
		if err == nil && imagePattern.MatchString(actual) {
			check.ObservedID = actual
			check.Status = "identity_mismatch"
			if actual == img.ID {
				check.Status = "verified_cached_identity"
			}
		}
		if check.Status != "verified_cached_identity" {
			result.Blockers = append(result.Blockers, "pinned_postgres_image_unavailable_or_mismatched")
		}
		result.Images = append(result.Images, check)
	}
	// The prior offline installed receipt can establish a component contract,
	// but not that a reusable optional image still exists in Docker.
	env, err := readEnvironment(home)
	if err != nil {
		result.Blockers = append(result.Blockers, "host_environment_unavailable")
		return result, nil
	}
	profiles, err := activeProfiles(env, false, false)
	if err != nil {
		result.Blockers = append(result.Blockers, "host_profiles_invalid")
		return result, nil
	}
	for _, optional := range []struct{ profile, component, envKey string }{
		{"media-worker", "media-worker", "XD_MEDIA_WORKER_IMAGE"},
		{"photo-intelligence", "ai-runtime", "XD_PHOTO_FACE_IMAGE"},
	} {
		if !profiles[optional.profile] || selected[optional.component] {
			continue
		}
		ref := env[optional.envKey]
		check := HostImageObservation{Name: optional.profile, Reference: ref, Status: "missing_configured_reference"}
		if ref != "" {
			actual, err := dockerReadOnly(ctx, "image", "inspect", "--format", "{{.Id}}", ref)
			if err == nil && imagePattern.MatchString(actual) {
				check.Status = "present_identity_not_established"
				check.ObservedID = actual
				result.RemainingHostChecks = append(result.RemainingHostChecks,
					"optional_image_compatibility_"+optional.profile)
			} else {
				check.Status = "unavailable"
			}
		}
		if check.Status != "present_identity_not_established" {
			result.Blockers = append(result.Blockers, "enabled_optional_image_unavailable_"+optional.profile)
		}
		result.Images = append(result.Images, check)
	}
	return result, nil
}
