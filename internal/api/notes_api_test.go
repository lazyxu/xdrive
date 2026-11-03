package api

import (
	"strings"
	"testing"
)

func TestNoteMarkdownInputAndPaginationPolicy(t *testing.T) {
	tests := []struct {
		name  string
		req   notesWriteRequest
		valid bool
	}{
		{name: "chinese title and markdown", req: notesWriteRequest{
			Title: "会议计划", Markdown: "# 中文标题\n\n- 内容 📝"}, valid: true},
		{name: "empty Markdown allowed", req: notesWriteRequest{
			Title: "Blank", Markdown: ""}, valid: true},
		{name: "empty title refused", req: notesWriteRequest{
			Title: " ", Markdown: "content"}},
		{name: "title with newline refused", req: notesWriteRequest{
			Title: "A\nB", Markdown: "content"}},
		{name: "embedded NUL refused", req: notesWriteRequest{
			Title: "A", Markdown: "prefix\x00suffix"}},
		{name: "invalid UTF-8 refused", req: notesWriteRequest{
			Title: "A", Markdown: string([]byte{0xff})}},
		{name: "more than 1 MiB refused", req: notesWriteRequest{
			Title: "A", Markdown: strings.Repeat("X", notesMaximumMarkdownBytes+1)}},
		{name: "external identity rejects controls", req: notesWriteRequest{
			Title: "A", Markdown: "body", ExternalID: "line\nbreak"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := validateNoteWriteInput(tt.req)
			if (err == nil) != tt.valid {
				t.Fatalf("unexpected Markdown acceptance: valid=%v err=%v", tt.valid, err)
			}
		})
	}
	for _, raw := range []string{"", "0", "50", "100", "10000000"} {
		if _, err := parseNotesOffset(raw); err != nil {
			t.Errorf("valid Notes paging offset %q: %v", raw, err)
		}
	}
	for _, raw := range []string{"-50", "49", "1", "x", "999999999", "10000001", "50?limit=500"} {
		if _, err := parseNotesOffset(raw); err == nil {
			t.Errorf("accepted invalid Notes page offset %q", raw)
		}
	}
	if escapeNoteLike("%_\\") != "\\%\\_\\\\" {
		t.Fatal("wildcard was not escaped before Owner Notes search")
	}
}
