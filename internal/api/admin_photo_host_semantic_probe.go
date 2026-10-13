package api

import (
	"context"
	"sync"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

const photoHostSemanticProbeText = "a photo of a dog"
const photoHostSemanticProbeTimeout = 6 * time.Second
const photoHostSemanticProbeCooldown = 60 * time.Second

// Rate-limit expensive real inference per Server process. No user-provided
// text, image bytes, URL, Source ID or host command reaches this diagnostic.
var photoHostSemanticProbeGate = struct {
	sync.Mutex
	lastAttempt time.Time
}{}

// Only an authenticated, fixed-prompt, real semantic text embedding counts.
// Recheck the same model generation and exact audited request AFTER inference.
func runPhotoHostSemanticTextInference(
	ctx context.Context,
	check photoHostModelInfoCheck,
	gate meta.AdminPhotoHostApply,
	embed func(context.Context, string) (photointelligence.SemanticEmbedding, error),
	readInfo func(context.Context) (photointelligence.SemanticAnalyzerInfo, error),
) bool {
	if ctx == nil || embed == nil || readInfo == nil ||
		check.ID != "photo-semantic" || check.State != "ready" ||
		!photointelligence.ValidAnalyzerRuntimeInstanceID(check.runtimeInstanceID) ||
		gate.State != "host-verified" || gate.Revision == 0 ||
		!photointelligence.ValidAnalyzerHostRequestID(gate.RequestID) ||
		check.hostReceipt == nil || check.hostReceipt.Revision != gate.Revision ||
		check.hostReceipt.RequestID != gate.RequestID || ctx.Err() != nil {
		return false
	}
	vector, err := embed(ctx, photoHostSemanticProbeText)
	if err != nil || ctx.Err() != nil {
		return false
	}
	info, err := readInfo(ctx)
	if err != nil || ctx.Err() != nil ||
		photointelligence.ValidateSemanticAnalyzerInfo(info) != nil ||
		info.RuntimeInstanceID != check.runtimeInstanceID ||
		info.HostApplyReceipt == nil ||
		info.HostApplyReceipt.Revision != gate.Revision ||
		info.HostApplyReceipt.RequestID != gate.RequestID {
		return false
	}
	_, err = photointelligence.ValidateSemanticEmbedding(info, vector)
	return err == nil && ctx.Err() == nil
}

// The global audited enable record, immutable action-time model receipt,
// current fixed Docker/socket observation and local queue must still agree.
func (s *Server) photoHostSemanticEvidenceCurrent(
	ctx context.Context,
	desired photoHostDesired,
	gate meta.AdminPhotoHostApply,
	checks []photoHostModelInfoCheck,
) bool {
	if s == nil || ctx == nil || ctx.Err() != nil {
		return false
	}
	latest, err := s.readPhotoHostDesired(ctx)
	if err != nil || !latest.Enabled || latest.Revision != desired.Revision {
		return false
	}
	latestGate, present, err := s.readPhotoHostApply(ctx)
	if err != nil || !present || latestGate.Revision != gate.Revision ||
		latestGate.RequestID != gate.RequestID ||
		!photoHostModelInfoAllowed(latest, latestGate, true, s.photoHostApplyReceipt(latestGate)) ||
		!s.photoHostLocalQueueClear() {
		return false
	}
	host, hostOK := s.readPhotoIntelligenceHostStatus()
	control, controlOK := s.readPhotoHostControlStatus()
	return hostOK && controlOK &&
		photoHostModelRequestAckVerified(checks, host, control, latestGate)
}

// Invoked only by explicit administrator preflight after four Info ACKs pass.
// "verified" is ONE synthetic semantic text task on this host, never a
// Face/OCR/Creative/image job result, global activation or stop authorization.
func (s *Server) photoHostSemanticTextProbe(
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
	if !photoHostSemanticProbeGate.TryLock() {
		return "throttled"
	}
	defer photoHostSemanticProbeGate.Unlock()
	if !photoHostSemanticProbeGate.lastAttempt.IsZero() &&
		time.Since(photoHostSemanticProbeGate.lastAttempt) < photoHostSemanticProbeCooldown {
		return "throttled"
	}
	photoHostSemanticProbeGate.lastAttempt = time.Now()
	ctx, cancel := context.WithTimeout(parent, photoHostSemanticProbeTimeout)
	defer cancel()
	if !runPhotoHostSemanticTextInference(
		ctx, checks[2], gate,
		s.PhotoSemanticAnalyzer.EmbedText, s.PhotoSemanticAnalyzer.Info,
	) {
		return "failed"
	}
	if !s.photoHostSemanticEvidenceCurrent(ctx, desired, gate, checks) {
		return "unverified"
	}
	return "verified"
}
