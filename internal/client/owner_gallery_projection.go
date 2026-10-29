package client

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

// OwnerGallery is a deliberately narrow, Server-Owner-authorized read-only
// projection. Never relay the full MediaItem, arbitrary EXIF/GPS, CAS keys,
// trash roots, OCR text, album queries, arbitrary resources or Server URLs.
const OwnerGalleryPageLimit = 100
const OwnerGalleryMaxOffset = 10_000_000
const ownerGalleryMaxSafe = uint64(1<<53 - 1)

type OwnerGalleryNode struct {
	ID        uint64    `json:"id"`
	ParentID  uint64    `json:"parent_id"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	Size      int64     `json:"size"`
	Revision  uint64    `json:"revision"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type OwnerGalleryMetadata struct {
	MediaKind    string     `json:"media_kind"`
	MIMEType     string     `json:"mime_type,omitempty"`
	Width        int        `json:"width,omitempty"`
	Height       int        `json:"height,omitempty"`
	DurationMS   int64      `json:"duration_ms,omitempty"`
	CapturedAt   *time.Time `json:"captured_at,omitempty"`
	IndexState   string     `json:"index_state"`
	HasThumbnail bool       `json:"has_thumbnail"`
}

type OwnerGalleryItem struct {
	Node      OwnerGalleryNode     `json:"node"`
	Metadata  OwnerGalleryMetadata `json:"metadata"`
	AssetKind string               `json:"asset_kind,omitempty"`
	Favorite  bool                 `json:"favorite"`
	LivePhoto bool                 `json:"live_photo,omitempty"`
}

type OwnerGalleryPage struct {
	Items      []OwnerGalleryItem `json:"items"`
	TotalCount int64              `json:"total_count"`
	Offset     int                `json:"offset"`
	Limit      int                `json:"limit"`
}

type OwnerGalleryAlbum struct {
	ID            string     `json:"id"`
	Kind          string     `json:"kind"`
	Name          string     `json:"name"`
	AlbumFolderID uint64     `json:"album_folder_id,omitempty"`
	Revision      uint64     `json:"revision,omitempty"`
	ItemCount     int64      `json:"item_count"`
	CoverNodeID   *uint64    `json:"cover_node_id,omitempty"`
	UpdatedAt     *time.Time `json:"updated_at,omitempty"`
}

func ValidOwnerGalleryKind(kind string) bool {
	return kind == "all" || kind == "image" || kind == "video"
}

func ValidOwnerGalleryWindow(limit, offset int) bool {
	return limit >= 1 && limit <= OwnerGalleryPageLimit &&
		offset >= 0 && offset <= OwnerGalleryMaxOffset
}

// Only Server-generated album identities. There is no arbitrary path, query,
// folder search or caller-selected Root in this read-only API.
func ValidOwnerGalleryAlbumID(value string) bool {
	if len(value) < 3 || len(value) > 160 {
		return false
	}
	index := strings.IndexByte(value, ':')
	if index < 1 || index >= len(value)-1 {
		return false
	}
	switch value[:index] {
	case "manual", "folder", "source", "smart":
	default:
		return false
	}
	for _, c := range value[index+1:] {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') || c == '_' || c == '-' || c == ':' {
			continue
		}
		return false
	}
	return true
}

func ownerGallerySafeAssetKind(kind string) bool {
	if len(kind) > 64 {
		return false
	}
	for _, c := range kind {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') {
			return false
		}
	}
	return true
}

func ownerGallerySafeNode(n Node) bool {
	if n.ID == 0 || n.ID > ownerGalleryMaxSafe ||
		n.ParentID == nil || *n.ParentID == 0 || *n.ParentID > ownerGalleryMaxSafe ||
		n.Revision == 0 || n.Revision > ownerGalleryMaxSafe ||
		n.Type != "file" || n.DeletedAt != nil ||
		n.Size < 0 || uint64(n.Size) > ownerGalleryMaxSafe ||
		n.Name == "" || len(n.Name) > 512 || !utf8.ValidString(n.Name) {
		return false
	}
	for _, c := range n.Name {
		if c == 0 || c == '\r' || c == '\n' {
			return false
		}
	}
	return !n.CreatedAt.IsZero() && !n.UpdatedAt.IsZero()
}

