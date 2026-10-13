package api

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

// Optional because older model adapter implementations do not implement this
// fixed-pixel diagnostic. It never accepts task bytes, paths or URLs.
type photoHostSyntheticImageProber interface {
	ProbeSyntheticImage(context.Context) (photointelligence.SemanticEmbedding, error)
}

// A genuine image encoder inference on deterministic model-local pixels.
// The shared semantic validator checks quantized output and re-reads the
// same process generation plus the exact host apply receipt after inference.
func runPhotoHostSemanticImageInference(
	ctx context.Context,
	check photoHostModelInfoCheck,
	gate meta.AdminPhotoHostApply,
	probe func(context.Context) (photointelligence.SemanticEmbedding, error),
	readInfo func(context.Context) (photointelligence.SemanticAnalyzerInfo, error),
) bool {
	return runPhotoHostSemanticTaskInference(ctx, check, gate, probe, readInfo)
}

// Reuse the TEXT diagnostic's mutex; keep independent 60-second cool-downs
// for text and synthetic image so one explicit admin click can test both.
// The model's fixed Unix route is not the user-image preview protocol.
func (s *Server) photoHostSemanticImageProbe(
	parent context.Context,
	desired photoHostDesired,
	gate meta.AdminPhotoHostApply,
	checks []photoHostModelInfoCheck,
) string {
	if s == nil || s.PhotoSemanticAnalyzer == nil ||
		!photoHostModelInstanceCoherent(checks) ||
		!s.photoHostSemanticEvidenceCurrent(parent, desired, gate, checks) {
		return "unverified"
	}
	prober, ok := s.PhotoSemanticAnalyzer.(photoHostSyntheticImageProber)
	if !ok {
		return "unverified"
	}
	if !photoHostSemanticProbeGate.TryLock() {
		return "throttled"
	}
	defer photoHostSemanticProbeGate.Unlock()
	if !photoHostSemanticProbeGate.lastImageAttempt.IsZero() &&
		time.Since(photoHostSemanticProbeGate.lastImageAttempt) < photoHostSemanticProbeCooldown {
		return "throttled"
	}
	photoHostSemanticProbeGate.lastImageAttempt = time.Now()
	ctx, cancel := context.WithTimeout(parent, photoHostSemanticProbeTimeout)
	defer cancel()
	if !s.photoHostSemanticEvidenceCurrent(ctx, desired, gate, checks) {
		return "unverified"
	}
	if !runPhotoHostSemanticImageInference(
		ctx, checks[2], gate, prober.ProbeSyntheticImage, s.PhotoSemanticAnalyzer.Info,
	) {
		return "failed"
	}
	if !s.photoHostSemanticEvidenceCurrent(ctx, desired, gate, checks) {
		return "unverified"
	}
	return "verified"
}
