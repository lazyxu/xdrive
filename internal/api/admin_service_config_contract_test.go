package api

import (
	"strings"
	"testing"
)

func TestServiceDependencyConfigurationModesAreTruthful(t *testing.T) {
	table := []struct {
		id, config, apply string
	}{
		{"baidu-map", "in-app", "immediate"},
		{"geonames", "in-app", "immediate"},
		{"database", "in-app", "immediate"},
		{"storage", "deployment", "controlled-restart"},
		{"caddy", "in-app", "controlled-restart"},
		{"background-worker", "in-app", "task-boundary"},
		{"media-worker", "in-app", "controlled-restart"},
		{"photo-face", "in-app", "controlled-restart"},
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
		if tc.id == "photo-face" && (!strings.Contains(hint, "仅启用") ||
			!strings.Contains(hint, "审计") || !strings.Contains(hint, "停用") ||
			!strings.Contains(hint, "不等于")) {
			t.Fatalf("Photo Host hint misstates the actual enable-only capability or effect boundary: %s", hint)
		}
		if (tc.id == "photo-smart" || tc.id == "photo-semantic" || tc.id == "photo-creative") &&
			(!strings.Contains(hint, "没有独立启停接口") || !strings.Contains(hint, "共享") ||
				!strings.Contains(hint, "Info")) {
			t.Fatalf("model hint invents per-model control or hides shared host / Info verification: %s", hint)
		}
		if tc.id == "media-worker" && (!strings.Contains(hint, "内存") ||
			!strings.Contains(hint, "CPU") || !strings.Contains(hint, "PID") ||
			!strings.Contains(hint, "Docker")) {
			t.Fatalf("Media Worker hint omits bounded in-app resources or real host verification: %s", hint)
		}
	}
}
