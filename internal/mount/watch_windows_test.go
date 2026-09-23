//go:build windows

package mount

import (
	"context"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"time"
	"unicode/utf16"

	"golang.org/x/sys/windows"
)

func TestParseWindowsNotifyBuffer(t *testing.T) {
	buf := encodeNotifyTestBuffer([]winLocalChange{
		{Action: windows.FILE_ACTION_ADDED, Path: "dir\\file.txt"},
		{Action: windows.FILE_ACTION_MODIFIED, Path: "dir\\file.txt"},
	})
	got, err := parseWindowsNotifyBuffer(buf)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("changes=%d want 2", len(got))
	}
	if got[0].Path != "dir/file.txt" || got[0].Action != windows.FILE_ACTION_ADDED {
		t.Fatalf("first change=%+v", got[0])
	}
	if got[1].Path != "dir/file.txt" || got[1].Action != windows.FILE_ACTION_MODIFIED {
		t.Fatalf("second change=%+v", got[1])
	}
}

func TestCollapseWindowsChangesPairsRenameAndKeepsLaterModify(t *testing.T) {
	set := collapseWindowsChanges([]winLocalChange{
		{Action: windows.FILE_ACTION_RENAMED_OLD_NAME, Path: "old.txt"},
		{Action: windows.FILE_ACTION_RENAMED_NEW_NAME, Path: "new.txt"},
		{Action: windows.FILE_ACTION_MODIFIED, Path: "new.txt"},
		{Action: windows.FILE_ACTION_MODIFIED, Path: "new.txt"},
	})
	if len(set.Renames) != 1 || set.Renames[0].OldPath != "old.txt" || set.Renames[0].NewPath != "new.txt" {
		t.Fatalf("renames=%+v", set.Renames)
	}
	if len(set.Paths) != 1 || set.Paths[0] != "new.txt" {
		t.Fatalf("paths=%v", set.Paths)
	}
}

func TestCollapseWindowsChangesMarksOverflow(t *testing.T) {
	set := collapseWindowsChanges([]winLocalChange{{Action: 0}})
	if !set.Overflow {
		t.Fatal("overflow marker was lost")
	}
}

func TestWindowsDirectoryWatcherReportsNestedChange(t *testing.T) {
	root := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	changes, errs := watchWindowsChanges(ctx, root)

	nested := filepath.Join(root, "nested")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(nested, "event.txt")
	if err := os.WriteFile(target, []byte("event"), 0o644); err != nil {
		t.Fatal(err)
	}

	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for {
		select {
		case err, ok := <-errs:
			if ok && err != nil {
				t.Fatal(err)
			}
		case change, ok := <-changes:
			if !ok {
				t.Fatal("watcher closed before reporting change")
			}
			if change.Path == "nested/event.txt" {
				return
			}
		case <-deadline.C:
			t.Fatal("timed out waiting for recursive ReadDirectoryChangesW event")
		}
	}
}

func encodeNotifyTestBuffer(changes []winLocalChange) []byte {
	var out []byte
	for i, change := range changes {
		name := utf16.Encode([]rune(change.Path))
		recordLen := 12 + len(name)*2
		padded := (recordLen + 3) &^ 3
		record := make([]byte, padded)
		if i < len(changes)-1 {
			binary.LittleEndian.PutUint32(record[0:4], uint32(padded))
		}
		binary.LittleEndian.PutUint32(record[4:8], change.Action)
		binary.LittleEndian.PutUint32(record[8:12], uint32(len(name)*2))
		for j, r := range name {
			binary.LittleEndian.PutUint16(record[12+j*2:14+j*2], r)
		}
		out = append(out, record...)
	}
	return out
}
