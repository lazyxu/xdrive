package source

import (
	"testing"
	"time"
)

func TestAdvanceMirrorMissingEvidenceRequiresTwoFullScansAndGrace(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)

	count, since, eligible := AdvanceMirrorMissingEvidence(0, nil, now)
	if count != 1 || !since.Equal(now) || eligible {
		t.Fatalf("first missing evidence count=%d since=%s eligible=%t", count, since, eligible)
	}

	late := now.Add(MirrorMissingGrace + time.Minute)
	count, since, eligible = AdvanceMirrorMissingEvidence(count, &since, late)
	if count != 2 || !since.Equal(now) || !eligible {
		t.Fatalf("second mature evidence count=%d since=%s eligible=%t", count, since, eligible)
	}
}

func TestAdvanceMirrorMissingEvidenceKeepsWaitingWhenSecondScanIsEarly(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	since := now.Add(-time.Hour)

	count, gotSince, eligible := AdvanceMirrorMissingEvidence(1, &since, now)
	if count != 2 || !gotSince.Equal(since) || eligible {
		t.Fatalf("early second scan count=%d since=%s eligible=%t", count, gotSince, eligible)
	}

	later := now.Add(MirrorMissingGrace)
	count, gotSince, eligible = AdvanceMirrorMissingEvidence(count, &gotSince, later)
	if count != MirrorMissingRequiredFullScans || !gotSince.Equal(since) || !eligible {
		t.Fatalf("later scan count=%d since=%s eligible=%t", count, gotSince, eligible)
	}
}

func TestAdvanceMirrorMissingEvidenceFailsClosedOnFutureClock(t *testing.T) {
	now := time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)
	future := now.Add(48 * time.Hour)

	count, since, eligible := AdvanceMirrorMissingEvidence(20, &future, now)
	if count != MirrorMissingRequiredFullScans || !since.Equal(now) || eligible {
		t.Fatalf("future clock evidence count=%d since=%s eligible=%t", count, since, eligible)
	}
}
