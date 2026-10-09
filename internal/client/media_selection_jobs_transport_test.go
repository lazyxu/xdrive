package client

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
)

func TestMediaSelectionJobClientAuthAndTransport(t *testing.T) {
	const token = "123e4567-e89b-12d3-a456-426614174000"
	const jobID = "223e4567-e89b-12d3-a456-426614174001"
	var requests []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer token" {
			t.Errorf("missing bearer: %q", got)
		}
		key := r.Method + " " + r.URL.Path
		requests = append(requests, key)
		w.Header().Set("Content-Type", "application/json")
		switch key {
		case "POST /api/v1/media/selection-snapshots/" + token + "/jobs":
			var in struct {
				Action   string `json:"action"`
				Favorite *bool  `json:"favorite"`
				Version  uint64 `json:"version"`
				Confirm  bool   `json:"confirm"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Error(err)
			}
			if in.Action != "favorite" || in.Favorite == nil || *in.Favorite || in.Version != 2 || !in.Confirm {
				t.Errorf("unconfirmed/malformed job: %+v", in)
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"` + jobID + `","action":"favorite","favorite":false,"status":"queued","total_items":230,"processed_items":0}`))
		case "GET /api/v1/media/selection-jobs/" + jobID:
			_, _ = w.Write([]byte(`{"id":"` + jobID + `","action":"favorite","favorite":false,"status":"partial","total_items":230,"processed_items":230,"failed_items":1}`))
		case "GET /api/v1/media/selection-jobs":
			_, _ = w.Write([]byte(`[{"id":"` + jobID + `","action":"favorite","status":"partial","failed_items":1}]`))
		case "POST /api/v1/media/selection-jobs/" + jobID + "/cancel":
			w.WriteHeader(http.StatusAccepted)
		case "POST /api/v1/media/selection-jobs/" + jobID + "/retry":
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"` + jobID + `","retry_of_id":"` + jobID + `","status":"queued","total_items":1}`))
		case "GET /api/v1/media/selection-jobs/" + jobID + "/failures":
			if got := r.URL.Query().Get("limit"); got != strconv.Itoa(100) {
				t.Errorf("page limit=%s", got)
			}
			_, _ = w.Write([]byte(`{"items":[{"node_id":42,"revision":9,"status":"failed","failure_code":"stale_revision"}],"total":1,"offset":0,"limit":100,"has_more":false}`))
		default:
			t.Errorf("unexpected job request %s", key)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	c := New(server.URL, "token")
	ctx := context.Background()
	job, err := c.MediaSubmitSelectionFavoriteJob(ctx, token, 2, false)
	if err != nil || job.TotalItems != 230 || job.ID != jobID {
		t.Fatalf("submit job=%+v err=%v", job, err)
	}
	if job, err = c.MediaGetSelectionJob(ctx, jobID); err != nil || job.Status != "partial" || job.FailedItems != 1 {
		t.Fatalf("get job=%+v err=%v", job, err)
	}
	jobs, err := c.MediaListSelectionJobs(ctx)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("list jobs=%+v err=%v", jobs, err)
	}
	if err := c.MediaCancelSelectionJob(ctx, jobID); err != nil {
		t.Fatal(err)
	}
	if job, err = c.MediaRetrySelectionJob(ctx, jobID); err != nil || job.TotalItems != 1 {
		t.Fatalf("retry job=%+v err=%v", job, err)
	}
	page, err := c.MediaSelectionJobFailures(ctx, jobID, 0, 100)
	if err != nil || len(page.Items) != 1 || page.Items[0].FailureCode != "stale_revision" {
		t.Fatalf("failures=%+v err=%v", page, err)
	}
	if len(requests) != 6 {
		t.Errorf("HTTP request count=%d want=6", len(requests))
	}
	if _, err := c.MediaSelectionJobFailures(ctx, jobID, 0, 201); err == nil {
		t.Fatal("oversized failure page accepted")
	}
}
