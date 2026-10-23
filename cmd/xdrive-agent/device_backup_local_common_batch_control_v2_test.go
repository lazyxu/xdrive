//go:build linux || windows

package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestLocalCommonBatchStopNeverConfusesSchedulerAndPhysicalCancellation(t *testing.T) {
	job := &localPushCommonBatchJob{progress: localBackupCommonBatchSummary{
		SourceID: 42, State: "running", Running: true,
	}}
	if job.requestStop("") || job.requestStop("delete") || job.stopAction() != "" {
		t.Fatal("non-enumerated command controlled the private runner")
	}
	if !job.requestStop("pause") || job.stopAction() != "pause" {
		t.Fatal("pause request did not reach file-boundary scheduler")
	}
	if progress := job.currentProgress(); !progress.Running ||
		progress.StopRequested != "pause" || progress.BackupComplete ||
		progress.RetirementSafe || progress.CurrentCASVerified {
		t.Fatalf("pause forged backup completion or physical cancellation: %+v", progress)
	}
	var group sync.WaitGroup
	for i := 0; i < 64; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			if i%2 == 0 {
				job.requestStop("pause")
			} else {
				job.requestStop("cancel")
			}
		}(i)
	}
	group.Wait()
	if job.stopAction() != "cancel" || job.currentProgress().StopRequested != "cancel" {
		t.Fatal("later pause overrode an existing cancel-scheduling request")
	}
	if state, ok := localCommonBatchControlState(errLocalCommonBatchPaused); !ok || state != "paused" {
		t.Fatal("pause not preserved as a non-successful Source state")
	}
	if state, ok := localCommonBatchControlState(errLocalCommonBatchCancelled); !ok || state != "cancelled" {
		t.Fatal("cancel scheduling was interpreted as physical cancel")
	}
	if _, ok := localCommonBatchControlState(errors.New("unverified SQL receipt")); ok {
		t.Fatal("an unverified remote operation cannot be reclassified as a user pause")
	}
}

func TestLocalCommonBatchControlIPCRequiresOneOwnedSourceAndEnumeratedAction(t *testing.T) {
	for _, action := range []string{"pause", "cancel"} {
		r := httptest.NewRequest(http.MethodPost,
			"http://localhost/v1/device-backups/local-common-batch/control?source_id=42&action="+action, nil)
		sourceID, got, ok := validLocalCommonBatchControlRequest(r)
		if !ok || sourceID != 42 || got != action {
			t.Fatalf("valid control denied: source=%d action=%q", sourceID, got)
		}
	}
	for _, url := range []string{
		"http://localhost/v1/device-backups/local-common-batch/control?source_id=42",
		"http://localhost/v1/device-backups/local-common-batch/control?source_id=42&action=delete",
		"http://localhost/v1/device-backups/local-common-batch/control?source_id=42&action=resume",
		"http://localhost/v1/device-backups/local-common-batch/control?source_id=42&action=Pause",
		"http://localhost/v1/device-backups/local-common-batch/control?source_id=42&action=pause&path=/private",
		"http://localhost/v1/device-backups/local-common-batch/control?source_id=42&source_id=43&action=cancel",
		"http://localhost/v1/device-backups/local-common-batch/control?source_id=0&action=pause",
		"http://localhost/v1/device-backups/local-common-batch/control?source_id=x&action=cancel",
	} {
		r := httptest.NewRequest(http.MethodPost, url, nil)
		if _, _, ok := validLocalCommonBatchControlRequest(r); ok {
			t.Fatalf("untrusted Desktop command accepted: %s", url)
		}
	}
	withBody := httptest.NewRequest(http.MethodPost,
		"http://localhost/v1/device-backups/local-common-batch/control?source_id=42&action=pause",
		strings.NewReader(`{"local_path":"/secret"}`))
	if _, _, ok := validLocalCommonBatchControlRequest(withBody); ok {
		t.Fatal("renderer payload was accepted as a native file selector")
	}
}
