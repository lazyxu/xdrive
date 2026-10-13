package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

const photoHostModelInfoTimeout = 2 * time.Second

type photoHostModelInfoCheck struct {
	ID                string                              `json:"id"`
	State             string                              `json:"state"`
	Detail            string                              `json:"detail"`
	runtimeInstanceID string                              // private process-boot marker: never serialized to admin UI
	hostReceipt       *photointelligence.HostApplyReceipt // never serialized to admin UI
}

type photoHostModelInfoEvidence struct {
	instanceID string
	receipt    *photointelligence.HostApplyReceipt
}

type photoHostModelInfoTask struct {
	ID           string
	Configured   bool
	Probe        func(context.Context) (string, error) // legacy test fixture path
	ReceiptProbe func(context.Context) (photoHostModelInfoEvidence, error)
}

func unverifiedPhotoHostModelInfoChecks() []photoHostModelInfoCheck {
	return []photoHostModelInfoCheck{
		{ID: "photo-face", State: "unknown", Detail: "宿主修订未核验，未执行模型检测"},
		{ID: "photo-smart", State: "unknown", Detail: "宿主修订未核验，未执行模型检测"},
		{ID: "photo-semantic", State: "unknown", Detail: "宿主修订未核验，未执行模型检测"},
		{ID: "photo-creative", State: "unknown", Detail: "宿主修订未核验，未执行模型检测"},
	}
}

// Saved intent or container health alone never proves the audited operation.
func photoHostModelInfoAllowed(desired photoHostDesired, gate meta.AdminPhotoHostApply, present bool, receipt string) bool {
	return present && desired.Revision > 0 && desired.Enabled &&
		gate.State == "host-verified" && gate.Revision == desired.Revision &&
		photoHostControlRequestID.MatchString(gate.RequestID) && receipt == "host-verified"
}

// Four fixed, parallel and bounded read-only Info callbacks. An expired result
// cannot turn unknown into ready; raw upstream errors are never serialized.
func runPhotoHostModelInfoChecks(parent context.Context, tasks []photoHostModelInfoTask) []photoHostModelInfoCheck {
	results := make([]photoHostModelInfoCheck, len(tasks))
	ctx, cancel := context.WithTimeout(parent, photoHostModelInfoTimeout)
	defer cancel()
	type outcome struct {
		index      int
		instanceID string
		receipt    *photointelligence.HostApplyReceipt
		err        error
	}
	finished := make(chan outcome, len(tasks))
	pending := 0
	for i, task := range tasks {
		results[i] = photoHostModelInfoCheck{ID: task.ID, State: "unknown", Detail: "模型实际 Info 尚未核验"}
		if !task.Configured {
			results[i].State = "unconfigured"
			results[i].Detail = "当前 Server 未配置此分析器"
			continue
		}
		if task.Probe == nil && task.ReceiptProbe == nil {
			continue
		}
		pending++
		go func(index int, legacy func(context.Context) (string, error),
			attested func(context.Context) (photoHostModelInfoEvidence, error)) {
			var instanceID string
			var receipt *photointelligence.HostApplyReceipt
			var err error
			if attested != nil {
				var evidence photoHostModelInfoEvidence
				evidence, err = attested(ctx)
				instanceID, receipt = evidence.instanceID, evidence.receipt
			} else {
				instanceID, err = legacy(ctx)
			}
			select {
			case finished <- outcome{index: index, instanceID: instanceID, receipt: receipt, err: err}:
			case <-ctx.Done():
			}
		}(i, task.Probe, task.ReceiptProbe)
	}
	for pending > 0 {
		select {
		case <-ctx.Done():
			return results
		case next := <-finished:
			pending--
			if ctx.Err() != nil {
				return results
			}
			if next.err == nil {
				results[next.index].State = "ready"
				results[next.index].runtimeInstanceID = next.instanceID
				results[next.index].hostReceipt = next.receipt
				results[next.index].Detail = "本实例分析器 Info 协议与模型元数据验证通过"
			} else {
				results[next.index].State = "failed"
				results[next.index].Detail = "本实例分析器 Info 请求或元数据验证失败"
			}
		}
	}
	return results
}

// All four fixed Info paths must report the same valid process-boot session.
// This is self-reported local coherence, never host-token binding or task proof.
func photoHostModelInstanceCoherent(checks []photoHostModelInfoCheck) bool {
	ids := [...]string{"photo-face", "photo-smart", "photo-semantic", "photo-creative"}
	if len(checks) != len(ids) {
		return false
	}
	session := checks[0].runtimeInstanceID
	if !photointelligence.ValidAnalyzerRuntimeInstanceID(session) {
		return false
	}
	for i, id := range ids {
		if checks[i].ID != id || checks[i].State != "ready" || checks[i].runtimeInstanceID != session {
			return false
		}
	}
	return true
}

// This comparison corroborates Docker's fixed-container healthcheck output
// with the current Server's four model Info replies. Both come from the
// shared socket; it does NOT prove kernel-level socket/process ownership,
// durable Host Manager request identity or a real model task execution.
func photoHostDockerHealthcheckMatched(checks []photoHostModelInfoCheck, host photoIntelligenceHostStatus) bool {
	if !photoHostModelInstanceCoherent(checks) ||
		host.State != "healthy" || !host.ProfileConfigured ||
		!validPhotoIntelligenceHealthDigest(host.sessionDigest) {
		return false
	}
	sum := sha256.Sum256([]byte(checks[0].runtimeInstanceID))
	return host.sessionDigest == hex.EncodeToString(sum[:])
}

