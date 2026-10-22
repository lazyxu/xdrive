package api

import (
	"fmt"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/gorm"
)

// Keep the B1-B facet and B1-C Owner Media Range on precisely the same
// trust predicate. A label is current only when all three GPS copies, both
// fingerprint copies, the Ready state and the active dataset version agree.
func mediaPlaceHierarchyTrustPredicate(version string) (string, []any) {
	return "ppl.resolver = ? AND ppl.resolver_version = ? AND ppl.input_fingerprint <> '' " +
			"AND ppl.input_fingerprint = pas.input_fingerprint " +
			"AND ppl.input_fingerprint = ('gps:' || encode(float8send(pm.latitude), 'hex') || ':' || encode(float8send(pm.longitude), 'hex')) " +
			"AND pas.analyzer_version = ? " +
			"AND pas.kind = ? AND pas.state = ? " +
			"AND ppl.latitude = pm.latitude AND ppl.longitude = pm.longitude " +
			"AND ppl.latitude = xd_media_metadata.latitude AND ppl.longitude = xd_media_metadata.longitude " +
			"AND ppl.distance_km IS NOT NULL AND ppl.distance_km >= 0 " +
			"AND " + mediaPlaceValidGPSPredicate +
			" AND xd_media_metadata.index_state = ?",
		[]any{
			photointelligence.GeoNamesResolverName, version,
			photointelligence.GeoNamesResolverName + "@" + version,
			meta.PhotoAnalysisKindPlaceLabel, meta.PhotoAnalysisStateReady,
			meta.MediaIndexStateReady,
		}
}

func mediaPlaceHierarchyIdentityPredicate(key mediaPlaceHierarchyKey) (string, []any, error) {
	if _, ok := parseMediaPlaceHierarchyKey(key.String()); !ok {
		return "", nil, fmt.Errorf("invalid stable place hierarchy key")
	}
	switch key.Level {
	case "country":
		return "ppl.country_code = ?", []any{key.Country}, nil
	case "region":
		return "ppl.country_code = ? AND ppl.region_code = ?", []any{key.Country, key.Region}, nil
	case "city":
		return "ppl.country_code = ? AND ppl.region_code = ? AND ppl.city_geo_name_id = ?",
			[]any{key.Country, key.Region, key.CityID}, nil
	default:
		return "", nil, fmt.Errorf("unsupported hierarchy level")
	}
}

func applyMediaPlaceHierarchyFilter(query *gorm.DB, key mediaPlaceHierarchyKey, datasetVersion string) *gorm.DB {
	// If the resolver was unloaded/replaced, labels are not a fallback source
	// of truth. Fail closed, yielding an empty Owner Range and Count.
	if datasetVersion == "" {
		return query.Where("1 = 0")
	}
	keySQL, keyArgs, err := mediaPlaceHierarchyIdentityPredicate(key)
	if err != nil {
		return query.Where("1 = 0")
	}
	trustSQL, trustArgs := mediaPlaceHierarchyTrustPredicate(datasetVersion)
	args := append(trustArgs, keyArgs...)
	return query.Where(
		"EXISTS (SELECT 1 FROM xd_photo_place_labels AS ppl "+
			"JOIN xd_photo_analysis_states AS pas ON pas.asset_id = ppl.asset_id "+
			"WHERE ppl.asset_id = pa.id AND "+trustSQL+" AND "+keySQL+")",
		args...,
	)
}
