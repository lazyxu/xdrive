package localpushcommon

import (
	"context"

	"github.com/lazyxu/xdrive/internal/client"
)

// DurableTransport is the owning Agent's authenticated interface to the
// EXISTING generic file uploader and Server's private per-file checkpoint.
// The Protocol grants no authority without Server Owner/Device/Root ACLs.
type DurableTransport interface {
	AdmitLocalPushCommonUpload(context.Context, uint64, uint64, client.LocalBoundSourceProof,
		client.LocalPushCommonUploadInput) (client.LocalPushCommonUploadStatus, error)
	BindLocalPushCommonUpload(context.Context, uint64, uint64, client.LocalBoundSourceProof,
		string, string, string) (client.LocalPushCommonUploadStatus, error)
	ReadLocalPushCommonUploadReceipt(context.Context, uint64, uint64, client.LocalBoundSourceProof,
		string, string) (client.LocalPushCommonUploadReceipt, error)
	UploadStreamResumableVerifiedBoundResult(context.Context, client.UploadInit,
		client.UploadStreamOpen, func(context.Context, client.UploadSession) error,
		client.UploadProgress) (client.UploadResult, error)
}

func matchesDurableReceipt(p Plan, receipt client.LocalPushCommonUploadReceipt) bool {
	if !receipt.Committed || receipt.State != "committed" ||
		receipt.SourceID != p.SourceID || receipt.Revision != p.SourceRevision ||
		receipt.OperationID != p.OperationID || receipt.NodeID == 0 ||
		receipt.ContentSHA256 != p.ContentSHA256 || receipt.Size != p.Size {
		return false
	}
	if p.Target.NodeID != 0 {
		return receipt.NodeID == p.Target.NodeID &&
			receipt.NodeRevision == p.Target.ExpectedRevision+1
	}
	return receipt.NodeRevision == 1
}

func validDurableScope(p Plan, proof client.LocalBoundSourceProof) bool {
	return p.DeviceID == proof.DeviceID &&
		p.RootID == proof.RootID && p.RootFingerprint == proof.RootFingerprint &&
		proof.DeviceID != "" && proof.DeviceToken != "" && proof.RootID != "" &&
		proof.RootFingerprint != ""
}

