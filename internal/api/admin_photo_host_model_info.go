package api

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

const photoHostModelInfoTimeout = 2 * time.Second

type photoHostModelInfoCheck struct {
	ID     string `json:"id"`
	State  string `json:"state"`
	Detail string `json:"detail"`
}

type photoHostModelInfoTask struct {
	ID         string
	Configured bool
	Probe      func(context.Context) error
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
		index int
		err   error
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
		go func(index int, check func(context.Context) error) {
			err := check(ctx)
			select {
			case finished <- outcome{index: index, err: err}:
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
				results[next.index].Detail = "本实例分析器 Info 协议与模型元数据验证通过"
			} else {
				results[next.index].State = "failed"
				results[next.index].Detail = "本实例分析器 Info 请求或元数据验证失败"
			}
		}
	}
	return results
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
		tasks[0].Probe = func(ctx context.Context) error {
			info, err := s.PhotoFaceAnalyzer.Info(ctx)
			if err != nil {
				return err
			}
			return photointelligence.ValidateFaceAnalyzerInfo(info)
		}
	}
	if s.PhotoSmartAnalyzer != nil {
		tasks[1].Probe = func(ctx context.Context) error {
			info, err := s.PhotoSmartAnalyzer.Info(ctx)
			if err != nil {
				return err
			}
			return photointelligence.ValidateSmartAnalyzerInfo(info)
		}
	}
	if s.PhotoSemanticAnalyzer != nil {
		tasks[2].Probe = func(ctx context.Context) error {
			info, err := s.PhotoSemanticAnalyzer.Info(ctx)
			if err != nil {
				return err
			}
			return photointelligence.ValidateSemanticAnalyzerInfo(info)
		}
	}
	if s.PhotoCreativeAnalyzer != nil {
		tasks[3].Probe = func(ctx context.Context) error {
			info, err := s.PhotoCreativeAnalyzer.Info(ctx)
			if err != nil {
				return err
			}
			return photointelligence.ValidateCreativeAnalyzerInfo(info)
		}
	}
	return runPhotoHostModelInfoChecks(ctx, tasks)
}
