//go:build linux || windows

package localpushstage

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/localpush"
)

func localRecoveryHintFixture(t *testing.T) (string, localpush.RootGrant, LocalOriginalServerStage) {
	t.Helper()
	config, grant, sha, content, _ := nativeByteStageFixture(t, "http://localhost:9000")
	journal, err := localpush.VerifyInventoryJournal(context.Background(), config, grant)
	if err != nil {
		t.Fatal(err)
	}
	key, err := localpush.LocalInventoryPathKey(grant, "file", "photo.bin")
	if err != nil {
		t.Fatal(err)
	}
	return config, grant, LocalOriginalServerStage{
		SourceID: grant.SourceID, Revision: 7, StageID: uuid.NewString(),
		SnapshotSHA256: journal.SnapshotSHA256,
		CurrentPathKey: key, SHA256: sha, Size: int64(len(content)),
	}
}

func TestLocalOriginalRecoveryHintPersistsExactBoundedPrivateStageAfterRestart(t *testing.T) {
	config, grant, stage := localRecoveryHintFixture(t)
	ctx := context.Background()
	if err := SaveLocalOriginalRecoveryHint(ctx, config, grant, stage, "photo.bin"); err != nil {
		t.Fatal("private verified Stage not durably indexed:", err)
	}
	got, err := ReadLocalOriginalRecoveryHint(ctx, config, grant, stage.StageID)
	if err != nil || got.Stage != stage || got.RelativePath != "photo.bin" ||
		got.CreatedAt.IsZero() {
		t.Fatalf("recover original Source/Stage identity: %+v %v", got, err)
	}
	// An exact replay cannot overwrite or refresh the original hint.
	if err := SaveLocalOriginalRecoveryHint(ctx, config, grant, stage, "photo.bin"); err != nil {
		t.Fatal("exact local hint replay rejected:", err)
	}
	again, err := ReadLocalOriginalRecoveryHint(ctx, config, grant, stage.StageID)
	if err != nil || !again.CreatedAt.Equal(got.CreatedAt) {
		t.Fatalf("Stage replay rewrote private journal: %+v %v", again, err)
	}
	// A future second file can consume the Server's one-Stage-per-Source slot.
	// BOTH Stage UUIDs remain recoverable, without reading a live Stage.
	replacement := stage
	replacement.StageID = uuid.NewString()
	if err := SaveLocalOriginalRecoveryHint(ctx, config, grant, replacement, "photo.bin"); err != nil {
		t.Fatal(err)
	}
	list, err := ListLocalOriginalRecoveryHints(ctx, config, grant)
	if err != nil || len(list) != 2 ||
		list[0].Stage.StageID == list[1].Stage.StageID {
		t.Fatalf("private restart index lost an older Stage: %+v %v", list, err)
	}
	dir, err := localStageRecoveryDir(config, grant)
	if err != nil {
		t.Fatal(err)
	}
	name, err := localStageRecoveryFile(dir, stage.StageID)
	if err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{
		grant.Path, grant.Server, grant.Account, "agent-private-only-secret",
	} {
		if strings.Contains(string(contents), secret) {
			t.Fatal("private recovery journal stored Root, Server, account or credential")
		}
	}
	stat, err := os.Lstat(name)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && stat.Mode().Perm() != 0o600 {
		t.Fatalf("local Stage hint is not private: %v", stat.Mode())
	}
	wire, err := json.Marshal(got)
	if err != nil || string(wire) != "{}" {
		t.Fatalf("Agent recovery Stage hints leaked to IPC JSON: %s %v", wire, err)
	}
	// This local record cannot turn Stage into SourceRun or prove CAS bytes.
	if got.Stage.StageID == "" || got.Stage.SourceID != grant.SourceID {
		t.Fatal("hint dropped its only safe correlation identifiers")
	}
}

