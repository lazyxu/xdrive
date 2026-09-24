//go:build !windows

package main

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestAcquireSingleInstanceAt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "agent.lock")
	closeFirst, err := acquireSingleInstanceAt(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { closeFirst() })

	if closeSecond, err := acquireSingleInstanceAt(path); !errors.Is(err, errAlreadyRunning) {
		if closeSecond != nil {
			closeSecond()
		}
		t.Fatalf("second instance err=%v, want %v", err, errAlreadyRunning)
	}

	closeFirst()
	closeFirst = func() {}

	closeThird, err := acquireSingleInstanceAt(path)
	if err != nil {
		t.Fatalf("lock was not released: %v", err)
	}
	closeThird()
}
