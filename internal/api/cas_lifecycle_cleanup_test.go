package api

import (
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/storage"
)

// CAS lifecycle coordination files are durable synchronization metadata,
// never aged upload temps, staging payloads or reclaimable admin cache.
func TestCASLifecycleLocksAreNeverAdminCacheCleanupTargets(t *testing.T) {
	ancient := time.Now().Add(-365 * 24 * time.Hour)
	keys := []string{
		storage.CASLifecycleLockDir + "/00.lock",
		storage.CASLifecycleLockDir + "/ff.lock",
	}
	for _, key := range keys {
		if category := storageInventoryCategory(key); category == "write_temp" ||
			category == "readiness_temp" || category == "upload_staging" ||
			category == "cas" {
			t.Fatalf("CAS lifecycle coordination key misclassified: %q as %s", key, category)
		}
		for _, kind := range []string{
			storageCleanupAll, storageCleanupTemp, storageCleanupStaging,
			storageCleanupThumbnail, storageCleanupVideoPoster, storageCleanupAnalysis,
		} {
			if storageCleanupMatches(kind, storage.ManagedFile{
				Key: key, ModifiedAt: ancient,
			}, time.Now()) {
				t.Fatalf("CAS lifecycle lock %q would be removed by %s cleanup", key, kind)
			}
		}
	}
}
