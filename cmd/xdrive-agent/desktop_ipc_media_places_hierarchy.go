package main

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/client"
)

var (
	placeHierarchyCountryPattern = regexp.MustCompile(`^[A-Z]{2}$`)
	placeHierarchyRegionPattern  = regexp.MustCompile(`^[A-Z0-9_-]{1,16}$`)
	placeHierarchyCountryCursor  = regexp.MustCompile(`^country:[A-Z]{2}$`)
	placeHierarchyRegionCursor   = regexp.MustCompile(`^region:[A-Z]{2}:[A-Z0-9_-]{1,16}$`)
	placeHierarchyCityCursor     = regexp.MustCompile(`^city:[A-Z]{2}:[A-Z0-9_-]{1,16}:[1-9][0-9]*$`)
)

// Reject unbounded or arbitrary renderer-controlled paths before forwarding to
// the authenticated Owner Cloud Client. Server rechecks ACL/GPS/version.
func parseDesktopIPCMediaPlacesHierarchy(raw string) (url.Values, error) {
	if len(raw) > 4096 {
		return nil, fmt.Errorf("hierarchy query too large")
	}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid hierarchy query")
	}
	allowed := map[string]bool{
		"level": true, "country": true, "region": true, "cursor": true,
		"limit": true, "search": true, "album": true, "time_zone": true, "q": true,
		"sort_by": true, "sort_dir": true, "kind": true, "asset_kind": true,
		"category": true, "folder_id": true, "include_descendants": true,
		"captured_from": true, "captured_to": true, "has_location": true,
		"favorite": true, "tag": true, "person": true, "person_identity": true,
		"fold_duplicates": true, "anchor_node_id": true, "camera": true,
		"format": true, "fold_member_id": true,
	}
	for key, list := range values {
		if !allowed[key] || len(list) == 0 || len(list) > 32 {
			return nil, fmt.Errorf("invalid hierarchy field")
		}
		if key != "camera" && key != "format" && key != "fold_member_id" && len(list) != 1 {
			return nil, fmt.Errorf("duplicate hierarchy field")
		}
		for _, value := range list {
			if len(value) > 512 || !utf8.ValidString(value) || strings.ContainsRune(value, 0) {
				return nil, fmt.Errorf("invalid hierarchy value")
			}
		}
	}
	level, country, region := values.Get("level"), values.Get("country"), values.Get("region")
	switch level {
	case "country":
		if country != "" || region != "" {
			return nil, fmt.Errorf("invalid country facet")
		}
	case "region":
		if !placeHierarchyCountryPattern.MatchString(country) || region != "" {
			return nil, fmt.Errorf("invalid region facet")
		}
	case "city":
		if !placeHierarchyCountryPattern.MatchString(country) || !placeHierarchyRegionPattern.MatchString(region) {
			return nil, fmt.Errorf("invalid city facet")
		}
	default:
		return nil, fmt.Errorf("invalid hierarchy level")
	}
	if rawLimit := values.Get("limit"); rawLimit != "" {
		limit, err := strconv.Atoi(rawLimit)
		if err != nil || limit < 1 || limit > 100 {
			return nil, fmt.Errorf("invalid hierarchy limit")
		}
	}
	if utf8.RuneCountInString(values.Get("search")) > 80 {
		return nil, fmt.Errorf("invalid hierarchy search")
	}
	if cursor := values.Get("cursor"); cursor != "" {
		valid := (level == "country" && placeHierarchyCountryCursor.MatchString(cursor)) ||
			(level == "region" && placeHierarchyRegionCursor.MatchString(cursor) && strings.HasPrefix(cursor, "region:"+country+":")) ||
			(level == "city" && placeHierarchyCityCursor.MatchString(cursor) && strings.HasPrefix(cursor, "city:"+country+":"+region+":"))
		if !valid {
			return nil, fmt.Errorf("invalid hierarchy cursor")
		}
	}
	return values, nil
}

func (h *desktopIPCHandler) mediaPlacesHierarchy(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	query, err := parseDesktopIPCMediaPlacesHierarchy(r.URL.RawQuery)
	if err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_places_hierarchy", "invalid place hierarchy request")
		return
	}
	reader, ok := h.ctrl.(interface {
		CloudMediaPlaceHierarchy(context.Context, url.Values) (client.MediaPlaceHierarchyPage, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_media_places_hierarchy", "update Desktop Agent")
		return
	}
	page, err := reader.CloudMediaPlaceHierarchy(r.Context(), query)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}
