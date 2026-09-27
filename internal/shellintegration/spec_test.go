package shellintegration

import (
	"strings"
	"testing"
)

func TestExplorerVerbSpecsAreScopedToSyncRoot(t *testing.T) {
	root := `C:\Users\Alice\xDrive`
	exe := `C:\Users\Alice\AppData\Local\Programs\xDrive\xdrive-agent.exe`
	icon := `C:\Users\Alice\AppData\Local\Programs\xDrive\desktop\xdrive-desktop.exe`
	specs := ExplorerVerbSpecs(root, exe, icon)
	if len(specs) != 2 {
		t.Fatalf("got %d Explorer verbs, want 2", len(specs))
	}
	for _, spec := range specs {
		if !strings.Contains(spec.AppliesTo, `System.ItemPathDisplay:="C:\Users\Alice\xDrive"`) {
			t.Fatalf("%s AppliesTo=%q does not include exact sync-root match", spec.Key, spec.AppliesTo)
		}
		if !strings.Contains(spec.AppliesTo, `System.ItemPathDisplay:~<"C:\Users\Alice\xDrive\"`) {
			t.Fatalf("%s AppliesTo=%q does not include descendant-path match", spec.Key, spec.AppliesTo)
		}
		if !strings.Contains(spec.Command, `"%1"`) {
			t.Fatalf("%s command does not quote Explorer path: %q", spec.Key, spec.Command)
		}
		if !strings.Contains(spec.Command, exe) {
			t.Fatalf("%s command does not target agent executable: %q", spec.Key, spec.Command)
		}
		if spec.Icon != icon {
			t.Fatalf("%s icon=%q, want %q", spec.Key, spec.Icon, icon)
		}
	}
	if specs[0].Label != "始终保留在此设备" || !strings.Contains(specs[0].Command, "--shell-action keep") {
		t.Fatalf("unexpected keep-local verb: %+v", specs[0])
	}
	if specs[1].Label != "释放空间" || !strings.Contains(specs[1].Command, "--shell-action release") {
		t.Fatalf("unexpected release-space verb: %+v", specs[1])
	}
}

func TestExplorerVerbSpecsAllowNoIconFallback(t *testing.T) {
	specs := ExplorerVerbSpecs(`C:\xDrive`, `C:\xdrive-agent.exe`, "")
	for _, spec := range specs {
		if spec.Icon != "" {
			t.Fatalf("%s icon=%q, want empty fallback", spec.Key, spec.Icon)
		}
	}
}
