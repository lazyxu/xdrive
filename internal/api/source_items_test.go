package api

import "testing"

func TestSourceItemRowDTOIncludesLastError(t *testing.T) {
	row := sourceItemRow{
		SourceItemID: 1,
		ExternalID:   "remote-1",
		Kind:         "file",
		Path:         "photo.jpg",
		State:        "error",
		LastError:    "download unavailable",
	}
	dto := row.dto()
	if dto.LastError != "download unavailable" {
		t.Fatalf("last_error=%q", dto.LastError)
	}
}
