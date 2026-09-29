package yikesync

import (
	"context"
	"fmt"

	"github.com/lazyxu/xdrive/internal/client"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

type transferTask struct {
	Plan client.SourcePlan
	Item sourcepkg.DiscoveredItem
	Ref  TransferRef
}

type transferWorkerResult struct {
	Result Result
	Err    error
}

type transferPipeline struct {
	ctx    context.Context
	cancel context.CancelFunc
	tasks  chan transferTask
	done   chan transferWorkerResult
	closed bool
	result *transferWorkerResult
}

func newTransferPipeline(parent context.Context, scanner Scanner, queueSize int) *transferPipeline {
	if queueSize <= 0 {
		queueSize = DefaultTransferQueueSize
	}
	ctx, cancel := context.WithCancel(parent)
	p := &transferPipeline{
		ctx:    ctx,
		cancel: cancel,
		tasks:  make(chan transferTask, queueSize),
		done:   make(chan transferWorkerResult, 1),
	}
	go func() {
		p.done <- scanner.runTransferWorker(ctx, p.tasks)
	}()
	return p
}

func (p *transferPipeline) Submit(task transferTask) error {
	if p == nil {
		return fmt.Errorf("Yike transfer pipeline is unavailable")
	}
	if p.result != nil {
		if p.result.Err != nil {
			return p.result.Err
		}
		return fmt.Errorf("Yike transfer worker stopped unexpectedly")
	}

	select {
	case p.tasks <- task:
		return nil
	case result := <-p.done:
		p.capture(result)
		if result.Err != nil {
			return result.Err
		}
		return fmt.Errorf("Yike transfer worker stopped unexpectedly")
	case <-p.ctx.Done():
		return p.ctx.Err()
	}
}

func (p *transferPipeline) Finish() transferWorkerResult {
	if p == nil {
		return transferWorkerResult{}
	}
	if p.result != nil {
		return *p.result
	}
	if !p.closed {
		close(p.tasks)
		p.closed = true
	}
	result := <-p.done
	p.cancel()
	p.result = &result
	return result
}

func (p *transferPipeline) Abort() {
	if p == nil || p.result != nil {
		return
	}
	p.cancel()
	if !p.closed {
		close(p.tasks)
		p.closed = true
	}
	result := <-p.done
	p.result = &result
}

func (p *transferPipeline) capture(result transferWorkerResult) {
	if !p.closed {
		close(p.tasks)
		p.closed = true
	}
	p.cancel()
	p.result = &result
}

func (s Scanner) runTransferWorker(ctx context.Context, tasks <-chan transferTask) transferWorkerResult {
	var out transferWorkerResult
	for task := range tasks {
		if err := ctx.Err(); err != nil {
			out.Err = err
			return out
		}
		if err := s.API.HeartbeatSourceRun(ctx, s.SourceID, s.RunID); err != nil {
			out.Err = err
			return out
		}

		commit, err := s.Executor.Execute(ctx, task.Plan, task.Item, task.Ref)
		if err != nil {
			if ctx.Err() != nil {
				out.Err = ctx.Err()
				return out
			}
			out.Result.Summary.AddFailure()
			appendResultError(&out.Result, task.Item.ExternalID, task.Item.Path, err)
			if failErr := s.API.FailSourceItems(ctx, s.SourceID, s.RunID, []client.SourceFailure{
				sourceFailure(task.Item.ExternalID, err),
			}); failErr != nil {
				out.Err = failErr
				return out
			}
			continue
		}

		commitFailures, err := s.commitResults(ctx, []client.SourceCommit{commit}, &out.Result)
		if err != nil {
			out.Err = err
			return out
		}
		if len(commitFailures) != 0 {
			if err := s.API.FailSourceItems(ctx, s.SourceID, s.RunID, commitFailures); err != nil {
				out.Err = err
				return out
			}
		}
		if err := s.API.HeartbeatSourceRun(ctx, s.SourceID, s.RunID); err != nil {
			out.Err = err
			return out
		}
	}
	return out
}

func mergeTransferResult(result *Result, worker transferWorkerResult) {
	if result == nil {
		return
	}
	result.Summary.FailedItems += worker.Result.Summary.FailedItems
	for _, message := range worker.Result.Errors {
		if len(result.Errors) >= 5 {
			break
		}
		result.Errors = append(result.Errors, message)
	}
}
