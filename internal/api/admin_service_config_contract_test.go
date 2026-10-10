package api

import "testing"

func TestServiceDependencyConfigurationModesAreTruthful(t *testing.T) {
	table := []struct {
		id, config, apply string
	}{
		{"baidu-map", "in-app", "immediate"},
		{"geonames", "in-app", "immediate"},
		{"database", "in-app", "immediate"},
		{"storage", "deployment", "controlled-restart"},
		{"caddy", "deployment", "controlled-restart"},
		{"background-worker", "in-app", "task-boundary"},
		{"media-worker", "planned", "not-available"},
		{"photo-face", "deployment", "controlled-restart"},
		{"photo-smart", "deployment", "controlled-restart"},
		{"photo-semantic", "deployment", "controlled-restart"},
		{"photo-creative", "deployment", "controlled-restart"},
	}
	for _, id := range []string{"yike", "synology-photos", "synology-files"} {
		mode, apply, _ := serviceDependencyConfigContract(id)
		if mode == "in-app" || apply == "immediate" {
			t.Fatalf("per-user connector %q has admin runtime controls", id)
		}
	}
	for _, tc := range table {
		gotConfig, gotApply, hint := serviceDependencyConfigContract(tc.id)
		if gotConfig != tc.config || gotApply != tc.apply || hint == "" {
			t.Fatalf("dependency %q: got mode=%q apply=%q hint=%q; want %q/%q",
				tc.id, gotConfig, gotApply, hint, tc.config, tc.apply)
		}
	}
}
