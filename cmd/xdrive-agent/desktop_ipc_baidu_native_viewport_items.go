package main

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/client"
)

// Strictly typed local BD09 Range. All parser failures are generic to avoid
// echoing private map coordinates or Owner selections in Desktop IPC logs.
func parseDesktopIPCBaiduNativeViewportItems(raw string) (
	client.BaiduNativeViewportBounds, int, int, client.BaiduNativeViewportItemsFilter, error,
) {
	var none client.BaiduNativeViewportBounds
	var filter client.BaiduNativeViewportItemsFilter
	fail := func() (client.BaiduNativeViewportBounds, int, int, client.BaiduNativeViewportItemsFilter, error) {
		return none, 0, 0, client.BaiduNativeViewportItemsFilter{}, fmt.Errorf("invalid BD09 photo Range")
	}
	vals, err := url.ParseQuery(raw)
	if err != nil || len(vals) < 8 || len(vals) > 17 {
		return fail()
	}
	allowed := map[string]bool{}
	for _, k := range []string{
		"coordinate_space", "range", "west", "south", "east", "north", "limit", "offset",
		"sort_by", "sort_dir", "anchor_node_id", "favorite", "captured_from", "captured_to",
		"time_zone", "kind", "album",
	} {
		allowed[k] = true
	}
	for k, list := range vals {
		if !allowed[k] || len(list) != 1 || list[0] == "" ||
			strings.TrimSpace(list[0]) != list[0] {
			return fail()
		}
	}
	for _, k := range []string{"coordinate_space", "range", "west", "south", "east", "north", "limit", "offset"} {
		if len(vals[k]) != 1 {
			return fail()
		}
	}
	if vals.Get("coordinate_space") != "bd09ll" || vals.Get("range") != "true" {
		return fail()
	}
	filter.SortBy = vals.Get("sort_by")
	filter.SortDir = vals.Get("sort_dir")
	filter.CapturedFrom = vals.Get("captured_from")
	filter.CapturedTo = vals.Get("captured_to")
	filter.TimeZone = vals.Get("time_zone")
	filter.MediaKind = vals.Get("kind")
	filter.AlbumKey = vals.Get("album")
	if filter.AlbumKey != "" {
		if utf8.RuneCountInString(filter.AlbumKey) > 512 {
			return fail()
		}
		approved := false
		for _, prefix := range []string{"folder:", "source:", "manual:", "smart:"} {
			if strings.HasPrefix(filter.AlbumKey, prefix) &&
				len(filter.AlbumKey) > len(prefix) {
				approved = true
				break
			}
		}
		if !approved {
			return fail()
		}
	}
	if s := vals.Get("anchor_node_id"); s != "" {
		n, e := strconv.ParseUint(s, 10, 64)
		if e != nil || n == 0 {
			return fail()
		}
		filter.AnchorNodeID = n
	}
	if s := vals.Get("favorite"); s != "" {
		// Only canonical values cross into Server.
		if s != "true" && s != "false" {
			return fail()
		}
		v := s == "true"
		filter.Favorite = &v
	}
	geometry := url.Values{}
	for _, k := range []string{"coordinate_space", "west", "south", "east", "north", "limit", "offset"} {
		geometry.Set(k, vals.Get(k))
	}
	bounds, limit, offset, e := parseDesktopIPCBaiduNativeViewport(geometry.Encode())
	if e != nil || (filter.SortBy != "" && filter.SortBy != "captured" && filter.SortBy != "added") ||
		(filter.SortDir != "" && filter.SortDir != "asc" && filter.SortDir != "desc") ||
		(filter.MediaKind != "" && filter.MediaKind != "image" && filter.MediaKind != "video") ||
		len(filter.CapturedFrom) > 128 || len(filter.CapturedTo) > 128 || len(filter.TimeZone) > 128 {
		return fail()
	}
	return bounds, limit, offset, filter, nil
}

// Only the Server Client may dispatch; no renderer owner, AK or arbitrary path.
func (h *desktopIPCHandler) mediaBaiduNativeViewportItems(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	bounds, limit, offset, filter, err := parseDesktopIPCBaiduNativeViewportItems(r.URL.RawQuery)
	if err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_baidu_viewport_items", "invalid BD09 photo Range")
		return
	}
	port, ok := h.ctrl.(interface {
		CloudBaiduNativeViewportItems(context.Context, client.BaiduNativeViewportBounds, int, int,
			client.BaiduNativeViewportItemsFilter) (client.MediaItemRange, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_baidu_viewport_items", "update Agent for BD09 photo Range")
		return
	}
	page, err := port.CloudBaiduNativeViewportItems(r.Context(), bounds, limit, offset, filter)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}
