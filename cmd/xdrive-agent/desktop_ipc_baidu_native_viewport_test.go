package main

import "testing"

func TestDesktopBaiduNativeViewportRejectsWGS84AndUnbounded(t *testing.T) {
	good := "coordinate_space=bd09ll&west=100&south=20&east=110&north=30&limit=100&offset=0"
	b, limit, offset, err := parseDesktopIPCBaiduNativeViewport(good)
	if err != nil || b.CoordinateSpace != "bd09ll" ||
		limit != 100 || offset != 0 {
		t.Fatalf("expected BD09-only envelope: %+v, %d, %d, %v", b, limit, offset, err)
	}
	for _, q := range []string{
		"west=100&south=20&east=110&north=30",
		"coordinate_space=photo-wgs84&west=100&south=20&east=110&north=30",
		"coordinate_space=bd09ll&coordinate_space=bd09ll&west=100&south=20&east=110&north=30",
		"coordinate_space=bd09ll&west=100&south=20&east=110&north=30&ak=private",
		"coordinate_space=bd09ll&west=100&south=20&east=110&north=30&limit=101",
		"coordinate_space=bd09ll&west=100&south=20&east=110&north=30&offset=10000001",
		"coordinate_space=bd09ll&west=100&south=20&east=100&north=30",
	} {
		if _, _, _, err := parseDesktopIPCBaiduNativeViewport(q); err == nil {
			t.Fatalf("invalid local viewport accepted: %q", q)
		}
	}
}
