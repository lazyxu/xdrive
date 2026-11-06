// A release-only GitLab runner must never promote an untested stable tag.
// This preflight checks the exact GitHub tag and its completed, successful
// GitHub Actions full Final Gate; it does not execute tests on GitLab.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const githubActionsAPI = "https://api.github.com/repos/lazyxu/xdrive"

var (
	stableTagPattern = regexp.MustCompile(`^v[0-9]+\.[0-9]+\.[0-9]+([+-][A-Za-z0-9.-]+)?$`)
	fullCommitPattern = regexp.MustCompile(`^[a-f0-9]{40}$`)
)

type githubReadAPI struct {
	client *http.Client
	base   string
	token  string
}

func (api githubReadAPI) get(ctx context.Context, resource string, into any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, api.base+resource, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "xdrive-gitlab-stable-gate")
	if api.token != "" {
		req.Header.Set("Authorization", "Bearer "+api.token)
	}
	response, err := api.client.Do(req)
	if err != nil {
		return fmt.Errorf("GitHub API request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("GitHub API returned HTTP %d for %s", response.StatusCode, resource)
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(into); err != nil {
		return fmt.Errorf("invalid GitHub API JSON for %s: %w", resource, err)
	}
	return nil
}

type githubWorkflowRun struct {
	ID         int64  `json:"id"`
	HeadSHA    string `json:"head_sha"`
	HeadBranch string `json:"head_branch"`
	Event      string `json:"event"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
}

type githubJob struct {
	Name       string `json:"name"`
	Status     string `json:"status"`
	Conclusion string `json:"conclusion"`
}

func successfulStableJobs(ctx context.Context, api githubReadAPI, runID int64) (bool, error) {
	required := map[string]bool{"final-gate": false, "photo-ocr-master-smoke": false}
	for page := 1; page <= 10; page++ {
		var response struct {
			TotalCount int         `json:"total_count"`
			Jobs       []githubJob `json:"jobs"`
		}
		resource := "/actions/runs/" + strconv.FormatInt(runID, 10) +
			"/jobs?per_page=100&page=" + strconv.Itoa(page)
		if err := api.get(ctx, resource, &response); err != nil {
			return false, err
		}
		for _, job := range response.Jobs {
			if _, known := required[job.Name]; known {
				if job.Status != "completed" || job.Conclusion != "success" {
					return false, nil
				}
				required[job.Name] = true
			}
		}
		if len(response.Jobs) < 100 {
			return required["final-gate"] && required["photo-ocr-master-smoke"], nil
		}
		if page*100 >= response.TotalCount {
			return required["final-gate"] && required["photo-ocr-master-smoke"], nil
		}
	}
	return false, errors.New("GitHub workflow job list exceeded bounded pagination")
}

func verifyGitHubStableGate(ctx context.Context, api githubReadAPI, tag, sha string) error {
	if !stableTagPattern.MatchString(tag) || !fullCommitPattern.MatchString(sha) {
		return errors.New("invalid stable tag or exact 40-character commit SHA")
	}
	var commit struct {
		SHA string `json:"sha"`
	}
	if err := api.get(ctx, "/commits/"+url.PathEscape(tag), &commit); err != nil {
		return err
	}
	if commit.SHA != sha {
		return fmt.Errorf("GitHub tag %s does not reference the exact GitLab commit %s", tag, sha)
	}

	// Tag CI is distinct from a master push with the same commit SHA. A green
	// master build alone cannot authorize publishing an untested v* tag.
	for page := 1; page <= 10; page++ {
		var response struct {
			TotalCount   int                 `json:"total_count"`
			WorkflowRuns []githubWorkflowRun `json:"workflow_runs"`
		}
		resource := "/actions/workflows/ci.yml/runs?event=push&head_sha=" +
			url.QueryEscape(sha) + "&per_page=100&page=" + strconv.Itoa(page)
		if err := api.get(ctx, resource, &response); err != nil {
			return err
		}
		for _, run := range response.WorkflowRuns {
			if run.HeadSHA != sha || run.HeadBranch != tag || run.Event != "push" ||
				run.Status != "completed" || run.Conclusion != "success" || run.ID <= 0 {
				continue
			}
			ok, err := successfulStableJobs(ctx, api, run.ID)
			if err != nil {
				return err
			}
			if ok {
				return nil
			}
		}
		if len(response.WorkflowRuns) < 100 || page*100 >= response.TotalCount {
			break
		}
	}
	return fmt.Errorf("GitHub %s exact-SHA CI has not completed with successful Final Gate and OCR smoke; retry publication after GitHub succeeds", tag)
}

func main() {
	client := &http.Client{
		Timeout: 20 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	api := githubReadAPI{
		client: client,
		base:   githubActionsAPI,
		token:  strings.TrimSpace(os.Getenv("XDRIVE_GITHUB_READ_TOKEN")),
	}
	tag := os.Getenv("CI_COMMIT_TAG")
	sha := os.Getenv("CI_COMMIT_SHA")
	if err := verifyGitHubStableGate(ctx, api, tag, sha); err != nil {
		fmt.Fprintln(os.Stderr, "[xDrive] stable release blocked:", err)
		os.Exit(1)
	}
	fmt.Printf("[xDrive] GitHub stable Final Gate and OCR smoke verified for %s at %s\n", tag, sha)
}