func TestLocalOriginalRecoveryHintsFailClosedOnWrongRootStageAndCorruptFile(t *testing.T) {
	for _, tc := range []string{
		"wrong-source", "wrong-stage-id", "wrong-path", "wrong-path-key",
		"changed-original-hash", "wrong-root", "canceled", "other-account",
		"malformed-json", "oversized-json", "symlink-file",
	} {
		t.Run(tc, func(t *testing.T) {
			config, grant, stage := localRecoveryHintFixture(t)
			ctx := context.Background()
			scope := grant
			path := "photo.bin"
			switch tc {
			case "wrong-source":
				stage.SourceID++
			case "wrong-stage-id":
				stage.StageID = "../outside.json"
			case "wrong-path":
				path = "../escaped.bin"
			case "wrong-path-key":
				stage.CurrentPathKey = strings.Repeat("a", 64)
			case "changed-original-hash":
				stage.SHA256 = strings.Repeat("g", 64)
			case "wrong-root":
				scope.RootID = uuid.NewString()
			case "canceled":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(context.Background())
				cancel()
			case "other-account":
				scope.Account = "foreign-account"
			}
			if tc == "malformed-json" || tc == "oversized-json" || tc == "symlink-file" {
				if err := SaveLocalOriginalRecoveryHint(ctx, config, grant, stage, path); err != nil {
					t.Fatal(err)
				}
				dir, err := localStageRecoveryDir(config, grant)
				if err != nil {
					t.Fatal(err)
				}
				file, err := localStageRecoveryFile(dir, stage.StageID)
				if err != nil {
					t.Fatal(err)
				}
				switch tc {
				case "malformed-json":
					if err := os.WriteFile(file, []byte("{bad json"), 0o600); err != nil {
						t.Fatal(err)
					}
				case "oversized-json":
					if err := os.WriteFile(file, bytes.Repeat([]byte("x"), localStageRecoveryMaxBytes+1), 0o600); err != nil {
						t.Fatal(err)
					}
				case "symlink-file":
					if runtime.GOOS == "windows" {
						t.Skip("Windows symlink requires elevated filesystem privileges")
					}
					if err := os.Remove(file); err != nil {
						t.Fatal(err)
					}
					outside := filepath.Join(t.TempDir(), "outside")
					if err := os.WriteFile(outside, []byte("secret"), 0o600); err != nil {
						t.Fatal(err)
					}
					if err := os.Symlink(outside, file); err != nil {
						t.Fatal(err)
					}
				}
				if got, err := ReadLocalOriginalRecoveryHint(context.Background(), config, grant, stage.StageID); err == nil ||
					got.Stage.StageID != "" {
					t.Fatalf("corrupt/linked local Stage hint was trusted: %+v %v", got, err)
				}
				return
			}
			if err := SaveLocalOriginalRecoveryHint(ctx, config, scope, stage, path); err == nil {
				t.Fatalf("%s recovery Stage scope was allowed", tc)
			}
			if recovered, err := ListLocalOriginalRecoveryHints(context.Background(), config, grant); err == nil &&
				len(recovered) > 0 {
				t.Fatalf("%s wrote an untrusted hint: %+v", tc, recovered)
			}
		})
	}
}

func TestLocalOriginalRecoveryHintRejectsMutatedRecordAndConflictingReplay(t *testing.T) {
	config, grant, stage := localRecoveryHintFixture(t)
	if err := SaveLocalOriginalRecoveryHint(context.Background(), config, grant, stage, "photo.bin"); err != nil {
		t.Fatal(err)
	}
	conflict := stage
	conflict.SHA256 = strings.Repeat("a", 64)
	if err := SaveLocalOriginalRecoveryHint(context.Background(), config, grant, conflict, "photo.bin"); err == nil {
		t.Fatal("same Stage UUID replay overwrote its immutable original digest")
	}
	dir, err := localStageRecoveryDir(config, grant)
	if err != nil {
		t.Fatal(err)
	}
	file, err := localStageRecoveryFile(dir, stage.StageID)
	if err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var disk localStageRecoveryDisk
	if err := json.Unmarshal(contents, &disk); err != nil {
		t.Fatal(err)
	}
	disk.RootFingerprint = strings.Repeat("f", 64)
	mutated, err := json.Marshal(disk)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, mutated, 0o600); err != nil {
		t.Fatal(err)
	}
	if got, err := ReadLocalOriginalRecoveryHint(context.Background(), config, grant, stage.StageID); err == nil ||
		got.Stage.StageID != "" {
		t.Fatalf("stale saved Root proof incorrectly accepted: %+v %v", got, err)
	}
}

