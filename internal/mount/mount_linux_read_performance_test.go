//go:build linux

package mount

import (
	"context"
	"os"
	"testing"

	"github.com/hanwen/go-fuse/v2/fuse"
)

func TestLinuxHandleReadReusesFuseDestinationBuffer(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "xdrive-linux-read-*")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()

	const payload = "0123456789abcdef"
	if _, err := file.WriteString(payload); err != nil {
		t.Fatal(err)
	}

	handle := &linuxHandle{file: file}

	dest := make([]byte, 6)
	result, errno := handle.Read(context.Background(), dest, 4)
	if errno != 0 {
		t.Fatalf("read errno=%v", errno)
	}
	got, status := result.Bytes(make([]byte, len(dest)))
	if status != fuse.OK {
		t.Fatalf("read status=%v", status)
	}
	if string(got) != "456789" {
		t.Fatalf("read payload=%q want=%q", string(got), "456789")
	}
	if len(got) == 0 || &got[0] != &dest[0] {
		t.Fatal("read result does not reuse the incoming FUSE destination buffer")
	}

	eofDest := make([]byte, 8)
	eofResult, errno := handle.Read(context.Background(), eofDest, int64(len(payload)-3))
	if errno != 0 {
		t.Fatalf("EOF read errno=%v", errno)
	}
	eofGot, status := eofResult.Bytes(nil)
	if status != fuse.OK {
		t.Fatalf("EOF read status=%v", status)
	}
	if string(eofGot) != "def" {
		t.Fatalf("EOF payload=%q want=%q", string(eofGot), "def")
	}
	if len(eofGot) == 0 || &eofGot[0] != &eofDest[0] {
		t.Fatal("partial EOF result does not reuse the incoming FUSE destination buffer")
	}
}
