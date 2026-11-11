package client

import (
	"strings"
	"testing"
)

func TestClipboardChangeSSEOnlyReturnsCursor(t *testing.T) {
	good := "retry: 2000\nevent: sync\ndata: {}\n\n: ping\n\nevent: change\nid: 18\ndata: {}\n\n"
	result, err := readClipboardChangeSSE(strings.NewReader(good), 17)
	if err != nil || !result.Changed || result.Cursor != 18 {
		t.Fatalf("expected safe change cursor: %#v %v", result, err)
	}
	invalid := []string{
		"event: change\nid: 17\ndata: {}\n\n",
		"event: change\nid: 18\ndata: {\"secret\":\"x\"}\n\n",
		"event: change\nid: 9007199254740992\ndata: {}\n\n",
		"event: change\ndata: {}\n\n",
		"event: unauthorized\nid: 18\ndata: {}\n\n",
	}
	for _, raw := range invalid {
		if _, err := readClipboardChangeSSE(strings.NewReader(raw), 17); err == nil {
			t.Fatalf("unsafe SSE accepted: %q", raw)
		}
	}
	noChange, err := readClipboardChangeSSE(strings.NewReader("event: sync\ndata: {}\n\n"), 17)
	if err != nil || noChange.Changed || noChange.Cursor != 17 {
		t.Fatalf("unexpected sync-only event: %#v %v", noChange, err)
	}
}
