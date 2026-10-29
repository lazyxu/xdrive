package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/maintenance"
	"github.com/lazyxu/xdrive/internal/meta"
)

func TestStorageVerifyEvidenceContainsOnlyBoundedCategoryCounts(t *testing.T) {
	report := maintenance.VerifyReport{
		Mode:               maintenance.VerifyModeDeep,
		ReferencedFiles:    8,
		ReferencedVersions: 2,
		BlobFiles:          10,
		UniqueKeys:         9,
		HashedFiles:        9,
		HashedBytes:        1024,
		Missing:            []maintenance.MissingBlob{{StorageKey: "do-not-publish-key", NodeID: 42}},
		HashMismatches: []maintenance.HashMismatch{{
			StorageKey: "private/original", Expected: "secret-digest", Actual: "private-hash",
		}},
	}
	v, err := storageVerifyEvidenceFromReport(maintenance.VerifyModeDeep, report)
	if err != nil {
		t.Fatal(err)
	}
	if v.IssueCount != 2 || v.MissingObjects != 1 || v.HashMismatches != 1 ||
		v.HashedBytes != 1024 {
		t.Fatalf("incorrect actual category counts: %+v", v)
	}
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"do-not-publish-key", "private/original", "secret-digest", "private-hash", "node_id"} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("private file information leaked: %s", forbidden)
		}
	}
	if decoded := parseStorageVerifyEvidence(string(raw)); decoded == nil || decoded.IssueCount != 2 {
		t.Fatalf("bounded report cannot be read back: %+v", decoded)
	}
}

func TestStorageVerifyEvidenceRejectsIncorrectModeAndForgedEnvelope(t *testing.T) {
	if _, err := storageVerifyEvidenceFromReport(maintenance.VerifyModeFast,
		maintenance.VerifyReport{Mode: maintenance.VerifyModeDeep}); err == nil {
		t.Fatal("accepted report with incorrect verification mode")
	}
	if _, err := storageVerifyEvidenceFromReport(maintenance.VerifyModeFast,
		maintenance.VerifyReport{Mode: maintenance.VerifyModeFast, HashedFiles: 1}); err == nil {
		t.Fatal("fast mode falsely claimed SHA-256 hashing")
	}
	v, err := storageVerifyEvidenceFromReport(maintenance.VerifyModeFast,
		maintenance.VerifyReport{Mode: maintenance.VerifyModeFast})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(v)
	if parseStorageVerifyEvidence(string(raw)) == nil {
		t.Fatal("failed valid fast report")
	}
	if parseStorageVerifyEvidence(strings.TrimSuffix(string(raw), "}") + `,"storage_key":"/secret"}`) != nil {
		t.Fatal("accepted extra private field")
	}
	if parseStorageVerifyEvidence(strings.Repeat("A", storageVerifyEvidenceMaxBytes+1)) != nil {
		t.Fatal("accepted oversized evidence")
	}
	if parseStorageVerifyEvidence(string(raw)+"{}") != nil {
		t.Fatal("accepted trailing JSON")
	}
	v.IssueCount++
	if validStorageVerifyEvidence(v) {
		t.Fatal("accepted inconsistent sum")
	}
}

func TestStorageVerifyEvidencePersistsOnRealTaskAndIsAdminOnlyProjection(t *testing.T) {
	db := newSystemMaintenanceTaskTestDB(t)
	scheduler, ctx := newSystemMaintenanceTaskScheduler(t)
	runner := &immediateSystemMaintenanceStorageVerifyRunner{
		report: maintenance.VerifyReport{
			Mode:            maintenance.VerifyModeFast,
			ReferencedFiles: 7,
			Missing:         []maintenance.MissingBlob{{StorageKey: "/never-expose"}},
		},
	}
	server := &Server{
		DB:                             db,
		BackgroundScheduler:            scheduler,
		systemMaintenanceStorageVerify: runner,
	}
	run, err := server.requestSystemMaintenanceRun(ctx,
		meta.SystemMaintenanceKindStorageVerifyFast, background.InitiatorAdmin, 99)
	if err != nil {
		t.Fatal(err)
	}
	result := waitSystemMaintenanceRunStatus(t, db, run.ID, meta.SystemMaintenanceStatusIssues)
	if result.ReportJSON == "" {
		t.Fatal("missing persisted bounded evidence")
	}
	if strings.Contains(result.ReportJSON, "/never-expose") {
		t.Fatal("report exposed private storage key")
	}
	tasks, err := server.backgroundSystemMaintenanceTasks(ctx)
	if err != nil {
		t.Fatal(err)
	}
	task := backgroundTaskByID(tasks, systemMaintenanceTaskCenterID(meta.SystemMaintenanceKindStorageVerifyFast))
	if task == nil || task.StorageIntegrity == nil || task.StorageIntegrity.MissingObjects != 1 ||
		task.StorageIntegrity.Mode != "fast" {
		t.Fatalf("missing authentic admin task evidence: %+v", task)
	}
}
