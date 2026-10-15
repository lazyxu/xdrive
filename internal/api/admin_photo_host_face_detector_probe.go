package api

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

// This is deliberately separate from FaceAnalyzer: legacy test adapters and
// older model containers must fail closed without breaking ordinary tasks.
type photoHostFixedFaceDetectorProber interface {
	ProbeSyntheticFaceDetection(context.Context) (photointelligence.FaceDetectorCanary, error)
}

// A zero-face response is valid for deterministic NON-person pixels. It proves
// that YuNet was executed and a bounded result returned, NOT positive face
// recognition, SFace embedding or the accuracy of any real photo.
// Preserve YuNet execution semantics independently of SFace feature validity.
func runPhotoHostFixedFaceDetectorInference(
	ctx context.Context,
	check photoHostModelInfoCheck,
	gate meta.AdminPhotoHostApply,
	probe func(context.Context) (photointelligence.FaceDetectorCanary, error),
	readInfo func(context.Context) (photointelligence.FaceAnalyzerInfo, error),
) bool {
	ok, _ := runPhotoHostFixedFaceDetectorInferenceWithSFace(ctx, check, gate, probe, readInfo)
	return ok
}

func runPhotoHostFixedFaceDetectorInferenceWithSFace(
	ctx context.Context,
	check photoHostModelInfoCheck,
	gate meta.AdminPhotoHostApply,
	probe func(context.Context) (photointelligence.FaceDetectorCanary, error),
	readInfo func(context.Context) (photointelligence.FaceAnalyzerInfo, error),
) (bool, *bool) {
	if ctx == nil || probe == nil || readInfo == nil ||
		check.ID != "photo-face" || check.State != "ready" ||
		!photointelligence.ValidAnalyzerRuntimeInstanceID(check.runtimeInstanceID) ||
		gate.State != "host-verified" || gate.Revision == 0 ||
		!photointelligence.ValidAnalyzerHostRequestID(gate.RequestID) ||
		check.hostReceipt == nil ||
		check.hostReceipt.Revision != gate.Revision ||
		check.hostReceipt.RequestID != gate.RequestID || ctx.Err() != nil {
		return false, nil
	}
	result, err := probe(ctx)
	if err != nil || ctx.Err() != nil || !result.DetectorExecuted ||
		result.FaceCount < 0 || result.FaceCount > photointelligence.MaxFacesPerImage {
		return false, nil
	}
	// Prevent a successful response from an old/restarted or unrelated model
	// from being published as this audited host generation's detector effect.
	info, err := readInfo(ctx)
	if err != nil || ctx.Err() != nil ||
		photointelligence.ValidateFaceAnalyzerInfo(info) != nil ||
		info.RuntimeInstanceID != check.runtimeInstanceID ||
		info.HostApplyReceipt == nil ||
		info.HostApplyReceipt.Revision != gate.Revision ||
		info.HostApplyReceipt.RequestID != gate.RequestID {
		return false, nil
	}
	if ctx.Err() != nil {
		return false, nil
	}
	return true, result.SFaceEmbeddingValid
}

// One explicit administrator click only. The existing four Info ACKs and
// Host Manager / Docker / kernel evidence must already be verified. Share the
// same mutex as semantic text/image; use a separate 60s face attempt cooldown.
func (s *Server) photoHostFaceDetectorProbe(
	parent context.Context,
	desired photoHostDesired,
	gate meta.AdminPhotoHostApply,
	checks []photoHostModelInfoCheck,
) (string, string) {
	if s == nil || s.PhotoFaceAnalyzer == nil ||
		!photoHostModelInstanceCoherent(checks) ||
		!s.photoHostSemanticEvidenceCurrent(parent, desired, gate, checks) {
		return "unverified", "unverified"
	}
	prober, ok := s.PhotoFaceAnalyzer.(photoHostFixedFaceDetectorProber)
	if !ok {
		return "unverified", "unverified"
	}
	if !photoHostSemanticProbeGate.TryLock() {
		return "throttled", "throttled"
	}
	defer photoHostSemanticProbeGate.Unlock()
	if !photoHostSemanticProbeGate.lastFaceAttempt.IsZero() &&
		time.Since(photoHostSemanticProbeGate.lastFaceAttempt) < photoHostSemanticProbeCooldown {
		return "throttled", "throttled"
	}
	photoHostSemanticProbeGate.lastFaceAttempt = time.Now()
	ctx, cancel := context.WithTimeout(parent, photoHostSemanticProbeTimeout)
	defer cancel()
	if !s.photoHostSemanticEvidenceCurrent(ctx, desired, gate, checks) {
		return "unverified", "unverified"
	}
	executed, embeddingValid := runPhotoHostFixedFaceDetectorInferenceWithSFace(
		ctx, checks[0], gate,
		prober.ProbeSyntheticFaceDetection, s.PhotoFaceAnalyzer.Info,
	)
	if !executed {
		return "failed", "unverified"
	}
	if !s.photoHostSemanticEvidenceCurrent(ctx, desired, gate, checks) {
		return "unverified", "unverified"
	}
	return "verified", photoHostSFaceSyntheticState(embeddingValid)
}

// A valid fixed-landmark synthetic embedding is not a positive face identity
// test. A legacy absent Boolean is never treated as model-ready.
func photoHostSFaceSyntheticState(value *bool) string {
	if value == nil {
		return "unverified"
	}
	if *value {
		return "verified"
	}
	return "failed"
}
