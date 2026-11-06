package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestVerifyGitHubStableGate(t *testing.T) {
	const sha = "0123456789abcdef0123456789abcdef01234567"
	const other = "ffffffffffffffffffffffffffffffffffffffff"
	for _, tc := range []struct {
		name, tag, commit, branch, event, status, conclusion, gate, ocr string
		httpStatus                                                   int
		wantOK                                                       bool
	}{
		{name: "exact tag and full green GitHub CI", tag: "v1.2.3", commit: sha, branch: "v1.2.3", event: "push", status: "completed", conclusion: "success", gate: "success", ocr: "success", wantOK: true},
		{name: "GitHub tag targets another commit", tag: "v1.2.3", commit: other, branch: "v1.2.3", event: "push", status: "completed", conclusion: "success", gate: "success", ocr: "success"},
		{name: "green master CI is not stable tag CI", tag: "v1.2.3", commit: sha, branch: "master", event: "push", status: "completed", conclusion: "success", gate: "success", ocr: "success"},
		{name: "pending GitHub CI", tag: "v1.2.3", commit: sha, branch: "v1.2.3", event: "push", status: "in_progress", gate: "success", ocr: "success"},
		{name: "failed GitHub workflow", tag: "v1.2.3", commit: sha, branch: "v1.2.3", event: "push", status: "completed", conclusion: "failure", gate: "success", ocr: "success"},
		{name: "wrong workflow event", tag: "v1.2.3", commit: sha, branch: "v1.2.3", event: "pull_request", status: "completed", conclusion: "success", gate: "success", ocr: "success"},
		{name: "Final Gate failed", tag: "v1.2.3", commit: sha, branch: "v1.2.3", event: "push", status: "completed", conclusion: "success", gate: "failure", ocr: "success"},
		{name: "stable OCR smoke failed", tag: "v1.2.3", commit: sha, branch: "v1.2.3", event: "push", status: "completed", conclusion: "success", gate: "success", ocr: "failure"},
		{name: "required OCR smoke not present", tag: "v1.2.3", commit: sha, branch: "v1.2.3", event: "push", status: "completed", conclusion: "success", gate: "success", ocr: ""},
		{name: "GitHub API failure blocks promotion", tag: "v1.2.3", httpStatus: http.StatusForbidden},
		{name: "invalid tag", tag: "latest"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tc.httpStatus != 0 {
					http.Error(w, "unavailable", tc.httpStatus)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				var response any
				switch {
				case strings.HasPrefix(r.URL.Path, "/commits/"):
					response = map[string]any{"sha": tc.commit}
				case strings.HasPrefix(r.URL.Path, "/actions/workflows/ci.yml/runs"):
					if r.URL.Query().Get("head_sha") != sha || r.URL.Query().Get("event") != "push" {
						t.Errorf("workflow query must be exact SHA and push event: %s", r.URL.RawQuery)
					}
					response = map[string]any{"total_count": 1, "workflow_runs": []any{
						map[string]any{"id": 42, "head_sha": sha, "head_branch": tc.branch, "event": tc.event, "status": tc.status, "conclusion": tc.conclusion},
					}}
				case strings.HasPrefix(r.URL.Path, "/actions/runs/42/jobs"):
					jobs := []any{map[string]any{"name": "final-gate", "status": "completed", "conclusion": tc.gate}}
					if tc.ocr != "" {
						jobs = append(jobs, map[string]any{"name": "photo-ocr-master-smoke", "status": "completed", "conclusion": tc.ocr})
					}
					response = map[string]any{"total_count": len(jobs), "jobs": jobs}
				default:
					http.NotFound(w, r)
					return
				}
				if err := json.NewEncoder(w).Encode(response); err != nil {
					t.Errorf("encode: %v", err)
				}
			}))
			defer srv.Close()
			api := githubReadAPI{client: &http.Client{Timeout: 2 * time.Second}, base: srv.URL}
			err := verifyGitHubStableGate(context.Background(), api, tc.tag, sha)
			if (err == nil) != tc.wantOK {
				t.Fatalf("verification error=%v, wantOK=%t", err, tc.wantOK)
			}
		})
	}
}

func TestVerifyGitHubStableGateRejectsSHAAndUnboundedJobs(t *testing.T) {
	api := githubReadAPI{client: &http.Client{Timeout: time.Second}, base: "http://127.0.0.1:1"}
	for _, sha := range []string{"", "not-a-commit", strings.Repeat("a", 39), strings.Repeat("z", 40)} {
		if err := verifyGitHubStableGate(context.Background(), api, "v1.2.3", sha); err == nil {
			t.Fatalf("accepted invalid exact SHA %q", sha)
		}
	}
}
