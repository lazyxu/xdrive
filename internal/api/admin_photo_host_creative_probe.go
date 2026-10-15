package api

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

// Optional private diagnostic, not a CreativeAnalyzer API change or a user
// media operation. Legacy adapters and old model containers fail closed.
type photoHostFixedCreativeProber interface {
	ProbeSyntheticCutout(context.Context) (bool, error)
}

// Independent real EfficientSAM cutout execution evidence on fixed model-local
// NON-person pixels, never quality, real-media or cluster activation proof.
func runPhotoHostFixedCreativeInference(
	ctx context.Context,
	check photoHostModelInfoCheck,
	gate meta.AdminPhotoHostApply,
	probe func(context.Context) (bool, error),
	readInfo func(context.Context) (photointelligence.CreativeAnalyzerInfo, error),
) (bool, error) {
	if ctx == nil || probe == nil || readInfo == nil ||
		check.ID != "photo-creative" || check.State != "ready" ||
		!photointelligence.ValidAnalyzerRuntimeInstanceID(check.runtimeInstanceID) ||
		gate.State != "host-verified" || gate.Revision == 0 ||
		!photointelligence.ValidAnalyzerHostRequestID(gate.RequestID) ||
		check.hostReceipt == nil ||
		check.hostReceipt.Revision != gate.Revision ||
		check.hostReceipt.RequestID != gate.RequestID || ctx.Err() != nil {
		return false, errors.New("creative fixed canary lacks original host evidence")
	}
	executed, err := probe(ctx)
	if err != nil {
		return false, err
	}
	if ctx.Err() != nil {
		return false, errors.New("creative fixed canary was canceled")
	}
	info, err := readInfo(ctx)
	if err != nil || ctx.Err() != nil ||
		photointelligence.ValidateCreativeAnalyzerInfo(info) != nil ||
		info.RuntimeInstanceID != check.runtimeInstanceID ||
		info.HostApplyReceipt == nil ||
		info.HostApplyReceipt.Revision != gate.Revision ||
		info.HostApplyReceipt.RequestID != gate.RequestID {
		return false, errors.New("creative fixed canary model process or request changed")
	}
	return executed && ctx.Err() == nil, nil
}

// Only an administrator's explicit existing no-store preflight may invoke the
// fixed model-local task after four same-process Info ACKs, the audited host
// receipt, current Docker/kernel evidence, and a clear queue. Share the Go
// text/image/face/smart mutex; Creative gets an independent 60s cooldown.
func (s *Server) photoHostCreativeCutoutProbe(
	parent context.Context,
	desired photoHostDesired,
	gate meta.AdminPhotoHostApply,
	checks []photoHostModelInfoCheck,
) string {
	if s == nil || s.PhotoCreativeAnalyzer == nil ||
		!photoHostModelInstanceCoherent(checks) ||
		!s.photoHostSemanticEvidenceCurrent(parent, desired, gate, checks) {
		return "unverified"
	}
	prober, ok := s.PhotoCreativeAnalyzer.(photoHostFixedCreativeProber)
	if !ok {
		return "unverified"
	}
	if !photoHostSemanticProbeGate.TryLock() {
		return "throttled"
	}
	defer photoHostSemanticProbeGate.Unlock()
	if !photoHostSemanticProbeGate.lastCreativeAttempt.IsZero() &&
		time.Since(photoHostSemanticProbeGate.lastCreativeAttempt) < photoHostSemanticProbeCooldown {
		return "throttled"
	}
	photoHostSemanticProbeGate.lastCreativeAttempt = time.Now()
	ctx, cancel := context.WithTimeout(parent, photoHostSemanticProbeTimeout)
	defer cancel()
	if !s.photoHostSemanticEvidenceCurrent(ctx, desired, gate, checks) {
		return "unverified"
	}
	var executed bool
	var err error
	if !s.photoHostRunAdmittedSyntheticInference(ctx, func(inferenceCtx context.Context) {
		executed, err = runPhotoHostFixedCreativeInference(
			inferenceCtx, checks[3], gate,
			prober.ProbeSyntheticCutout, s.PhotoCreativeAnalyzer.Info,
		)
	}) {
		return "unverified"
	}
	if errors.Is(err, photointelligence.ErrCreativeCutoutCanaryUnavailable) {
		return "unverified"
	}
	if err != nil || !executed {
		return "failed"
	}
	if !s.photoHostSemanticEvidenceCurrent(ctx, desired, gate, checks) {
		return "unverified"
	}
	return "verified"
}
