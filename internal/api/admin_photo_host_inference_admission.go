package api

import (
	"context"
	"sync/atomic"
	"time"
)

const photoHostManualInferenceHeartbeatInterval = 2 * time.Second

// Only the administrator's fixed, model-local canaries use this bounded
// admission; callers never choose inputs, paths or model commands. Sharing the
// queued Photo/Creative admission lock does NOT grant host stop/drain authority.
func (s *Server) photoHostRunAdmittedSyntheticInference(
	parent context.Context,
	infer func(context.Context),
) bool {
	if s == nil || s.DB == nil || parent == nil || parent.Err() != nil || infer == nil {
		return false
	}
	lease, admitted, err := tryAcquirePhotoHostAdmission(parent, s.DB)
	if err != nil || !admitted || lease == nil {
		return false
	}
	defer lease.Close()

	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	var lost atomic.Bool
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(photoHostManualInferenceHeartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := lease.Heartbeat(ctx); err != nil {
					lost.Store(true)
					cancel()
					return
				}
			}
		}
	}()

	// The existing model probe supplies its own six-second deadline and
	// independently validates the exact saved revision, Info generation and
	// trusted host request before and after this model-only inference.
	infer(ctx)
	alive := !lost.Load() && ctx.Err() == nil && parent.Err() == nil &&
		lease.Heartbeat(parent) == nil
	cancel()
	<-done
	return alive && !lost.Load() && parent.Err() == nil
}
