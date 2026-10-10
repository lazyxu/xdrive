package photointelligence

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReloadableGeoNamesSnapshotsPinVersionsAndResults(t *testing.T) {
	dir := t.TempDir()
	writeGeoNamesFixture(t, dir)
	first, err := LoadGeoNamesResolver(dir, 5)
	if err != nil {
		t.Fatal(err)
	}
	runtime := NewReloadablePlaceResolver(first)
	runner := &PlaceRunner{Resolver: runtime}
	oldBatch := runner.snapshotForBatch()
	oldVersion := oldBatch.Resolver.Version()
	if oldVersion == "" {
		t.Fatal("old snapshot must have a version")
	}

	file := filepath.Join(dir, "cities500.txt")
	f, err := os.OpenFile(file, os.O_APPEND|os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("9999999\tTestville\tTestville\t\t2.0\t104.0\tP\tPPL\tSG\t\t00\t\t\t\t1000\t\t\tAsia/Singapore\t2026-10-05\n"); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	second, err := LoadGeoNamesResolver(dir, 5)
	if err != nil {
		t.Fatal(err)
	}
	runtime.Swap(second)
	if runtime.Version() == oldVersion {
		t.Fatal("runtime did not publish the new dataset version")
	}
	if oldBatch.Resolver.Version() != oldVersion {
		t.Fatal("in-flight batch changed resolver version")
	}
	if newer := runner.snapshotForBatch(); newer.Resolver.Version() != second.Version() {
		t.Fatal("new batch did not pick up new dataset")
	}
	_, found, err := oldBatch.Resolver.Resolve(2, 104)
	if err != nil {
		t.Fatal(err)
	}
	if found {
		t.Fatal("old snapshot unexpectedly includes reloaded city")
	}
	_, found, err = runner.snapshotForBatch().Resolver.Resolve(2, 104)
	if err != nil || !found {
		t.Fatalf("new snapshot does not contain new city: found=%v error=%v", found, err)
	}
}

func TestReloadableGeoNamesInvalidCandidateDoesNotReplaceActive(t *testing.T) {
	dir := t.TempDir()
	writeGeoNamesFixture(t, dir)
	first, err := LoadGeoNamesResolver(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	runtime := NewReloadablePlaceResolver(first)
	if err := os.Remove(filepath.Join(dir, "cities500.txt")); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadGeoNamesResolver(dir, 100); err == nil {
		t.Fatal("broken candidate unexpectedly loaded")
	}
	if runtime.Version() != first.Version() {
		t.Fatal("failed candidate changed active resolver")
	}
}
