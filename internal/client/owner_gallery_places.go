package client

import (
	"errors"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// This is a narrow read-only projection of existing Owner-indexed GPS place
// facets. It is NOT a third-party map SDK grant or original EXIF/GPS export.
const OwnerPlacesPageLimit = 48

type OwnerPlace struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Latitude        float64 `json:"latitude"`
	Longitude       float64 `json:"longitude"`
	SampleLatitude  float64 `json:"sample_latitude"`
	SampleLongitude float64 `json:"sample_longitude"`
	CoordinateKind  string  `json:"coordinate_kind"`
	ItemCount       int64   `json:"item_count"`
	CoverNodeID     *uint64 `json:"cover_node_id,omitempty"`
}
type OwnerPlacesPage struct {
	Items      []OwnerPlace `json:"items"`
	TotalCount int64        `json:"total_count"`
	Offset     int          `json:"offset"`
	Limit      int          `json:"limit"`
	HasMore    bool         `json:"has_more"`
}
func ValidOwnerPlaceID(id string) bool {
	if len(id) < 9 || len(id) > 64 { return false }
	parts := strings.Split(id, ":")
	if len(parts) != 3 || parts[0] != "place" { return false }
	lat, e1 := strconv.Atoi(parts[1])
	lon, e2 := strconv.Atoi(parts[2])
	return e1 == nil && e2 == nil && lat >= -9000 && lat <= 9000 &&
		lon >= -18000 && lon <= 18000 &&
		strconv.Itoa(lat) == parts[1] && strconv.Itoa(lon) == parts[2]
}
func ValidOwnerPlacesWindow(limit, offset int) bool {
	return limit >= 1 && limit <= OwnerPlacesPageLimit &&
		offset >= 0 && offset <= OwnerGalleryMaxOffset
}
func validOwnerPlace(item OwnerPlace) bool {
	if !ValidOwnerPlaceID(item.ID) || item.Name == "" || len(item.Name) > 512 ||
		!utf8.ValidString(item.Name) || item.ItemCount < 1 ||
		uint64(item.ItemCount) > ownerGalleryMaxSafe ||
		(item.CoordinateKind != "grid_cell_center" &&
		 item.CoordinateKind != "map_region_sample") ||
		(item.CoverNodeID != nil && (*item.CoverNodeID == 0 || *item.CoverNodeID > ownerGalleryMaxSafe)) {
		return false
	}
	for _, c := range item.Name { if c == 0 || c == '\r' || c == '\n' { return false } }
	coordinates := []float64{item.Latitude, item.SampleLatitude, item.Longitude, item.SampleLongitude}
	for _, v := range coordinates { if math.IsNaN(v) || math.IsInf(v, 0) { return false } }
	return math.Abs(item.Latitude) <= 90 && math.Abs(item.SampleLatitude) <= 90 &&
		math.Abs(item.Longitude) <= 180 && math.Abs(item.SampleLongitude) <= 180
}
func ValidOwnerPlacesPage(page OwnerPlacesPage, limit, offset int) bool {
	if !ValidOwnerPlacesWindow(limit, offset) || page.Offset != offset ||
		page.Limit != limit || page.TotalCount < 0 || uint64(page.TotalCount) > ownerGalleryMaxSafe ||
		page.Items == nil || len(page.Items) > limit ||
		(len(page.Items) == 0 && int64(offset) < page.TotalCount) ||
		int64(offset)+int64(len(page.Items)) > page.TotalCount && len(page.Items) > 0 ||
		page.HasMore != (int64(offset)+int64(len(page.Items)) < page.TotalCount) {
		return false
	}
	seen := make(map[string]bool, len(page.Items))
	for _, item := range page.Items {
		if !validOwnerPlace(item) || seen[item.ID] { return false }
		seen[item.ID] = true
	}
	return true
}
func ProjectOwnerPlacesPage(raw MediaPlacesPage, limit, offset int) (OwnerPlacesPage, error) {
	page := OwnerPlacesPage{
		Items: make([]OwnerPlace, 0, len(raw.Items)),
		TotalCount: raw.TotalCount, Offset: raw.Offset, Limit: raw.Limit,
		HasMore: raw.HasMore,
	}
	for _, item := range raw.Items {
		page.Items = append(page.Items, OwnerPlace{
			ID: item.ID, Name: item.Name, Latitude: item.Latitude,
			Longitude: item.Longitude, SampleLatitude: item.SampleLatitude,
			SampleLongitude: item.SampleLongitude, CoordinateKind: item.CoordinateKind,
			ItemCount: item.ItemCount, CoverNodeID: item.CoverNodeID,
		})
	}
	if !ValidOwnerPlacesPage(page, limit, offset) {
		return OwnerPlacesPage{}, errors.New("invalid Owner Places projection")
	}
	return page, nil
}
