package main

import (
	"net/http"
	"net/url"
	"strconv"

	"github.com/lazyxu/xdrive/internal/client"
)

// Strict GET-only Owner gallery endpoints. They read via the authenticated
// owning Agent's existing Server client, then transmit *only* a redacted DTO.
// This is not the ordinary full Desktop media RPC; no arbitrary query filter,
// Server URL, CAS key, Root, Owner ID or arbitrary Agent method is accepted.
func ownerGalleryAgentSelector(r *http.Request) (kind string, limit, offset int, albumID string, ok bool) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || (len(q) != 3 && len(q) != 4) {
		return "", 0, 0, "", false
	}
	for key, values := range q {
		switch key {
		case "kind", "limit", "offset", "album_id":
			if len(values) != 1 {
				return "", 0, 0, "", false
			}
		default:
			return "", 0, 0, "", false
		}
	}
	if len(q["kind"]) != 1 || len(q["limit"]) != 1 || len(q["offset"]) != 1 {
		return "", 0, 0, "", false
	}
	kind = q.Get("kind")
	limit, errLimit := strconv.Atoi(q.Get("limit"))
	offset, errOffset := strconv.Atoi(q.Get("offset"))
	if !client.ValidOwnerGalleryKind(kind) ||
		errLimit != nil || errOffset != nil ||
		!client.ValidOwnerGalleryWindow(limit, offset) ||
		strconv.Itoa(limit) != q.Get("limit") ||
		strconv.Itoa(offset) != q.Get("offset") {
		return "", 0, 0, "", false
	}
	if len(q["album_id"]) != 0 {
		albumID = q.Get("album_id")
		if !client.ValidOwnerGalleryAlbumID(albumID) {
			return "", 0, 0, "", false
		}
	}
	return kind, limit, offset, albumID, true
}

func (h *desktopIPCHandler) cloudOwnerGalleryItems(w http.ResponseWriter, r *http.Request) {
	kind, limit, offset, albumID, ok := ownerGalleryAgentSelector(r)
	if !ok {
		writeDesktopIPCError(w, http.StatusBadRequest,
			"invalid_owner_gallery_selector", "bounded Owner gallery selector required")
		return
	}
	query := client.MediaQuery{SortBy: "captured", SortDir: "desc"}
	if kind != "all" {
		query.MediaKind = kind
	}
	var page client.MediaItemRange
	var err error
	if albumID == "" {
		page, err = h.ctrl.CloudMediaItemsRange(r.Context(), query, limit, offset)
	} else {
		page, err = h.ctrl.CloudMediaAlbumItemsRange(r.Context(), albumID, query, limit, offset)
	}
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	projected, err := client.ProjectOwnerGalleryPage(page, limit, offset)
	if err != nil {
		writeDesktopIPCError(w, http.StatusServiceUnavailable,
			"invalid_owner_gallery_projection", "Server Owner gallery range unavailable")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, projected)
}

func (h *desktopIPCHandler) cloudOwnerGalleryAlbums(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" {
		writeDesktopIPCError(w, http.StatusBadRequest,
			"invalid_owner_gallery_album_selector", "Owner album inventory takes no selector")
		return
	}
	albums, err := h.ctrl.CloudMediaAlbums(r.Context())
	if err != nil {
		writeDesktopIPCControllerError(w, err)
		return
	}
	projected, err := client.ProjectOwnerGalleryAlbums(albums)
	if err != nil {
		writeDesktopIPCError(w, http.StatusServiceUnavailable,
			"invalid_owner_gallery_projection", "Server Owner albums unavailable")
		return
	}
	writeDesktopIPCJSON(w, http.StatusOK, projected)
}
