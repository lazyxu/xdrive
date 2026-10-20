//go:build linux || windows

package localpushstage

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/google/uuid"
)

func TestFreshStageScopeRejectsPriorHintAndEmptyRecoveryDirectory(t *testing.T) {
	config, grant, stage := localRecoveryHintFixture(t)
	ctx := context.Background()
	if err := RequireFreshLocalOriginalStageScope(ctx, config, grant); err != nil {
		t.Fatalf("unused native Stage scope refused: %v", err)
	}
	if err := SaveLocalOriginalRecoveryHint(ctx, config, grant, stage, "photo.bin"); err != nil {
		t.Fatal(err)
	}
	if err := RequireFreshLocalOriginalStageScope(ctx, config, grant); err == nil {
		t.Fatal("restarted Agent accepted prior Stage")
	}
	got, err := ReadLocalOriginalRecoveryHint(ctx, config, grant, stage.StageID)
	if err != nil || got.Stage != stage {
		t.Fatalf("read-only guard modified the original recovery hint: %v", err)
	}
	foreign := grant
	foreign.RootID = uuid.NewString()
	if err := RequireFreshLocalOriginalStageScope(ctx, config, foreign); err == nil {
		t.Fatal("foreign native Root accepted")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if err := RequireFreshLocalOriginalStageScope(cancelled, config, grant); err == nil {
		t.Fatal("cancelled Agent admitted Stage")
	}
}

func TestFreshStageScopeRejectsIncompleteOrUnsafeDirectories(t *testing.T) {
	t.Run("empty-directory", func(t *testing.T) {
		config, grant, _ := localRecoveryHintFixture(t)
		dir, err := localStageRecoveryDir(config, grant)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := RequireFreshLocalOriginalStageScope(context.Background(), config, grant); err == nil {
			t.Fatal("empty prior recovery directory was treated as new")
		}
	})
	t.Run("symlink-parent", func(t *testing.T) {
		if runtime.GOOS == "windows" {
			t.Skip("symlinks may require elevated Windows privileges")
		}
		config, grant, _ := localRecoveryHintFixture(t)
		dir, err := localStageRecoveryDir(config, grant)
		if err != nil {
			t.Fatal(err)
		}
		parent := filepath.Dir(dir)
		if err := os.MkdirAll(filepath.Dir(parent), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(t.TempDir(), parent); err != nil {
			t.Fatal(err)
		}
		if err := RequireFreshLocalOriginalStageScope(context.Background(), config, grant); err == nil {
			t.Fatal("symlinked Stage recovery parent accepted")
		}
	})
	t.Run("insecure-parent", func(t *testing.T) {
		if runtime.GOOS == "windows" {
			t.Skip("POSIX permissions only")
		}
		config, grant, _ := localRecoveryHintFixture(t)
		dir, err := localStageRecoveryDir(config, grant)
		if err != nil {
			t.Fatal(err)
		}
		parent := filepath.Dir(dir)
		if err := os.MkdirAll(parent, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(parent, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := RequireFreshLocalOriginalStageScope(context.Background(), config, grant); err == nil {
			t.Fatal("insecure Stage recovery parent accepted")
		}
	})
}
