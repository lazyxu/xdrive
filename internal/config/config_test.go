package config

import "testing"

func TestLoadPhotoPlaceConfig(t *testing.T) {
	t.Setenv("XD_JWT_SECRET", "test-secret")
	t.Setenv("XD_PHOTO_PLACE_GEONAMES_DIR", "/data/geonames")
	t.Setenv("XD_PHOTO_PLACE_MAX_DISTANCE_KM", "75.5")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PhotoPlaceGeoNamesDir != "/data/geonames" {
		t.Fatalf("GeoNames dir=%q", cfg.PhotoPlaceGeoNamesDir)
	}
	if cfg.PhotoPlaceMaxDistanceKM != 75.5 {
		t.Fatalf("max distance=%v", cfg.PhotoPlaceMaxDistanceKM)
	}
}

func TestLoadRejectsInvalidPhotoPlaceDistance(t *testing.T) {
	t.Setenv("XD_JWT_SECRET", "test-secret")
	t.Setenv("XD_PHOTO_PLACE_MAX_DISTANCE_KM", "0")
	if _, err := Load(); err == nil {
		t.Fatal("invalid photo place distance was accepted")
	}
}
