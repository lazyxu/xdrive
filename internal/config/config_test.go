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

func TestLoadPhotoFaceConfig(t *testing.T) {
	t.Setenv("XD_JWT_SECRET", "test-secret")
	t.Setenv("XD_PHOTO_FACE_ANALYZER_SOCKET", "/run/xdrive/photo-face.sock")
	t.Setenv("XD_PHOTO_FACE_ANALYZER_TOKEN", "local-analyzer-token")
	t.Setenv("XD_PHOTO_FACE_PREVIEW_BASE_URL", "http://server:8080/")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PhotoFaceAnalyzerSocket != "/run/xdrive/photo-face.sock" {
		t.Fatalf("face analyzer socket=%q", cfg.PhotoFaceAnalyzerSocket)
	}
	if cfg.PhotoFaceAnalyzerToken != "local-analyzer-token" {
		t.Fatalf("face analyzer token=%q", cfg.PhotoFaceAnalyzerToken)
	}
	if cfg.PhotoFacePreviewBaseURL != "http://server:8080" {
		t.Fatalf("face preview base URL=%q", cfg.PhotoFacePreviewBaseURL)
	}
}

func TestLoadRequiresPhotoFacePreviewBaseURL(t *testing.T) {
	t.Setenv("XD_JWT_SECRET", "test-secret")
	t.Setenv("XD_PHOTO_FACE_ANALYZER_SOCKET", "/run/xdrive/photo-face.sock")
	if _, err := Load(); err == nil {
		t.Fatal("face analyzer socket without preview base URL was accepted")
	}
}

func TestLoadRejectsUnsafePhotoFacePreviewBaseURL(t *testing.T) {
	t.Setenv("XD_JWT_SECRET", "test-secret")
	for _, value := range []string{
		"file:///tmp/photo",
		"http://user:pass@server:8080",
		"http://server:8080/prefix",
		"http://server:8080?token=secret",
	} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("XD_PHOTO_FACE_PREVIEW_BASE_URL", value)
			if _, err := Load(); err == nil {
				t.Fatalf("unsafe face preview base URL %q was accepted", value)
			}
		})
	}
}

func TestLoadBaiduMapRequiresOptInWithoutBreakingCoreWhenAKMissing(t *testing.T) {
	t.Setenv("XD_JWT_SECRET", "test-secret")
	t.Setenv("XD_BAIDU_MAP_ENABLED", "")
	t.Setenv("XD_BAIDU_MAP_AK", "test-key")
	cfg, err := Load()
	if err != nil || cfg.BaiduMapEnabled {
		t.Fatalf("map must be disabled by default: cfg=%+v err=%v", cfg.BaiduMapEnabled, err)
	}
	t.Setenv("XD_BAIDU_MAP_ENABLED", "true")
	cfg, err = Load()
	if err != nil || !cfg.BaiduMapEnabled || cfg.BaiduMapAK != "test-key" {
		t.Fatalf("configured server AK should enable map: err=%v", err)
	}
	t.Setenv("XD_BAIDU_MAP_AK", "")
	cfg, err = Load()
	if err != nil || !cfg.BaiduMapEnabled || cfg.BaiduMapAK != "" {
		t.Fatalf("missing optional map AK must not disable Server startup: err=%v", err)
	}
	t.Setenv("XD_BAIDU_MAP_ENABLED", "nonsense")
	if _, err := Load(); err == nil {
		t.Fatal("invalid map opt-in flag was accepted")
	}
}
