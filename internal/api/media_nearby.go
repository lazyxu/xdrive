package api

import (
	"github.com/lazyxu/xdrive/internal/geoquery"
	"gorm.io/gorm"
)

// A4 uses the EXISTING Owner-authenticated /media/items?range=true API:
// same sparse Count/Anchor/Viewer, no independent nearby media collection.
func applyMediaGeoSelection(query *gorm.DB, selection *geoquery.Selection) *gorm.DB {
	if selection == nil {
		return query
	}
	query = query.Where(mediaPlaceValidGPSPredicate)
	if selection.BBox != nil {
		b := selection.BBox
		query = query.Where(
			"xd_media_metadata.latitude >= ? AND xd_media_metadata.latitude <= ?",
			b.South, b.North,
		)
		if b.West < b.East {
			return query.Where(
				"xd_media_metadata.longitude >= ? AND xd_media_metadata.longitude <= ?",
				b.West, b.East,
			)
		}
		return query.Where(
			"(xd_media_metadata.longitude >= ? OR xd_media_metadata.longitude <= ?)",
			b.West, b.East,
		)
	}
	if selection.Nearby == nil {
		return query
	}
	n := selection.Nearby
	south, north, west, east, allLongitudes := n.RadiusBounds()
	query = query.Where(
		"xd_media_metadata.latitude >= ? AND xd_media_metadata.latitude <= ?",
		south, north,
	)
	if !allLongitudes {
		if west < east {
			query = query.Where(
				"xd_media_metadata.longitude >= ? AND xd_media_metadata.longitude <= ?",
				west, east,
			)
		} else {
			query = query.Where(
				"(xd_media_metadata.longitude >= ? OR xd_media_metadata.longitude <= ?)",
				west, east,
			)
		}
	}
	// Exact WGS84 great-circle distance (metres), never Place grid center.
	const distanceSQL = "(2 * 6371008.8 * ASIN(LEAST(1.0, SQRT(" +
		"POWER(SIN(RADIANS(xd_media_metadata.latitude - ?) / 2), 2) + " +
		"COS(RADIANS(?)) * COS(RADIANS(xd_media_metadata.latitude)) * " +
		"POWER(SIN(RADIANS(xd_media_metadata.longitude - ?) / 2), 2)" +
		")))) <= ?"
	return query.Where(distanceSQL, n.Latitude, n.Latitude, n.Longitude, n.RadiusKM*1000)
}
