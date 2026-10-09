package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDesktopIPCMediaSelectionJobsValidateInputs(t *testing.T) {
	valid := "123e4567-e89b-12d3-a456-426614174000"
	tests := []struct {
		name   string
		method string
		path   string
		body   string
		want   int
	}{
		{"submit bad token", http.MethodPost, "/v1/media/selection-snapshot/job?token=bad", `{"version":1,"favorite":true,"confirm":true}`, http.StatusBadRequest},
		{"submit bad version", http.MethodPost, "/v1/media/selection-snapshot/job?token=" + valid, `{"version":0,"favorite":true,"confirm":true}`, http.StatusBadRequest},
		{"submit missing favorite", http.MethodPost, "/v1/media/selection-snapshot/job?token=" + valid, `{"version":1,"confirm":true}`, http.StatusBadRequest},
		{"submit unconfirmed", http.MethodPost, "/v1/media/selection-snapshot/job?token=" + valid, `{"version":1,"favorite":false,"confirm":false}`, http.StatusBadRequest},
		{"get invalid id", http.MethodGet, "/v1/media/selection-job?id=bad", "", http.StatusBadRequest},
		{"cancel invalid id", http.MethodPost, "/v1/media/selection-job/cancel?id=bad", "", http.StatusBadRequest},
		{"retry invalid id", http.MethodPost, "/v1/media/selection-job/retry?id=bad", "", http.StatusBadRequest},
		{"failure invalid id", http.MethodGet, "/v1/media/selection-job/failures?id=bad", "", http.StatusBadRequest},
		{"failure bad page", http.MethodGet, "/v1/media/selection-job/failures?id=" + valid + "&limit=201", "", http.StatusBadRequest},
		{"legacy valid submit", http.MethodPost, "/v1/media/selection-snapshot/job?token=" + valid, `{"version":1,"favorite":false,"confirm":true}`, http.StatusNotImplemented},
		{"legacy valid list", http.MethodGet, "/v1/media/selection-jobs", "", http.StatusNotImplemented},
		{"legacy valid get", http.MethodGet, "/v1/media/selection-job?id=" + valid, "", http.StatusNotImplemented},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			h := &desktopIPCHandler{}
			switch tc.name {
			case "legacy valid list":
				h.mediaListSelectionJobs(rec, req)
			default:
				switch {
				case strings.Contains(tc.path, "/selection-snapshot/job"):
					h.mediaSubmitSelectionFavoriteJob(rec, req)
				case strings.Contains(tc.path, "/failures"):
					h.mediaSelectionJobFailures(rec, req)
				case strings.Contains(tc.path, "/cancel"):
					h.mediaCancelSelectionJob(rec, req)
				case strings.Contains(tc.path, "/retry"):
					h.mediaRetrySelectionJob(rec, req)
				default:
					h.mediaGetSelectionJob(rec, req)
				}
			}
			if rec.Code != tc.want {
				t.Fatalf("%s status=%d want=%d body=%s", tc.name, rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}
