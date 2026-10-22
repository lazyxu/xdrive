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

// Parse on Agent even though Electron Main also validates untrusted renderer
// input. Server remains the authoritative Owner ACL + PhotoAsset verifier.
func parseDesktopIPCMediaPlacesHierarchy(rawQuery string) (client.MediaPlaceHierarchyRequest, error) {
	request := client.MediaPlaceHierarchyRequest{Level: "country", Limit: 48}
	if len(rawQuery) > 2048 {
		return request, fmt.Errorf("hierarchy query too large")
	}
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return request, fmt.Errorf("invalid hierarchy query")
	}
	for key, entries := range values {
		switch key {
		case "level", "country", "region", "cursor", "search", "limit":
		default:
			return request, fmt.Errorf("unrecognized hierarchy field")
		}
		if len(entries) != 1 || !utf8.ValidString(entries[0]) || strings.TrimSpace(entries[0]) != entries[0] || strings.ContainsRune(entries[0], 0) {
			return request, fmt.Errorf("invalid hierarchy field")
		}
	}
	if v := values.Get("level"); v != "" {
		request.Level = v
	}
	request.Country = values.Get("country")
	request.Region = values.Get("region")
	request.Cursor = values.Get("cursor")
	request.Search = values.Get("search")
	if v := values.Get("limit"); v != "" {
		request.Limit, err = strconv.Atoi(v)
		if err != nil || request.Limit < 1 || request.Limit > 100 {
			return request, fmt.Errorf("invalid hierarchy limit")
		}
	}
	validCode := func(value string, max int) bool {
		if value == "" || len(value) > max {
			return false
		}
		for _, ch := range value {
			if (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' {
				continue
			}
			return false
		}
		return true
	}
	validCountry := func(value string) bool {
		return len(value) == 2 && value[0] >= 'A' && value[0] <= 'Z' && value[1] >= 'A' && value[1] <= 'Z'
	}
	switch request.Level {
	case "country":
		if request.Country != "" || request.Region != "" {
			return request, fmt.Errorf("invalid country hierarchy parent")
		}
	case "region":
		if !validCountry(request.Country) || request.Region != "" {
			return request, fmt.Errorf("invalid region hierarchy parent")
		}
	case "city":
		if !validCountry(request.Country) || !validCode(request.Region, 16) {
			return request, fmt.Errorf("invalid city hierarchy parent")
		}
	default:
		return request, fmt.Errorf("invalid hierarchy level")
	}
	if utf8.RuneCountInString(request.Search) > 80 {
		return request, fmt.Errorf("invalid hierarchy search")
	}
	if request.Cursor != "" {
		parts := strings.Split(request.Cursor, ":")
		switch request.Level {
		case "country":
			if len(parts) != 2 || parts[0] != "country" || !validCountry(parts[1]) {
				return request, fmt.Errorf("invalid country cursor")
			}
		case "region":
			if len(parts) != 3 || parts[0] != "region" || parts[1] != request.Country || !validCode(parts[2], 16) {
				return request, fmt.Errorf("invalid region cursor")
			}
		case "city":
			if len(parts) != 4 || parts[0] != "city" || parts[1] != request.Country || parts[2] != request.Region {
				return request, fmt.Errorf("invalid city cursor")
			}
			value, err := strconv.ParseInt(parts[3], 10, 64)
			if err != nil || value <= 0 || strconv.FormatInt(value, 10) != parts[3] {
				return request, fmt.Errorf("invalid GeoNames city cursor")
			}
		}
	}
	return request, nil
}

func (h *desktopIPCHandler) mediaPlacesHierarchy(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	request, err := parseDesktopIPCMediaPlacesHierarchy(r.URL.RawQuery)
	if err != nil {
		writeDesktopIPCError(w, http.StatusBadRequest, "invalid_media_places_hierarchy", "invalid hierarchy query")
		return
	}
	provider, ok := h.ctrl.(interface {
		CloudMediaPlacesHierarchy(context.Context, client.MediaPlaceHierarchyRequest) (client.MediaPlaceHierarchyPage, error)
	})
	if !ok {
		writeDesktopIPCError(w, http.StatusNotImplemented, "unsupported_media_places_hierarchy", "update Agent for place hierarchy")
		return
	}
	page, err := provider.CloudMediaPlacesHierarchy(r.Context(), request)
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, page)
}