func ownerGallerySafeMetadata(m MediaMetadata) bool {
	if m.MediaKind != "image" && m.MediaKind != "video" {
		return false
	}
	if m.Width < 0 || m.Width > 100_000 || m.Height < 0 || m.Height > 100_000 ||
		m.DurationMS < 0 || uint64(m.DurationMS) > ownerGalleryMaxSafe ||
		len(m.MIMEType) > 128 || len(m.IndexState) > 64 ||
		!utf8.ValidString(m.MIMEType) || !utf8.ValidString(m.IndexState) ||
		(m.CapturedAt != nil && m.CapturedAt.IsZero()) {
		return false
	}
	for _, value := range []string{m.MIMEType, m.IndexState} {
		for _, c := range value {
			if c < 0x20 || c > 0x7e {
				return false
			}
		}
	}
	return true
}

// ProjectOwnerGalleryPage validates before serialization and copies ONLY
// approved fields. Every original response is already Server Owner-scoped;
// this separate projection additionally prevents secret/extra data leakage.
func ProjectOwnerGalleryPage(page MediaItemRange, limit, offset int) (OwnerGalleryPage, error) {
	if !ValidOwnerGalleryWindow(limit, offset) || page.Limit != limit ||
		page.Offset != offset || page.TotalCount < 0 ||
		uint64(page.TotalCount) > ownerGalleryMaxSafe ||
		page.Items == nil || len(page.Items) > limit ||
		(len(page.Items) == 0 && int64(offset) < page.TotalCount) ||
		(len(page.Items) > 0 && int64(offset)+int64(len(page.Items)) > page.TotalCount) {
		return OwnerGalleryPage{}, errors.New("invalid Owner gallery range")
	}
	out := OwnerGalleryPage{
		Items:      make([]OwnerGalleryItem, 0, len(page.Items)),
		TotalCount: page.TotalCount, Offset: offset, Limit: limit,
	}
	seen := make(map[uint64]bool, len(page.Items))
	for _, item := range page.Items {
		n := item.Node
		if !ownerGallerySafeNode(n) || !ownerGallerySafeMetadata(item.Metadata) ||
			seen[n.ID] || !ownerGallerySafeAssetKind(item.AssetKind) {
			return OwnerGalleryPage{}, errors.New("unsafe Owner gallery item")
		}
		seen[n.ID] = true
		out.Items = append(out.Items, OwnerGalleryItem{
			Node: OwnerGalleryNode{
				ID: n.ID, ParentID: *n.ParentID, Name: n.Name,
				Type: "file", Size: n.Size, Revision: n.Revision,
				CreatedAt: n.CreatedAt, UpdatedAt: n.UpdatedAt,
			},
			Metadata: OwnerGalleryMetadata{
				MediaKind: item.Metadata.MediaKind, MIMEType: item.Metadata.MIMEType,
				Width: item.Metadata.Width, Height: item.Metadata.Height,
				DurationMS:   item.Metadata.DurationMS,
				CapturedAt:   item.Metadata.CapturedAt,
				IndexState:   item.Metadata.IndexState,
				HasThumbnail: item.Metadata.HasThumbnail,
			},
			AssetKind: item.AssetKind, Favorite: item.Favorite,
			LivePhoto: item.LivePhoto,
		})
	}
	return out, nil
}

