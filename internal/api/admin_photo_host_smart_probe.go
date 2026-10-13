package api

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

// A legacy SmartAnalyzer without this private canary stays unverified.
// The host's fixed Unix socket is the only allowed transport.
type photoHostFixedSmartProber interface {
	ProbeSyntheticVisualOCR(context.Context) (photointelligence.SmartModelCanary, error)
}

// All three actual model paths must have been executed. Region/text/label
// counts may be zero: model execution does not prove OCR recognition accuracy.
func runPhotoHostFixedSmartInference(
	ctx context.Context,
	check photoHostModelInfoCheck,
	gate meta.AdminPhotoHostApply,
	probe func(context.Context) (photointelligence.SmartModelCanary, error),
	readInfo func(context.Context) (photointelligence.SmartAnalyzerInfo, error),
) bool {
	if ctx == nil || probe == nil || readInfo == nil ||
		check.ID != "photo-smart" || check.State != "ready" ||
		!photointelligence.ValidAnalyzerRuntimeInstanceID(check.runtimeInstanceID) ||
		gate.State != "host-verified" || gate.Revision == 0 ||
		!photointelligence.ValidAnalyzerHostRequestID(gate.RequestID) ||
		check.hostReceipt == nil ||
		check.hostReceipt.Revision != gate.Revision ||
		check.hostReceipt.RequestID != gate.RequestID || ctx.Err() != nil {
		return false
	}
	result, err := probe(ctx)
	if err != nil || ctx.Err() != nil ||
		!result.ClassifierExecuted || !result.OCRDetectorExecuted ||
		!result.OCRRecognizerExecuted ||
		result.LabelCount < 0 || result.LabelCount > photointelligence.MaxSmartVisualLabels ||
		result.OCRRegionCount < 0 || result.OCRRegionCount > 200 ||
		result.OCRCharCount < 0 || result.OCRCharCount > photointelligence.MaxSmartOCRRunes {
		return false
	}
	info, err := readInfo(ctx)
	if err != nil || ctx.Err() != nil ||
		photointelligence.ValidateSmartAnalyzerInfo(info) != nil ||
		info.RuntimeInstanceID != check.runtimeInstanceID ||
		info.HostApplyReceipt == nil ||
		info.HostApplyReceipt.Revision != gate.Revision ||
		info.HostApplyReceipt.RequestID != gate.RequestID {
		return false
	}
	return ctx.Err() == nil
}

// Explicit admin-only preflight after four model ACKs and kernel Socket proof.
// Share the existing text/image/YuNet mutex; independently throttle Smart.
func (s *Server) photoHostSmartProbe(
	parent context.Context,
	desired photoHostDesired,
	gate meta.AdminPhotoHostApply,
	checks []photoHostModelInfoCheck,
) string {
	if s == nil || s.PhotoSmartAnalyzer == nil ||
		!photoHostModelInstanceCoherent(checks) ||
		!s.photoHostSemanticEvidenceCurrent(parent, desired, gate, checks) {
		return "unverified"
	}
	prober, ok := s.PhotoSmartAnalyzer.(photoHostFixedSmartProber)
	if !ok {
		return "unverified"
	}
	if !photoHostSemanticProbeGate.TryLock() {
		return "throttled"
	}
	defer photoHostSemanticProbeGate.Unlock()
	if !photoHostSemanticProbeGate.lastSmartAttempt.IsZero() &&
		time.Since(photoHostSemanticProbeGate.lastSmartAttempt) < photoHostSemanticProbeCooldown {
		return "throttled"
	}
	photoHostSemanticProbeGate.lastSmartAttempt = time.Now()
	ctx, cancel := context.WithTimeout(parent, photoHostSemanticProbeTimeout)
	defer cancel()
	if !s.photoHostSemanticEvidenceCurrent(ctx, desired, gate, checks) {
		return "unverified"
	}
	if !runPhotoHostFixedSmartInference(
		ctx, checks[1], gate,
		prober.ProbeSyntheticVisualOCR, s.PhotoSmartAnalyzer.Info,
	) {
		return "failed"
	}
	if !s.photoHostSemanticEvidenceCurrent(ctx, desired, gate, checks) {
		return "unverified"
	}
	return "verified"
}
