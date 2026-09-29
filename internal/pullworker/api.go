package pullworker

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

const internalTokenTTL = 12 * time.Hour

type OwnerSourceAPI struct {
	serverURL string
	auth      auth.Manager
	owner     meta.User
	cancelRun context.CancelFunc
}

func NewOwnerSourceAPI(serverURL, jwtSecret string, owner meta.User) (*OwnerSourceAPI, error) {
	serverURL = strings.TrimRight(strings.TrimSpace(serverURL), "/")
	jwtSecret = strings.TrimSpace(jwtSecret)
	if serverURL == "" || jwtSecret == "" {
		return nil, fmt.Errorf("pull worker server URL and JWT secret are required")
	}
	return &OwnerSourceAPI{
		serverURL: serverURL,
		auth:      auth.New(jwtSecret, internalTokenTTL),
		owner:     owner,
	}, nil
}

func (a *OwnerSourceAPI) SetCancelRun(cancel context.CancelFunc) {
	a.cancelRun = cancel
}

func (a *OwnerSourceAPI) handleRunControlError(err error) error {
	if !IsCancellationRequested(err) {
		return err
	}
	if a.cancelRun != nil {
		a.cancelRun()
	}
	return context.Canceled
}

func (a *OwnerSourceAPI) client() (*client.Client, error) {
	token, err := a.auth.Issue(a.owner.ID, a.owner.SessionVersion)
	if err != nil {
		return nil, err
	}
	out := client.New(a.serverURL, token)
	out.HTTP = &http.Client{Timeout: 30 * time.Second}
	return out, nil
}

type ExecutionAPI struct {
	sourceAPI *OwnerSourceAPI
}

func NewExecutionAPI(sourceAPI *OwnerSourceAPI) *ExecutionAPI {
	return &ExecutionAPI{sourceAPI: sourceAPI}
}

func (a *ExecutionAPI) List(ctx context.Context, parentID uint64) ([]client.Node, error) {
	c, err := a.sourceAPI.client()
	if err != nil {
		return nil, err
	}
	return c.List(ctx, parentID)
}

func (a *ExecutionAPI) CreateDir(ctx context.Context, parentID uint64, name string) (client.Node, error) {
	c, err := a.sourceAPI.client()
	if err != nil {
		return client.Node{}, err
	}
	return c.CreateDir(ctx, parentID, name)
}

func (a *ExecutionAPI) RenameMove(ctx context.Context, id, revision uint64, name *string, parentID *uint64) (client.Node, error) {
	c, err := a.sourceAPI.client()
	if err != nil {
		return client.Node{}, err
	}
	return c.RenameMove(ctx, id, revision, name, parentID)
}

func (a *ExecutionAPI) UploadStreamResumableDigestResult(
	ctx context.Context,
	parentID uint64,
	name string,
	size int64,
	md5Digest string,
	resumeKey string,
	open client.UploadStreamOpen,
	progress client.UploadProgress,
) (client.UploadResult, error) {
	c, err := a.sourceAPI.client()
	if err != nil {
		return client.UploadResult{}, err
	}
	return c.UploadStreamResumableDigestResult(ctx, parentID, name, size, md5Digest, resumeKey, open, progress)
}

func (a *ExecutionAPI) OverwriteStreamResumableDigestResult(
	ctx context.Context,
	nodeID, revision uint64,
	size int64,
	md5Digest string,
	resumeKey string,
	open client.UploadStreamOpen,
	progress client.UploadProgress,
) (client.UploadResult, error) {
	c, err := a.sourceAPI.client()
	if err != nil {
		return client.UploadResult{}, err
	}
	return c.OverwriteStreamResumableDigestResult(ctx, nodeID, revision, size, md5Digest, resumeKey, open, progress)
}

func (a *OwnerSourceAPI) BeginSourceRun(ctx context.Context, sourceID uint64, runID, trigger string) (client.SyncRun, error) {
	c, err := a.client()
	if err != nil {
		return client.SyncRun{}, err
	}
	return c.BeginSourceRun(ctx, sourceID, runID, trigger)
}

func (a *OwnerSourceAPI) ObserveSourceItems(ctx context.Context, sourceID uint64, runID string, items []client.SourceObservation) ([]client.SourcePlan, error) {
	c, err := a.client()
	if err != nil {
		return nil, err
	}
	return c.ObserveSourceItems(ctx, sourceID, runID, items)
}

func (a *OwnerSourceAPI) CommitSourceItems(ctx context.Context, sourceID uint64, runID string, items []client.SourceCommit) error {
	c, err := a.client()
	if err != nil {
		return err
	}
	return c.CommitSourceItems(ctx, sourceID, runID, items)
}

func (a *OwnerSourceAPI) FailSourceItems(ctx context.Context, sourceID uint64, runID string, items []client.SourceFailure) error {
	c, err := a.client()
	if err != nil {
		return err
	}
	return c.FailSourceItems(ctx, sourceID, runID, items)
}

func (a *OwnerSourceAPI) UpdateSourceRunSummary(ctx context.Context, sourceID uint64, runID string, summary sourcepkg.Summary) error {
	c, err := a.client()
	if err != nil {
		return err
	}
	return a.handleRunControlError(c.UpdateSourceRunSummary(ctx, sourceID, runID, summary))
}

func (a *OwnerSourceAPI) UpdateSourceRunTransferProgress(ctx context.Context, sourceID uint64, runID, path string, done, total int64) error {
	c, err := a.client()
	if err != nil {
		return err
	}
	return a.handleRunControlError(c.UpdateSourceRunTransferProgress(ctx, sourceID, runID, path, done, total))
}

func (a *OwnerSourceAPI) HeartbeatSourceRun(ctx context.Context, sourceID uint64, runID string) error {
	c, err := a.client()
	if err != nil {
		return err
	}
	return a.handleRunControlError(c.HeartbeatSourceRun(ctx, sourceID, runID))
}

func (a *OwnerSourceAPI) FinishSourceRun(ctx context.Context, sourceID uint64, runID string, input client.FinishSourceRunInput) (client.SyncRun, error) {
	c, err := a.client()
	if err != nil {
		return client.SyncRun{}, err
	}
	return c.FinishSourceRun(ctx, sourceID, runID, input)
}

func IsActiveRun(err error) bool {
	var apiErr *client.APIError
	return errors.As(err, &apiErr) &&
		apiErr.Status == http.StatusConflict &&
		apiErr.Msg == "source already has an active run"
}

func IsCancellationRequested(err error) bool {
	var apiErr *client.APIError
	return errors.As(err, &apiErr) &&
		apiErr.Status == http.StatusConflict &&
		apiErr.Msg == "source run cancellation requested"
}