func TestLocalOriginalRecoveryHintNeverListsUnboundedCandidateQueue(t *testing.T) {
	config, grant, stage := localRecoveryHintFixture(t)
	ctx := context.Background()
	for i := 0; i < localStageRecoveryMaxFiles; i++ {
		stage.StageID = uuid.NewString()
		if err := SaveLocalOriginalRecoveryHint(ctx, config, grant, stage, "photo.bin"); err != nil {
			t.Fatalf("allowed candidate %d failed: %v", i, err)
		}
	}
	valid, err := ListLocalOriginalRecoveryHints(ctx, config, grant)
	if err != nil || len(valid) != localStageRecoveryMaxFiles {
		t.Fatalf("bounded candidate recovery broken: %d %v", len(valid), err)
	}
	stage.StageID = uuid.NewString()
	if err := SaveLocalOriginalRecoveryHint(ctx, config, grant, stage, "photo.bin"); err == nil {
		t.Fatal("Stage recovery could accumulate an unbounded local queue")
	}
}

func TestLocalOriginalRecoveryHintHeldWindowKeepsExactDiskIdentity(t *testing.T) {
	for _, mode := range []string{
		"unchanged", "same-bytes-new-inode", "same-inode-modified",
		"callback-denied", "canceled-during-callback",
	} {
		t.Run(mode, func(t *testing.T) {
			if mode == "same-bytes-new-inode" && runtime.GOOS == "windows" {
				t.Skip("Windows denies rename of a file with an open descriptor")
			}
			config, grant, stage := localRecoveryHintFixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if err := SaveLocalOriginalRecoveryHint(ctx, config, grant, stage, "photo.bin"); err != nil {
				t.Fatal(err)
			}
			dir, err := localStageRecoveryDir(config, grant)
			if err != nil {
				t.Fatal(err)
			}
			path, err := localStageRecoveryFile(dir, stage.StageID)
			if err != nil {
				t.Fatal(err)
			}
			entered := false
			err = WithHeldLocalOriginalRecoveryHint(
				ctx, config, grant, stage.StageID,
				func(callbackCtx context.Context, pinned LocalOriginalRecoveryHint) error {
					entered = true
					if pinned.Stage != stage || pinned.RelativePath != "photo.bin" ||
						callbackCtx.Err() != nil {
						t.Fatal("held callback received foreign Stage or canceled scope")
					}
					switch mode {
					case "same-bytes-new-inode":
						data, readErr := os.ReadFile(path)
						if readErr != nil {
							t.Fatal(readErr)
						}
						if renameErr := os.Rename(path, path+".old"); renameErr != nil {
							t.Fatal(renameErr)
						}
						if writeErr := os.WriteFile(path, data, 0o600); writeErr != nil {
							t.Fatal(writeErr)
						}
					case "same-inode-modified":
						data, readErr := os.ReadFile(path)
						if readErr != nil {
							t.Fatal(readErr)
						}
						if writeErr := os.WriteFile(path,
							bytes.Repeat([]byte("x"), len(data)), 0o600); writeErr != nil {
							t.Fatal(writeErr)
						}
					case "callback-denied":
						return errLocalStageRecovery
					case "canceled-during-callback":
						cancel()
					}
					return nil
				},
			)
			if !entered {
				t.Fatal("valid original private hint did not reach callback")
			}
			if mode == "unchanged" {
				if err != nil {
					t.Fatalf("unchanged original hint rejected: %v", err)
				}
			} else if err == nil {
				t.Fatalf("%s permitted stale or uncertain remote replay", mode)
			}
		})
	}
}

func TestLocalOriginalRecoveryHintHeldWindowRejectsWrongScopeBeforeCallback(t *testing.T) {
	config, grant, stage := localRecoveryHintFixture(t)
	if err := SaveLocalOriginalRecoveryHint(
		context.Background(), config, grant, stage, "photo.bin",
	); err != nil {
		t.Fatal(err)
	}
	for _, variant := range []string{"wrong-stage", "foreign-root", "canceled"} {
		t.Run(variant, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			proof, stageID := grant, stage.StageID
			switch variant {
			case "wrong-stage":
				stageID = uuid.NewString()
			case "foreign-root":
				proof.RootID = uuid.NewString()
			case "canceled":
				cancel()
			}
			entered := false
			err := WithHeldLocalOriginalRecoveryHint(
				ctx, config, proof, stageID,
				func(context.Context, LocalOriginalRecoveryHint) error {
					entered = true
					return nil
				},
			)
			if err == nil || entered {
				t.Fatalf("%s admitted a foreign or canceled recovery", variant)
			}
		})
	}
}
