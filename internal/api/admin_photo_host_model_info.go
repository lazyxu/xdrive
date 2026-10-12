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
	ID                string `json:"id"`
	State             string `json:"state"`
	Detail            string `json:"detail"`
	runtimeInstanceID string // private process-boot marker: never serialized to admin UI
}

type photoHostModelInfoTask struct {
	ID         string
	Configured bool
	Probe      func(context.Context) (string, error)
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
		if task.Probe == nil {
			continue
		}
		pending++
		go func(index int, check func(context.Context) (string, error)) {
			instanceID, err := check(ctx)
			select {
			case finished <- outcome{index: index, instanceID: instanceID, err: err}:
			case <-ctx.Done():
			}
		}(i, task.Probe)
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
		tasks[0].Probe = func(ctx context.Context) (string, error) {
			info, err := s.PhotoFaceAnalyzer.Info(ctx)
			if err != nil {
				return "", err
			}
			if err := photointelligence.ValidateFaceAnalyzerInfo(info); err != nil {
				return "", err
			}
			return info.RuntimeInstanceID, nil
		}
	}
	if s.PhotoSmartAnalyzer != nil {
		tasks[1].Probe = func(ctx context.Context) (string, error) {
			info, err := s.PhotoSmartAnalyzer.Info(ctx)
			if err != nil {
				return "", err
			}
			if err := photointelligence.ValidateSmartAnalyzerInfo(info); err != nil {
				return "", err
			}
			return info.RuntimeInstanceID, nil
		}
	}
	if s.PhotoSemanticAnalyzer != nil {
		tasks[2].Probe = func(ctx context.Context) (string, error) {
			info, err := s.PhotoSemanticAnalyzer.Info(ctx)
			if err != nil {
				return "", err
			}
			if err := photointelligence.ValidateSemanticAnalyzerInfo(info); err != nil {
				return "", err
			}
			return info.RuntimeInstanceID, nil
		}
	}
	if s.PhotoCreativeAnalyzer != nil {
		tasks[3].Probe = func(ctx context.Context) (string, error) {
			info, err := s.PhotoCreativeAnalyzer.Info(ctx)
			if err != nil {
				return "", err
			}
			if err := photointelligence.ValidateCreativeAnalyzerInfo(info); err != nil {
				return "", err
			}
			return info.RuntimeInstanceID, nil
		}
	}
	return runPhotoHostModelInfoChecks(ctx, tasks)
}
