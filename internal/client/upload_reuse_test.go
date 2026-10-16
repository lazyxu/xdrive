package client

import "testing"

func TestConfirmedUploadReuseBytes(t *testing.T) {
	cas, resumed := confirmedUploadReuseBytes(map[int]UploadPart{
		0: {Index: 0, Size: 8, Reused: true},
		1: {Index: 1, Size: 8, Reused: false},
		2: {Index: 2, Size: 4, Reused: true},
	})
	if cas != 12 || resumed != 8 {
		t.Fatalf("reuse buckets: cas=%d resumed=%d, want 12/8", cas, resumed)
	}
	cas, resumed = confirmedUploadReuseBytes(nil)
	if cas != 0 || resumed != 0 {
		t.Fatalf("empty upload reuse=%d/%d", cas, resumed)
	}
}
