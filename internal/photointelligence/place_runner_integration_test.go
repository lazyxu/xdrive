package photointelligence

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type fakePlaceResolver struct {
	version string
	calls   int
}

func (r *fakePlaceResolver) Name() string {
	return "fake-place"
}

func (r *fakePlaceResolver) Version() string {
	return r.version
}

func (r *fakePlaceResolver) Resolve(
	latitude, longitude float64,
) (PlaceLabel, bool, error) {
	r.calls++
	if latitude < 0 {
		return PlaceLabel{}, false, nil
	}
	name := "First City"
	cityID := int64(1880252)
	distanceKM := 1.25
	if longitude >= 104 {
		name = "Second City"
		cityID = 1796236
		distanceKM = 3.75
	}
	return PlaceLabel{
		CountryCode:   "SG",
		Country:       "Singapore",
		RegionCode:    "00",
		Region:        "Singapore",
		CityGeoNameID: cityID,
		City:          name,
		Locality:      name,
		Formatted:     name,
		DistanceKM:    distanceKM,
	}, true, nil
}

func TestPlaceRunnerPersistsAndInvalidatesDerivedLabels(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "photo_place_runner_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{},
		&meta.Node{},
		&meta.PhotoAsset{},
		&meta.PhotoMetadata{},
		&meta.PhotoAnalysisState{},
		&meta.PhotoPlaceLabel{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username:       "place-runner-owner",
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{
		Name:     "",
		Type:     meta.NodeTypeDir,
		OwnerID:  owner.ID,
		Revision: 1,
	}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	node := meta.Node{
		ParentID: &root.ID,
		Name:     "photo.jpg",
		Type:     meta.NodeTypeFile,
		OwnerID:  owner.ID,
		Revision: 1,
	}
	if err := db.Create(&node).Error; err != nil {
		t.Fatal(err)
	}
	asset := meta.PhotoAsset{
		OwnerID:       owner.ID,
		PrimaryNodeID: node.ID,
		Kind:          meta.PhotoAssetKindImage,
		EvidenceKey:   "node:photo",
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}

	now := time.Date(2026, 10, 5, 10, 0, 0, 0, time.UTC)
	latitude := 1.3521
	longitude := 103.8198
	metadata := meta.PhotoMetadata{
		AssetID:   asset.ID,
		MediaKind: meta.MediaKindImage,
		Latitude:  &latitude,
		Longitude: &longitude,
		CreatedAt: now.Add(-time.Minute),
		UpdatedAt: now.Add(-time.Minute),
	}
	if err := db.Create(&metadata).Error; err != nil {
		t.Fatal(err)
	}

	resolver := &fakePlaceResolver{version: "v1"}
	current := now
	runner := &PlaceRunner{
		DB:       db,
		Resolver: resolver,
		Now:      func() time.Time { return current },
	}
	processed, err := runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 || resolver.calls != 1 {
		t.Fatalf("processed=%d calls=%d", processed, resolver.calls)
	}

	var label meta.PhotoPlaceLabel
	if err := db.First(&label, "asset_id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if label.Formatted != "First City" ||
		label.Resolver != resolver.Name() ||
		label.ResolverVersion != "v1" ||
		label.RegionCode != "00" || label.CityGeoNameID != 1880252 ||
		label.DistanceKM == nil || *label.DistanceKM != 1.25 ||
		label.InputFingerprint != placeInputFingerprint(latitude, longitude) {
		t.Fatalf("label=%+v", label)
	}
	var state meta.PhotoAnalysisState
	if err := db.First(
		&state,
		"asset_id = ? AND kind = ?",
		asset.ID,
		meta.PhotoAnalysisKindPlaceLabel,
	).Error; err != nil {
		t.Fatal(err)
	}
	if state.State != meta.PhotoAnalysisStateReady ||
		state.Attempt != 1 ||
		state.AnalyzerVersion != "fake-place@v1" {
		t.Fatalf("state=%+v", state)
	}

	processed, err = runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 0 || resolver.calls != 1 {
		t.Fatalf("unchanged processed=%d calls=%d", processed, resolver.calls)
	}

	current = current.Add(2 * time.Minute)
	longitude = 104.1
	if err := db.Model(&meta.PhotoMetadata{}).
		Where("asset_id = ?", asset.ID).
		Updates(map[string]any{
			"longitude":  longitude,
			"updated_at": current.Add(-time.Minute),
		}).Error; err != nil {
		t.Fatal(err)
	}
	processed, err = runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 || resolver.calls != 2 {
		t.Fatalf("changed GPS processed=%d calls=%d", processed, resolver.calls)
	}
	if err := db.First(&label, "asset_id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if label.Formatted != "Second City" || label.Longitude != longitude {
		t.Fatalf("updated label=%+v", label)
	}

	current = current.Add(time.Minute)
	resolver.version = "v2"
	processed, err = runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 || resolver.calls != 3 {
		t.Fatalf("resolver upgrade processed=%d calls=%d", processed, resolver.calls)
	}
	if err := db.First(&state, "asset_id = ? AND kind = ?", asset.ID, meta.PhotoAnalysisKindPlaceLabel).Error; err != nil {
		t.Fatal(err)
	}
	if state.AnalyzerVersion != "fake-place@v2" || state.Attempt != 3 {
		t.Fatalf("upgraded state=%+v", state)
	}
	if err := db.Model(&meta.PhotoPlaceLabel{}).
		Where("asset_id = ?", asset.ID).
		Update("input_fingerprint", "").Error; err != nil {
		t.Fatal(err)
	}
	processed, err = runner.RunBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if processed != 1 || resolver.calls != 4 {
		t.Fatalf("legacy backfill processed=%d calls=%d", processed, resolver.calls)
	}
	if err := db.First(&label, "asset_id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if label.InputFingerprint != placeInputFingerprint(latitude, longitude) ||
		label.CityGeoNameID != 1796236 || label.DistanceKM == nil || *label.DistanceKM != 3.75 {
		t.Fatalf("backfilled label=%+v", label)
	}

	// The original B1 Facet/Range trust predicate hides these stale rows.
	// Verify their Owner is actually scheduled, each row heals once, and an
	// already-correct label does not keep consuming the analysis queue.
	for _, regression := range []struct {
		name    string
		corrupt func(*testing.T)
	}{
		{"analysis fingerprint mismatch", func(t *testing.T) {
			t.Helper()
			if err := db.Model(&meta.PhotoAnalysisState{}).
				Where("asset_id = ? AND kind = ?", asset.ID, meta.PhotoAnalysisKindPlaceLabel).
				Update("input_fingerprint", "gps:old-analysis").Error; err != nil {
				t.Fatal(err)
			}
		}},
		{"label fingerprint mismatch", func(t *testing.T) {
			t.Helper()
			if err := db.Model(&meta.PhotoPlaceLabel{}).
				Where("asset_id = ?", asset.ID).
				Update("input_fingerprint", "gps:old-label").Error; err != nil {
				t.Fatal(err)
			}
		}},
		{"both fingerprints match each other but not current GPS", func(t *testing.T) {
			t.Helper()
			outdated := placeInputFingerprint(11.5, 109.1)
			if err := db.Model(&meta.PhotoAnalysisState{}).
				Where("asset_id = ? AND kind = ?", asset.ID, meta.PhotoAnalysisKindPlaceLabel).
				Update("input_fingerprint", outdated).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&meta.PhotoPlaceLabel{}).
				Where("asset_id = ?", asset.ID).
				Update("input_fingerprint", outdated).Error; err != nil {
				t.Fatal(err)
			}
		}},
		{"resolved legacy record has no distance", func(t *testing.T) {
			t.Helper()
			if err := db.Model(&meta.PhotoPlaceLabel{}).
				Where("asset_id = ?", asset.ID).
				Update("distance_km", nil).Error; err != nil {
				t.Fatal(err)
			}
		}},
		{"invalid negative persisted distance", func(t *testing.T) {
			t.Helper()
			if err := db.Model(&meta.PhotoPlaceLabel{}).
				Where("asset_id = ?", asset.ID).
				Update("distance_km", -3.0).Error; err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(regression.name, func(t *testing.T) {
			current = current.Add(time.Minute)
			regression.corrupt(t)
			owners, err := runner.CandidateOwnerIDs(context.Background(), 10)
			if err != nil || len(owners) != 1 || owners[0] != owner.ID {
				t.Fatalf("stale Owner absent from queue: owners=%v err=%v", owners, err)
			}
			previousCalls := resolver.calls
			processed, err := runner.RunOwnerBatch(context.Background(), owner.ID, 10)
			if err != nil || processed != 1 || resolver.calls != previousCalls+1 {
				t.Fatalf("stale provenance not repaired: processed=%d calls=%d err=%v",
					processed, resolver.calls, err)
			}
			var newLabel meta.PhotoPlaceLabel
			if err := db.First(&newLabel, "asset_id = ?", asset.ID).Error; err != nil {
				t.Fatal(err)
			}
			var newState meta.PhotoAnalysisState
			if err := db.First(&newState,
				"asset_id = ? AND kind = ?", asset.ID, meta.PhotoAnalysisKindPlaceLabel).Error; err != nil {
				t.Fatal(err)
			}
			fingerprint := placeInputFingerprint(latitude, longitude)
			if newState.State != meta.PhotoAnalysisStateReady ||
				newState.InputFingerprint != fingerprint ||
				newLabel.InputFingerprint != fingerprint ||
				newLabel.DistanceKM == nil || *newLabel.DistanceKM != 3.75 {
				t.Fatalf("stale provenance not healed: state=%+v label=%+v", newState, newLabel)
			}
			processed, err = runner.RunOwnerBatch(context.Background(), owner.ID, 10)
			if err != nil || processed != 0 || resolver.calls != previousCalls+1 {
				t.Fatalf("repaired label scheduled again: processed=%d calls=%d err=%v",
					processed, resolver.calls, err)
			}
		})
	}
	// No city can be resolved for a legitimate negative latitude in this
	// fixture. Its empty label/distance is a durable result, NOT a legacy
	// resolved row requiring endless attempts.
	current = current.Add(time.Minute)
	unresolvedLatitude := -1.2
	if err := db.Model(&meta.PhotoMetadata{}).
		Where("asset_id = ?", asset.ID).
		Update("latitude", unresolvedLatitude).Error; err != nil {
		t.Fatal(err)
	}
	processed, err = runner.RunOwnerBatch(context.Background(), owner.ID, 10)
	if err != nil || processed != 1 {
		t.Fatalf("unresolved GPS should be handled once: processed=%d err=%v", processed, err)
	}
	if err := db.First(&label, "asset_id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if label.Formatted != "" || label.CountryCode != "" || label.DistanceKM != nil ||
		label.InputFingerprint != placeInputFingerprint(unresolvedLatitude, longitude) {
		t.Fatalf("invalid unresolved GPS evidence: %+v", label)
	}
	processed, err = runner.RunOwnerBatch(context.Background(), owner.ID, 10)
	if err != nil || processed != 0 {
		t.Fatalf("unknown city must not cause retry storm: processed=%d err=%v", processed, err)
	}
}