// UploadDurableOne is the one-file BOUNDED common-upload protocol. The caller
// must be the owning Agent with a durable, verified Inventory snapshot and a
// trusted offset opener for that SAME OS file identity. OperationID must be
// persisted BEFORE the first request; never allocate a new one on retry.
//
// A generic HTTP Finalize success is NOT accepted as a Push result. Only the
// original immutable Server SQL receipt can return a positive per-file commit.
// Even then, this is NOT SourceRun/backup_complete or legacy Stage retirement.
func UploadDurableOne(ctx context.Context, api DurableTransport,
	proof client.LocalBoundSourceProof, task Task, progress client.UploadProgress,
) (client.LocalPushCommonUploadReceipt, error) {
	var zero client.LocalPushCommonUploadReceipt
	if ctx == nil || api == nil || ctx.Err() != nil ||
		task.Plan.Validate() != nil || !validDurableScope(task.Plan, proof) {
		return zero, ErrInvalidPlan
	}
	p := task.Plan
	key, err := p.ResumeKey()
	if err != nil {
		return zero, ErrInvalidPlan
	}
	input := client.LocalPushCommonUploadInput{
		OperationID: p.OperationID, ResumeKey: key,
		SHA256: p.ContentSHA256, Size: p.Size,
		ExpectedRevision: p.Target.ExpectedRevision,
	}
	init := client.UploadInit{
		Size: p.Size, SHA256: p.ContentSHA256,
		ResumeKey: key, ChunkSize: client.DefaultUploadChunkSize,
	}
	if p.Target.NodeID != 0 {
		id := p.Target.NodeID
		input.NodeID, init.NodeID = &id, &id
		init.ExpectedRevision = p.Target.ExpectedRevision
	} else {
		id := p.Target.ParentID
		input.ParentID, init.ParentID = &id, &id
		input.Name, init.Name = p.Target.Name, p.Target.Name
	}
	admit, err := api.AdmitLocalPushCommonUpload(ctx, p.SourceID, p.SourceRevision, proof, input)
	if err != nil || ctx.Err() != nil || admit.SourceID != p.SourceID ||
		admit.Revision != p.SourceRevision || admit.OperationID != p.OperationID ||
		(admit.State != "reserved" && admit.State != "bound" &&
			admit.State != "committed") {
		return zero, ErrUncertain
	}
	read := func() (client.LocalPushCommonUploadReceipt, error) {
		return api.ReadLocalPushCommonUploadReceipt(
			ctx, p.SourceID, p.SourceRevision, proof, p.OperationID, key)
	}
	original, err := ReadOriginalReceiptWithBackoff(ctx, read)
	if err != nil || ctx.Err() != nil || original.SourceID != p.SourceID ||
		original.Revision != p.SourceRevision ||
		original.OperationID != p.OperationID {
		return zero, ErrUncertain
	}
	if original.Committed {
		if matchesDurableReceipt(p, original) {
			return original, nil
		}
		return zero, ErrUncertain
	}
	if original.State != "reserved" && original.State != "bound" {
		return zero, ErrUncertain
	}
	// Reconciliation of a pending original requires the SAME native source.
	// A committed receipt above is recoverable without rereading local bytes.
	if p.Size > 0 && task.Open == nil {
		return zero, ErrUncertain
	}
	gate := func(gateCtx context.Context, session client.UploadSession) error {
		if session.ID == "" || session.Status != "active" ||
			session.ResumeKey != key || session.SHA256 != p.ContentSHA256 ||
			session.Size != p.Size {
			return ErrUncertain
		}
		status, bindErr := api.BindLocalPushCommonUpload(
			gateCtx, p.SourceID, p.SourceRevision, proof,
			p.OperationID, key, session.ID)
		if bindErr != nil || status.State != "bound" ||
			status.SourceID != p.SourceID || status.Revision != p.SourceRevision ||
			status.OperationID != p.OperationID {
			return ErrUncertain
		}
		return nil
	}
	// This call reuses ordinary /uploads Session/chunks/Finalize with a
	// mandatory pre-byte bind. A network error might hide a committed write.
	_, uploadErr := api.UploadStreamResumableVerifiedBoundResult(
		ctx, init, task.Open, gate, progress)
	if ctx.Err() != nil {
		return zero, ErrUncertain
	}
	final, readErr := ReadOriginalReceiptWithBackoff(ctx, read)
	if readErr == nil && matchesDurableReceipt(p, final) {
		return final, nil // identical original committed Operation, even after lost ACK
	}
	_ = uploadErr // no retry, no new Operation, no inference from HTTP ACK
	return zero, ErrUncertain
}

// UploadDurableSerial is a 256-file, transport-only integration primitive.
// The real Agent Runner, persistent journal, legacy Stage/Key/Writer migration,
// SourceRun, scheduler and native fd liveness MUST be implemented before
// invoking this from any production Desktop/Agent IPC operation.
func UploadDurableSerial(ctx context.Context, api DurableTransport,
	proof client.LocalBoundSourceProof, tasks []Task,
) ([]client.LocalPushCommonUploadReceipt, error) {
	if ctx == nil || api == nil || ctx.Err() != nil || len(tasks) == 0 || len(tasks) > 256 {
		return nil, ErrInvalidPlan
	}
	seen := make(map[string]struct{}, len(tasks))
	ops := make(map[string]struct{}, len(tasks))
	sourceID := tasks[0].Plan.SourceID
	revision := tasks[0].Plan.SourceRevision
	for _, task := range tasks {
		key, err := task.Plan.ResumeKey()
		if err != nil || !validDurableScope(task.Plan, proof) ||
			task.Plan.SourceID != sourceID ||
			task.Plan.SourceRevision != revision {
			return nil, ErrInvalidPlan
		}
		if _, dup := seen[key]; dup {
			return nil, ErrInvalidPlan
		}
		if _, dup := ops[task.Plan.OperationID]; dup {
			return nil, ErrInvalidPlan
		}
		seen[key] = struct{}{}
		ops[task.Plan.OperationID] = struct{}{}
	}
	out := make([]client.LocalPushCommonUploadReceipt, 0, len(tasks))
	for _, task := range tasks {
		receipt, err := UploadDurableOne(ctx, api, proof, task, nil)
		if err != nil {
			return out, err // exact earlier file commits persist, never roll back
		}
		out = append(out, receipt)
	}
	return out, nil
}
