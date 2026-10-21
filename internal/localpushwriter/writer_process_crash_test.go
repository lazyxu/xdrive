package localpushwriter

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

const writerCrashChildEnv = "XDRIVE_LOCALPUSH_WRITER_CRASH_CHILD"

// TestNativeWriterClaimRemainsQuarantinedAfterProcessDeath exercises an actual
// separate OS process. An unlocked kernel file after Kill is NOT evidence that
// remote Stage/HTTP/SQL work was physically cancelled or safe to retry.
func TestNativeWriterClaimRemainsQuarantinedAfterProcessDeath(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		t.Skip("native writer supports Linux and Windows only")
	}
	s := testScope(t)
	ready := filepath.Join(t.TempDir(), "writer-ready")
	command := exec.Command(os.Args[0], "-test.run=^TestNativeWriterCrashChild$")
	command.Env = append(os.Environ(),
		writerCrashChildEnv+"=1",
		"XDRIVE_WRITER_TEST_CONFIG="+s.configDir,
		"XDRIVE_WRITER_TEST_ROOT="+s.rootPath,
		"XDRIVE_WRITER_TEST_READY="+ready,
	)
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	t.Cleanup(func() {
		if !waited {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
	})
	deadline := time.Now().Add(20 * time.Second)
	for {
		if _, err := os.Stat(ready); err == nil {
			break
		} else if !os.IsNotExist(err) {
			t.Fatal(err)
		}
		if time.Now().After(deadline) {
			t.Fatal("native writer subprocess failed to create a live claim")
		}
		time.Sleep(25 * time.Millisecond)
	}

	// The child is still alive with an OS lock, so a competing descriptor
	// MUST fail to acquire it even though the marker file is readable/open.
	second, err := os.OpenFile(s.path(), os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := lockNativeWriter(second); err == nil {
		_ = unlockNativeWriter(second)
		_ = second.Close()
		t.Fatal("live writer's OS lock was acquired by another process")
	}
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := Begin(context.Background(), s); err == nil {
		t.Fatal("second writer admitted while native owner process is alive")
	}

	// Terminate the actual writer without calling Claim.Close in the child.
	// The kernel must drop the OS lock, but the immutable O_EXCL marker stays.
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = command.Wait() // forced termination intentionally returns a nonzero status
	waited = true
	original, err := os.ReadFile(s.path())
	if err != nil || string(original) != s.marker() {
		t.Fatalf("crashed original writer marker lost or corrupted: %v", err)
	}
	if strings.Contains(string(original), "owner") ||
		strings.Contains(string(original), s.rootPath) {
		t.Fatal("private original identity leaked in quarantined marker")
	}
	// Correlation of exact original marker after a real OS Kill only:
	// NO remote physical COMMIT/CANCEL, restart, key retirement, new Stage.
	if err := ReadOriginalWriterQuarantine(context.Background(), s); err != nil {
		t.Fatal("post-crash original writer quarantine unreadable:", err)
	}
	released, err := os.OpenFile(s.path(), os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := lockNativeWriter(released); err != nil {
		_ = released.Close()
		t.Fatalf("OS lock remained held after child process terminated: %v", err)
	}
	if err := unlockNativeWriter(released); err != nil {
		_ = released.Close()
		t.Fatal(err)
	}
	if err := released.Close(); err != nil {
		t.Fatal(err)
	}

	// A free kernel lock is not a physical-CANCEL terminal and MUST NOT be
	// used to manufacture another one-shot Writer, key, Stage or generation.
	if _, err := Begin(context.Background(), s); err == nil {
		t.Fatal("process crash and released lock allowed a second physical writer")
	}
}

func TestNativeWriterCrashChild(t *testing.T) {
	if os.Getenv(writerCrashChildEnv) != "1" {
		t.Skip("helper executes only in explicitly marked subprocess")
	}
	s, err := NewScope(
		os.Getenv("XDRIVE_WRITER_TEST_CONFIG"),
		os.Getenv("XDRIVE_WRITER_TEST_ROOT"),
		"https://example.invalid", "owner", "session", "device-id", "root-id",
		strings.Repeat("a", 64), 42, 3, 99,
		strings.Repeat("b", 64), strings.Repeat("c", 64))
	if err != nil {
		t.Fatal(err)
	}
	claim, err := Begin(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	defer claim.Close()
	if err := os.WriteFile(os.Getenv("XDRIVE_WRITER_TEST_READY"), []byte("live"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Parent will Kill this process without unwinding. No server terminal
	// state, physical cancellation or recovery authorization is fabricated.
	for {
		time.Sleep(time.Hour)
	}
}
