package api

import (
	"bytes"
	"context"
	"sync/atomic"
	"time"

	"github.com/lazyxu/xdrive/internal/photointelligence"
)

const offlinePhotoModelRPCHearbeatInterval = 100 * time.Millisecond

// offlinePhotoModelRPCSpec contains synthetic test fixtures ONLY. There is
// deliberately no production key loader, model transport or task API.
type offlinePhotoModelRPCSpec struct {
	keyHex          string
	deploymentEpoch string
	serverID        string
	modelID         string
	method          string
	path            string
	body            []byte
	now             time.Time
}

// runOfflinePhotoModelRPC exercises issuance and a synthetic remote callback
// while the caller-owned PostgreSQL shared admission session remains held.
// It DOES NOT attach permits to any running Photo/Creative/canary task.
// Nothing in this test helper can authorize model stop/freeze/restart.
//
// The callback must honor its context. Real RPC cancellation, timeout,
// key rotation, model-side admission and trusted membership still need a
// separately audited full-producer rollout before enforcement.
func (l *photoHostAdmissionLease) runOfflinePhotoModelRPC(
	parent context.Context,
	spec offlinePhotoModelRPCSpec,
	invoke func(context.Context, photointelligence.PhotoModelPermitV1, string, []byte) error,
) error {
	if parent == nil || parent.Err() != nil || invoke == nil {
		return errOfflinePhotoModelPermitUnavailable
	}
	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	// Pin the request bytes used for both the signed SHA256 and the later
	// synthetic callback; the calling slice may change during execution.
	body := bytes.Clone(spec.body)
	claim, mac, err := l.issueOfflinePhotoModelPermitV1(
		ctx, spec.keyHex, spec.deploymentEpoch, spec.serverID,
		spec.modelID, spec.method, spec.path, body, spec.now,
	)
	if err != nil {
		return errOfflinePhotoModelPermitUnavailable
	}

	var leaseLost atomic.Bool
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		ticker := time.NewTicker(offlinePhotoModelRPCHearbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := l.Heartbeat(ctx); err != nil {
					leaseLost.Store(true)
					cancel()
					return
				}
			}
		}
	}()

	// DO NOT close the lease before the remote callback actually returns.
	// No side effect or positive response is trusted if a heartbeat fails.
	callErr := invoke(ctx, claim, mac, body)
	finalHeartbeat := l.Heartbeat(ctx)
	cancel()
	<-heartbeatDone
	if callErr != nil || finalHeartbeat != nil || leaseLost.Load() || parent.Err() != nil {
		return errOfflinePhotoModelPermitUnavailable
	}
	return nil
}
