package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/lazyxu/xdrive/internal/transfer"
	"github.com/lazyxu/xdrive/internal/userconfig"
)

func TestAgentTransferHistoryDiskIsScopedAndAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "history.json")
	tasks := []transfer.Task{{
		ID: "transfer-4", RootID: "transfer-4", Kind: transfer.KindUpload,
		Direction: "upload", State: transfer.StateCompleted,
		AverageBytesPerSecond: 123456, ElapsedMilliseconds: 9000,
	}}
	if err := writeAgentTransferHistory(path, "user-a", tasks); err != nil {
		t.Fatal(err)
	}
	loaded, err := readAgentTransferHistory(path, "user-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded) != 1 || loaded[0].AverageBytesPerSecond != 123456 ||
		loaded[0].ElapsedMilliseconds != 9000 {
		t.Fatalf("average speed and duration must survive JSON on disk: %+v", loaded)
	}
	if _, err := readAgentTransferHistory(path, "user-b"); err == nil {
		t.Fatal("an unrelated account must not restore another user's transfer history")
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("history must be private: %s", info.Mode().Perm())
		}
	}
	if err := writeAgentTransferHistory(path, "user-a", nil); err != nil {
		t.Fatal(err)
	}
	loaded, err = readAgentTransferHistory(path, "user-a")
	if err != nil || len(loaded) != 0 {
		t.Fatalf("cleared history must stay cleared after a restart: %+v, %v", loaded, err)
	}
}

func TestAgentTransferHistoryScopeIdentityChangesWithServerAndAccount(t *testing.T) {
	first, firstKey, err := agentTransferHistoryIdentity(userconfig.Config{
		Server: "https://a.example", Username: "alice",
	})
	if err != nil {
		t.Fatal(err)
	}
	second, secondKey, err := agentTransferHistoryIdentity(userconfig.Config{
		Server: "https://a.example", Username: "bob",
	})
	if err != nil {
		t.Fatal(err)
	}
	third, thirdKey, err := agentTransferHistoryIdentity(userconfig.Config{
		Server: "https://b.example", Username: "alice",
	})
	if err != nil {
		t.Fatal(err)
	}
	if first == second || first == third || firstKey == secondKey || firstKey == thirdKey {
		t.Fatal("server/account boundaries must never share a history file")
	}
	if _, _, err := agentTransferHistoryIdentity(userconfig.Config{}); err == nil {
		t.Fatal("unconfigured account must have no persistent history")
	}
}

func TestAgentTransferHistoryRefusesInvalidFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "history.json")
	if err := os.WriteFile(path, []byte("{not-json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := readAgentTransferHistory(path, "scope-a"); err == nil {
		t.Fatal("malformed durable history must not be loaded as valid")
	}
	if got, err := readAgentTransferHistory(filepath.Join(dir, "absent.json"), "scope-a"); err != nil || got != nil {
		t.Fatalf("missing history must be treated as empty: %+v, %v", got, err)
	}
}