func ValidOwnerGalleryPage(page OwnerGalleryPage, limit, offset int) bool {
	if !ValidOwnerGalleryWindow(limit, offset) || page.Limit != limit ||
		page.Offset != offset || page.TotalCount < 0 ||
		uint64(page.TotalCount) > ownerGalleryMaxSafe ||
		page.Items == nil || len(page.Items) > limit ||
		(len(page.Items) == 0 && int64(offset) < page.TotalCount) ||
		(len(page.Items) > 0 && int64(offset)+int64(len(page.Items)) > page.TotalCount) {
		return false
	}
	seen := make(map[uint64]bool, len(page.Items))
	for _, item := range page.Items {
		n := item.Node
		parent := n.ParentID
		if !ownerGallerySafeNode(Node{
			ID: n.ID, ParentID: &parent, Name: n.Name, Type: n.Type,
			Size: n.Size, Revision: n.Revision,
			CreatedAt: n.CreatedAt, UpdatedAt: n.UpdatedAt,
		}) || seen[n.ID] ||
			!ownerGallerySafeMetadata(MediaMetadata{
				MediaKind: item.Metadata.MediaKind, MIMEType: item.Metadata.MIMEType,
				Width: item.Metadata.Width, Height: item.Metadata.Height,
				DurationMS: item.Metadata.DurationMS,
				CapturedAt: item.Metadata.CapturedAt, IndexState: item.Metadata.IndexState,
				HasThumbnail: item.Metadata.HasThumbnail,
			}) || !ownerGallerySafeAssetKind(item.AssetKind) {
			return false
		}
		seen[n.ID] = true
	}
	return true
}

func ProjectOwnerGalleryAlbums(albums []MediaAlbum) ([]OwnerGalleryAlbum, error) {
	if len(albums) > 4096 {
		return nil, errors.New("Owner gallery albums exceed bounded inventory")
	}
	out := make([]OwnerGalleryAlbum, 0, len(albums))
	seen := make(map[string]bool, len(albums))
	for _, a := range albums {
		if !ValidOwnerGalleryAlbumID(a.ID) || seen[a.ID] ||
			(a.Kind != "folder" && a.Kind != "source" && a.Kind != "manual" &&
				a.Kind != "smart" && a.Kind != "imported") ||
			a.Name == "" || len(a.Name) > 512 || !utf8.ValidString(a.Name) ||
			a.ItemCount < 0 || uint64(a.ItemCount) > ownerGalleryMaxSafe ||
			a.AlbumFolderID > ownerGalleryMaxSafe || a.Revision > ownerGalleryMaxSafe ||
			(a.CoverNodeID != nil && (*a.CoverNodeID == 0 ||
				*a.CoverNodeID > ownerGalleryMaxSafe)) {
			return nil, errors.New("unsafe Owner gallery album")
		}
		seen[a.ID] = true
		out = append(out, OwnerGalleryAlbum{
			ID: a.ID, Kind: a.Kind, Name: a.Name,
			AlbumFolderID: a.AlbumFolderID, Revision: a.Revision,
			ItemCount: a.ItemCount, CoverNodeID: a.CoverNodeID,
			UpdatedAt: a.UpdatedAt,
		})
	}
	return out, nil
}

func ValidOwnerGalleryAlbums(albums []OwnerGalleryAlbum) bool {
	if albums == nil || len(albums) > 4096 {
		return false
	}
	seen := make(map[string]bool, len(albums))
	for _, a := range albums {
		if !ValidOwnerGalleryAlbumID(a.ID) || seen[a.ID] ||
			(a.Kind != "folder" && a.Kind != "source" && a.Kind != "manual" &&
				a.Kind != "smart" && a.Kind != "imported") ||
			a.Name == "" || len(a.Name) > 512 || !utf8.ValidString(a.Name) ||
			a.ItemCount < 0 || uint64(a.ItemCount) > ownerGalleryMaxSafe ||
			a.AlbumFolderID > ownerGalleryMaxSafe || a.Revision > ownerGalleryMaxSafe ||
			(a.CoverNodeID != nil && (*a.CoverNodeID == 0 ||
				*a.CoverNodeID > ownerGalleryMaxSafe)) {
			return false
		}
		seen[a.ID] = true
	}
	return true
}
