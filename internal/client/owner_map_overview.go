package client

import (
	"errors"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
)

// OwnerMapOverview is an authenticated, bounded *WGS84 distribution* rather
// than an SDK map or a photo-access credential. Aggregated representatives
// are never accepted as canonical Place selectors.
const OwnerMapMaxRepresentatives = 64

type OwnerMapRepresentative struct {
	ID              string  `json:"id"`
	Name            string  `json:"name"`
	Latitude        float64 `json:"latitude"`
	Longitude       float64 `json:"longitude"`
	SampleLatitude  float64 `json:"sample_latitude"`
	SampleLongitude float64 `json:"sample_longitude"`
	CoordinateKind  string  `json:"coordinate_kind"`
	ItemCount       int64   `json:"item_count"`
}
type OwnerMapOverview struct {
	Items           []OwnerMapRepresentative `json:"items"`
	TotalPhotoCount int64                    `json:"total_photo_count"`
	Aggregated      bool                     `json:"aggregated"`
}

func ValidOwnerMapBounds(b MediaPlacesViewportBounds) bool {
	for _, n := range []float64{b.West, b.South, b.East, b.North} {
		if math.IsNaN(n) || math.IsInf(n, 0) {
			return false
		}
	}
	return b.West >= -180 && b.West <= 180 && b.East >= -180 && b.East <= 180 &&
		b.South >= -90 && b.North <= 90 && b.South < b.North && b.West != b.East
}

// Parse a fixed selector at every HTTP boundary. Reject duplicate, unknown,
// noncanonical, nonfinite and non-viewport values before contacting Server.
func ParseOwnerMapBoundsQuery(raw string) (MediaPlacesViewportBounds, error) {
	var b MediaPlacesViewportBounds
	q, err := url.ParseQuery(raw)
	if err != nil || len(q) != 4 {
		return b, errors.New("invalid Owner map selector")
	}
	numbers := []*float64{&b.West, &b.South, &b.East, &b.North}
	for i, key := range []string{"west", "south", "east", "north"} {
		v := q[key]
		if len(v) != 1 || len(v[0]) == 0 || len(v[0]) > 32 {
			return MediaPlacesViewportBounds{}, errors.New("invalid Owner map coordinate")
		}
		n, e := strconv.ParseFloat(v[0], 64)
		if e != nil || math.IsNaN(n) || math.IsInf(n, 0) ||
			strconv.FormatFloat(n, 'f', -1, 64) != v[0] {
			return MediaPlacesViewportBounds{}, errors.New("invalid Owner map coordinate")
		}
		*numbers[i] = n
	}
	if !ValidOwnerMapBounds(b) {
		return MediaPlacesViewportBounds{}, errors.New("invalid Owner map bounds")
	}
	return b, nil
}
func OwnerMapBoundsQuery(b MediaPlacesViewportBounds) string {
	q := url.Values{}
	for k, n := range map[string]float64{"west": b.West, "south": b.South, "east": b.East, "north": b.North} {
		q.Set(k, strconv.FormatFloat(n, 'f', -1, 64))
	}
	return q.Encode()
}

func ownerMapContains(b MediaPlacesViewportBounds, lat, lon float64) bool {
	const eps = 1e-7
	if lat < b.South-eps || lat > b.North+eps {
		return false
	}
	if b.West < b.East {
		return lon >= b.West-eps && lon <= b.East+eps
	}
	return lon >= b.West-eps || lon <= b.East+eps
}
func ValidOwnerMapOverview(page OwnerMapOverview, bounds MediaPlacesViewportBounds) bool {
	if !ValidOwnerMapBounds(bounds) || page.Items == nil ||
		len(page.Items) > OwnerMapMaxRepresentatives ||
		page.TotalPhotoCount < 0 || uint64(page.TotalPhotoCount) > ownerGalleryMaxSafe {
		return false
	}
	var count int64
	seen := make(map[string]bool, len(page.Items))
	for i, item := range page.Items {
		if item.ItemCount < 1 || uint64(item.ItemCount) > ownerGalleryMaxSafe ||
			count > int64(ownerGalleryMaxSafe)-item.ItemCount ||
			math.IsNaN(item.SampleLatitude) || math.IsInf(item.SampleLatitude, 0) ||
			math.IsNaN(item.SampleLongitude) || math.IsInf(item.SampleLongitude, 0) ||
			math.Abs(item.SampleLatitude) > 90 || math.Abs(item.SampleLongitude) > 180 ||
			item.Latitude != item.SampleLatitude || item.Longitude != item.SampleLongitude ||
			!ownerMapContains(bounds, item.SampleLatitude, item.SampleLongitude) ||
			seen[item.ID] {
			return false
		}
		if page.Aggregated {
			if item.ID != "map-region:"+strconv.Itoa(i+1) ||
				item.Name != fmt.Sprintf("照片区域 %d", i+1) ||
				item.CoordinateKind != "map_region_sample" {
				return false
			}
		} else if !ValidOwnerPlaceID(item.ID) ||
			item.CoordinateKind != "grid_cell_center" ||
			!validOwnerPlace(OwnerPlace{ID: item.ID, Name: item.Name,
				Latitude: item.Latitude, Longitude: item.Longitude,
				SampleLatitude: item.SampleLatitude, SampleLongitude: item.SampleLongitude,
				CoordinateKind: item.CoordinateKind, ItemCount: item.ItemCount}) {
			return false
		}
		seen[item.ID] = true
		count += item.ItemCount
	}
	return count == page.TotalPhotoCount
}

func ProjectOwnerMapOverview(raw MediaPlacesMapOverview,
	bounds MediaPlacesViewportBounds) (OwnerMapOverview, error) {
	if !ValidOwnerMapBounds(bounds) || raw.Items == nil ||
		len(raw.Items) > OwnerMapMaxRepresentatives {
		return OwnerMapOverview{}, errors.New("invalid bounded Owner map response")
	}
	output := OwnerMapOverview{Items: make([]OwnerMapRepresentative, 0, len(raw.Items)),
		TotalPhotoCount: raw.TotalPhotoCount, Aggregated: raw.Aggregated}
	for i, item := range raw.Items {
		if item.ItemCount < 1 ||
			item.CoordinateKind != (map[bool]string{true: "map_region_sample", false: "grid_cell_center"})[raw.Aggregated] {
			return OwnerMapOverview{}, errors.New("unexpected Owner map representative")
		}
		projected := OwnerMapRepresentative{
			ID: item.ID, Name: item.Name,
			Latitude: item.SampleLatitude, Longitude: item.SampleLongitude,
			SampleLatitude: item.SampleLatitude, SampleLongitude: item.SampleLongitude,
			CoordinateKind: item.CoordinateKind, ItemCount: item.ItemCount,
		}
		if raw.Aggregated {
			// The Server's synthetic region identity cannot ever be reused
			// as an exact place, a photo Range or a stable navigation token.
			projected.ID = "map-region:" + strconv.Itoa(i+1)
			projected.Name = fmt.Sprintf("照片区域 %d", i+1)
		} else if !strings.HasPrefix(item.ID, "place:") {
			return OwnerMapOverview{}, errors.New("noncanonical exact Owner place")
		}
		output.Items = append(output.Items, projected)
	}
	if !ValidOwnerMapOverview(output, bounds) {
		return OwnerMapOverview{}, errors.New("invalid Owner map projection")
	}
	return output, nil
}
