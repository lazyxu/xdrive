package photointelligence

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGeoNamesResolverLoadsAndResolvesNearestPlace(t *testing.T) {
	dir := t.TempDir()
	writeGeoNamesFixture(t, dir)

	resolver, err := LoadGeoNamesResolver(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	if resolver.Name() != GeoNamesResolverName {
		t.Fatalf("name=%q", resolver.Name())
	}
	if resolver.Version() == "" {
		t.Fatal("resolver version is empty")
	}

	label, found, err := resolver.Resolve(1.3521, 103.8198)
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("Singapore was not resolved")
	}
	if label.City != "Singapore" || label.CountryCode != "SG" ||
		label.Formatted != "Singapore" {
		t.Fatalf("label=%+v", label)
	}
	if label.DistanceKM <= 0 || label.DistanceKM > 20 {
		t.Fatalf("distance=%f", label.DistanceKM)
	}

	label, found, err = resolver.Resolve(31.2304, 121.4737)
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("Shanghai was not resolved")
	}
	if label.City != "Shanghai" || label.Country != "China" ||
		label.Formatted != "Shanghai, China" {
		t.Fatalf("label=%+v", label)
	}
}

func TestGeoNamesResolverHonorsMaximumDistance(t *testing.T) {
	dir := t.TempDir()
	writeGeoNamesFixture(t, dir)

	resolver, err := LoadGeoNamesResolver(dir, 5)
	if err != nil {
		t.Fatal(err)
	}
	_, found, err := resolver.Resolve(0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if found {
		t.Fatal("unexpected far-away place match")
	}
}

func TestGeoNamesResolverVersionChangesWithDataset(t *testing.T) {
	dir := t.TempDir()
	writeGeoNamesFixture(t, dir)

	first, err := LoadGeoNamesResolver(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "cities500.txt")
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString(
		"9999999\tTestville\tTestville\t\t2.0\t104.0\tP\tPPL\tSG\t\t00\t\t\t\t1000\t\t\tAsia/Singapore\t2026-10-05\n",
	); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	second, err := LoadGeoNamesResolver(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	if first.Version() == second.Version() {
		t.Fatal("resolver version did not change with dataset contents")
	}

	differentDistance, err := LoadGeoNamesResolver(dir, 50)
	if err != nil {
		t.Fatal(err)
	}
	if second.Version() == differentDistance.Version() {
		t.Fatal("resolver version did not change with maximum distance")
	}
}

func writeGeoNamesFixture(t *testing.T, dir string) {
	t.Helper()
	files := map[string]string{
		"countryInfo.txt": strings.Join([]string{
			"#ISO\tISO3\tISO-Numeric\tfips\tCountry",
			"SG\tSGP\t702\tSN\tSingapore",
			"CN\tCHN\t156\tCH\tChina",
		}, "\n") + "\n",
		"admin1CodesASCII.txt": strings.Join([]string{
			"SG.00\tSingapore\tSingapore\t1880251",
			"CN.23\tShanghai\tShanghai\t1796231",
		}, "\n") + "\n",
		"cities500.txt": strings.Join([]string{
			"1880252\tSingapore\tSingapore\t\t1.28967\t103.85007\tP\tPPLC\tSG\t\t00\t\t\t\t5638700\t\t\tAsia/Singapore\t2026-10-05",
			"1796236\tShanghai\tShanghai\t\t31.22222\t121.45806\tP\tPPLA\tCN\t\t23\t\t\t\t24874500\t\t\tAsia/Shanghai\t2026-10-05",
		}, "\n") + "\n",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}
