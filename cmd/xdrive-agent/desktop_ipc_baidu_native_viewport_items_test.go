package main

import "testing"

func TestDesktopIPCNativeCameraItemsStrictRangeAndFilters(t *testing.T) {
	good := "coordinate_space=bd09ll&west=116&south=39&east=117&north=40&limit=48&offset=0&range=true"
	b, limit, offset, f, err := parseDesktopIPCBaiduNativeViewportItems(
		good + "&favorite=true&sort_by=captured&anchor_node_id=14&time_zone=Asia%2FTokyo")
	if err != nil || b.CoordinateSpace != "bd09ll" || limit != 48 || offset != 0 ||
		f.Favorite == nil || !*f.Favorite || f.AnchorNodeID != 14 || f.TimeZone != "Asia/Tokyo" {
		t.Fatalf("trusted local camera filter refused: %+v %d %d %+v %v", b, limit, offset, f, err)
	}
	for _, bad := range []string{
		good + "&owner_id=777", good + "&ak=secret", good + "&bbox=0,0,1,1",
		good + "&fold_duplicates=true", good + "&coordinate_space=wgs84",
		good + "&favorite=false&favorite=true", good + "&sort_by=distance",
		good + "&kind=live_photo", good + "&anchor_node_id=0",
		good + "&range=false", good + "&west=115",
		"coordinate_space=wgs84&west=116&south=39&east=117&north=40&limit=48&offset=0&range=true",
	} {
		if _, _, _, _, e := parseDesktopIPCBaiduNativeViewportItems(bad); e == nil {
			t.Fatalf("untrusted Desktop camera request admitted")
		}
	}
}
