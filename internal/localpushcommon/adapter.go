package localpushcommon

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/client"
)

// ErrUncertain means the outcome must be reconciled with a durable Server
// operation before retry or release. A canceled HTTP request is not proof that
// the Server did not finalize the ordinary upload session.
var ErrUncertain = errors.New("common local Push upload outcome uncertain")

// Uploader is xDrive's EXISTING resumable file upload engine, not a new Push
// CAS/SQL pipeline. Only an authenticated owning Agent may instantiate jobs;
// this adapter grants no Device/Root/Source authority by itself.
type Uploader interface {
	UploadStreamResumableVerifiedResult(context.Context, client.UploadInit, client.UploadStreamOpen, client.UploadProgress) (client.UploadResult, error)
}

// Task stores an already verified snapshot decision. Open MUST provide reads
// against the same pinned native file identity. Do not pass Renderer paths.
type Task struct {
	Plan Plan
	Open client.UploadStreamOpen
}

// UploadOne performs one ordinary SHA-verified resumable upload. Receipt is
// evidence of an ordinary upload, not yet a durable per-file Push checkpoint
// or SourceRun completion. A future Server operation mapping must durably pin
// this session's result before the owning Agent can acknowledge a full backup.
func UploadOne(ctx context.Context, api Uploader, task Task, progress client.UploadProgress) (client.UploadResult, error) {
	if ctx == nil || api == nil || ctx.Err() != nil ||
		(task.Plan.Size > 0 && task.Open == nil) {
		return client.UploadResult{}, ErrInvalidPlan
	}
	key, err := task.Plan.ResumeKey()
	if err != nil {
		return client.UploadResult{}, err
	}
	init := client.UploadInit{
		Size:      task.Plan.Size,
		ChunkSize: client.DefaultUploadChunkSize,
		SHA256:    task.Plan.ContentSHA256,
		ResumeKey: key,
	}
	if task.Plan.Target.NodeID != 0 {
		id := task.Plan.Target.NodeID
		init.NodeID = &id
		init.ExpectedRevision = task.Plan.Target.ExpectedRevision
	} else {
		id := task.Plan.Target.ParentID
		init.ParentID = &id
		init.Name = task.Plan.Target.Name
	}
	result, err := api.UploadStreamResumableVerifiedResult(ctx, init, task.Open, progress)
	if err != nil || ctx.Err() != nil {
		// Never turn a missing ACK or canceled caller into a definite failed
		// upload, a fresh OperationID, a physical CANCEL or a retry.
		return client.UploadResult{}, ErrUncertain
	}
	if result.Skipped || result.Node.ID == 0 || result.Node.Type != "file" ||
		result.Node.Size != task.Plan.Size ||
		result.SHA256 != task.Plan.ContentSHA256 ||
		result.Node.SHA256 != task.Plan.ContentSHA256 {
		return client.UploadResult{}, ErrUncertain
	}
	if task.Plan.Target.NodeID != 0 {
		if result.Node.ID != task.Plan.Target.NodeID ||
			result.Node.Revision != task.Plan.Target.ExpectedRevision+1 {
			return client.UploadResult{}, ErrUncertain
		}
	} else if result.Node.ParentID == nil ||
		*result.Node.ParentID != task.Plan.Target.ParentID ||
		result.Node.Name != task.Plan.Target.Name || result.Node.Revision != 1 {
		return client.UploadResult{}, ErrUncertain
	}
	return result, nil
}

// UploadSerial is intentionally a bounded transport-only bridge. It can
// upload file B after file A's ordinary verified completion, but it DOES NOT
// retire legacy Writer/Stage/Key claims or activate production multi-file Push.
// Future durable file checkpoint integration must precede runtime wiring.
func UploadSerial(ctx context.Context, api Uploader, tasks []Task) ([]client.UploadResult, error) {
	if ctx == nil || api == nil || len(tasks) == 0 || len(tasks) > 256 || ctx.Err() != nil {
		return nil, ErrInvalidPlan
	}
	seen := make(map[string]struct{}, len(tasks))
	operations := make(map[string]struct{}, len(tasks))
	for _, task := range tasks {
		key, err := task.Plan.ResumeKey()
		if err != nil || (task.Plan.Size > 0 && task.Open == nil) {
			return nil, ErrInvalidPlan
		}
		if _, exists := seen[key]; exists {
			return nil, ErrInvalidPlan
		}
		if _, exists := operations[task.Plan.OperationID]; exists {
			return nil, ErrInvalidPlan
		}
		operations[task.Plan.OperationID] = struct{}{}
		seen[key] = struct{}{}
	}
	out := make([]client.UploadResult, 0, len(tasks))
	for _, task := range tasks {
		result, err := UploadOne(ctx, api, task, nil)
		if err != nil {
			return out, err // already uploaded files remain committed, never roll back
		}
		out = append(out, result)
	}
	return out, nil
}
