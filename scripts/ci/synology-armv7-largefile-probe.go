//go:build ignore

// This ARMv7 probe exercises 64-bit Linux file offsets with a sparse file.
// It does not claim genuine xDrive uploads, CAS commits, or NAS hardware proof.
package main

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

func main() {
	if err := probe(); err != nil {
		fmt.Fprintln(os.Stderr, "armv7 sparse offset probe:", err)
		os.Exit(1)
	}
	fmt.Println("ARMv7 sparse file >4 GiB seek/read/write passed")
}

func probe() error {
	dir, err := os.MkdirTemp("", "xdrive-synology-armv7-offset-")
	if err != nil { return err }
	defer os.RemoveAll(dir)

	path := filepath.Join(dir, "over-4gib.sparse")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR|os.O_EXCL, 0600)
	if err != nil { return err }
	defer f.Close()

	offset := (int64(5) << 30) + 4096
	payload := []byte("xdrive-armv7-original-offset-proof")
	if err := f.Truncate(offset + int64(len(payload))); err != nil { return fmt.Errorf("truncate: %w", err) }
	n, err := f.WriteAt(payload, offset)
	if err != nil || n != len(payload) { return fmt.Errorf("write at %d: bytes=%d err=%v", offset, n, err) }
	info, err := f.Stat()
	if err != nil { return err }
	if info.Size() != offset + int64(len(payload)) { return fmt.Errorf("32-bit size overflow: %d", info.Size()) }
	if err := f.Sync(); err != nil { return err }
	if err := f.Close(); err != nil { return err }
	f, err = os.Open(path)
	if err != nil { return err }

	got := make([]byte, len(payload))
	n, err = f.ReadAt(got, offset)
	if err != nil && err != io.EOF { return fmt.Errorf("read at %d: %w", offset, err) }
	if n != len(payload) || !bytes.Equal(got, payload) {
		return fmt.Errorf("offset payload mismatch: got %d bytes", n)
	}
	return nil
}
