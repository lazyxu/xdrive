package api

import "context"

// photoAutomaticAdmissionEvidence describes ONLY the current Server's
// automatic-task admission policy. It is never a model deployment/health proof.
type photoAutomaticAdmissionEvidence struct {
	state             string
	desiredRevision   uint64
	effectiveRevision uint64
	globalEnabled     bool
	kinds             photoAutoKinds
}

func (s *Server) photoAutomaticAdmissionEvidence(ctx context.Context) photoAutomaticAdmissionEvidence {
	if s == nil || s.DB == nil {
		return photoAutomaticAdmissionEvidence{state: "unknown"}
	}
	desired, err := photoAutoDesiredSettings(ctx, s.DB)
	if err != nil {
		return photoAutomaticAdmissionEvidence{state: "unknown"}
	}
	return photoAutomaticAdmissionFromRuntime(desired, s.photoAutoPolicy.Load())
}

func photoAutomaticAdmissionFromRuntime(
	desired photoAutoDesired, effective *photoAutoRuntime,
) photoAutomaticAdmissionEvidence {
	proof := photoAutomaticAdmissionEvidence{
		state: "unknown", desiredRevision: desired.Revision,
	}
	if effective != nil {
		proof.effectiveRevision = effective.Revision
	}
	// The default revision 0 is unmanaged, never an audited admin enable.
	if desired.Revision == 0 {
		proof.state = "unmanaged"
		return proof
	}
	if effective == nil ||
		effective.Revision != desired.Revision ||
		effective.AutoEnabled != desired.AutoEnabled ||
		effectivePhotoAutoKinds(effective.Kinds) != effectivePhotoAutoKinds(desired.Kinds) {
		proof.state = "pending"
		return proof
	}
	proof.state = "applied"
	proof.globalEnabled = effective.AutoEnabled
	proof.kinds = effectivePhotoAutoKinds(effective.Kinds)
	return proof
}

// States here are automatic *job admission*, not the analyzer's activation.
// Face detection and person clustering have independent switches, while OCR
// shares the smart-task scheduler. Creative has no automatic-admission switch.
func (p photoAutomaticAdmissionEvidence) stateForService(id string) string {
	switch id {
	case "photo-creative":
		return "not-applicable"
	case "photo-face", "photo-smart", "photo-semantic":
	default:
		return ""
	}
	if p.state != "applied" {
		return p.state
	}
	if !p.globalEnabled {
		return "paused"
	}
	switch id {
	case "photo-face":
		if p.kinds.Face != p.kinds.PersonCluster {
			return "partial"
		}
		if p.kinds.Face {
			return "enabled"
		}
	case "photo-smart":
		if p.kinds.Smart {
			return "enabled"
		}
	case "photo-semantic":
		if p.kinds.Semantic {
			return "enabled"
		}
	}
	return "paused"
}