// Kernel evidence of the fixed Docker main PID's listening Socket FD is
// additive to, never a replacement for, four Info + healthcheck coherence.
func photoHostDockerSocketOwnerVerified(checks []photoHostModelInfoCheck, host photoIntelligenceHostStatus) bool {
	return host.socketOwned && photoHostDockerHealthcheckMatched(checks, host)
}

// A fixed Host Manager seals one model-generation digest at the completion of
// its already audited enable-only request. Re-check that exact immutable
// request/revision association against the CURRENT fixed-container
// healthcheck, kernel-owned listener and four-model Info generation.
// This is time-bound corroboration, NOT model-side request-token attestation,
// real task effect, fleet readiness or safe disable authorization.
func photoHostRequestGenerationCorrelated(
	checks []photoHostModelInfoCheck,
	host photoIntelligenceHostStatus,
	control photoHostControlStatus,
	gate meta.AdminPhotoHostApply,
) bool {
	return control.Supported && gate.State == "host-verified" && gate.Revision > 0 &&
		control.State == "success" && control.Enabled && control.ProfileVerified &&
		control.ObservedHostState == "healthy" &&
		control.Revision == gate.Revision && control.AppliedRevision == gate.Revision &&
		control.RequestID == gate.RequestID && photoHostControlRequestID.MatchString(gate.RequestID) &&
		validPhotoIntelligenceHealthDigest(control.AppliedInstanceDigest) &&
		control.AppliedInstanceDigest == host.sessionDigest &&
		photoHostDockerSocketOwnerVerified(checks, host)
}

// The trusted fixed Host Manager observed a request-specific model receipt,
// and ALL four read-only model Info responses echo its exact revision/token.
// This proves only request acknowledgment by one current process, not a real
// model task result, a fleet rollout, or permission to stop the host.
func photoHostModelRequestAckVerified(
	checks []photoHostModelInfoCheck,
	host photoIntelligenceHostStatus,
	control photoHostControlStatus,
	gate meta.AdminPhotoHostApply,
) bool {
	if !control.ModelAckAtApply ||
		!photoHostRequestGenerationCorrelated(checks, host, control, gate) {
		return false
	}
	for _, item := range checks {
		receipt := item.hostReceipt
		if receipt == nil || receipt.Revision != gate.Revision ||
			receipt.RequestID != gate.RequestID ||
			!photointelligence.ValidAnalyzerHostRequestID(receipt.RequestID) {
			return false
		}
	}
	return true
}

func (s *Server) probePhotoHostModelInfo(ctx context.Context) []photoHostModelInfoCheck {
	if s == nil {
		return unverifiedPhotoHostModelInfoChecks()
	}
	tasks := []photoHostModelInfoTask{
		{ID: "photo-face", Configured: s.PhotoFaceAnalyzer != nil},
		{ID: "photo-smart", Configured: s.PhotoSmartAnalyzer != nil},
		{ID: "photo-semantic", Configured: s.PhotoSemanticAnalyzer != nil},
		{ID: "photo-creative", Configured: s.PhotoCreativeAnalyzer != nil},
	}
	if s.PhotoFaceAnalyzer != nil {
		tasks[0].ReceiptProbe = func(ctx context.Context) (photoHostModelInfoEvidence, error) {
			info, err := s.PhotoFaceAnalyzer.Info(ctx)
			if err != nil {
				return photoHostModelInfoEvidence{}, err
			}
			if err := photointelligence.ValidateFaceAnalyzerInfo(info); err != nil {
				return photoHostModelInfoEvidence{}, err
			}
			return photoHostModelInfoEvidence{instanceID: info.RuntimeInstanceID, receipt: info.HostApplyReceipt}, nil
		}
	}
	if s.PhotoSmartAnalyzer != nil {
		tasks[1].ReceiptProbe = func(ctx context.Context) (photoHostModelInfoEvidence, error) {
			info, err := s.PhotoSmartAnalyzer.Info(ctx)
			if err != nil {
				return photoHostModelInfoEvidence{}, err
			}
			if err := photointelligence.ValidateSmartAnalyzerInfo(info); err != nil {
				return photoHostModelInfoEvidence{}, err
			}
			return photoHostModelInfoEvidence{instanceID: info.RuntimeInstanceID, receipt: info.HostApplyReceipt}, nil
		}
	}
	if s.PhotoSemanticAnalyzer != nil {
		tasks[2].ReceiptProbe = func(ctx context.Context) (photoHostModelInfoEvidence, error) {
			info, err := s.PhotoSemanticAnalyzer.Info(ctx)
			if err != nil {
				return photoHostModelInfoEvidence{}, err
			}
			if err := photointelligence.ValidateSemanticAnalyzerInfo(info); err != nil {
				return photoHostModelInfoEvidence{}, err
			}
			return photoHostModelInfoEvidence{instanceID: info.RuntimeInstanceID, receipt: info.HostApplyReceipt}, nil
		}
	}
	if s.PhotoCreativeAnalyzer != nil {
		tasks[3].ReceiptProbe = func(ctx context.Context) (photoHostModelInfoEvidence, error) {
			info, err := s.PhotoCreativeAnalyzer.Info(ctx)
			if err != nil {
				return photoHostModelInfoEvidence{}, err
			}
			if err := photointelligence.ValidateCreativeAnalyzerInfo(info); err != nil {
				return photoHostModelInfoEvidence{}, err
			}
			return photoHostModelInfoEvidence{instanceID: info.RuntimeInstanceID, receipt: info.HostApplyReceipt}, nil
		}
	}
	return runPhotoHostModelInfoChecks(ctx, tasks)
}
