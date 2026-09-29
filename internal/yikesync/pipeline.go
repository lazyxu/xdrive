package yikesync

import (
	"context"
	"fmt"
	"sync"

	"github.com/lazyxu/xdrive/internal/client"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

type transferTask struct {
	Plan client.SourcePlan
	Item sourcepkg.DiscoveredItem
	Ref  TransferRef
}

type transferFailure struct {
	ExternalID string
	Path       string
	Err        error
}

type transferOutcome struct {
	FailedItems int64
	Failures    []transferFailure
}

type transferPipeline struct {
	ctx       context.Context
	cancel    context.CancelCauseFunc
	scanner   Scanner
	tasks     chan transferTask
	done      chan struct{}
	closeOnce sync.Once
	outcome   transferOutcome
}

func newTransferPipeline(parent context.Context, scanner Scanner, queueSize int) *transferPipeline {
	ctx, cancel := context.WithCancelCause(parent)
	p := &transferPipeline{
		ctx:     ctx,
		cancel:  cancel,
		scanner: scanner,
		tasks:   make(chan transferTask, queueSize),
		done:    make(chan struct{}),
	}
	go p.run()
	return p
}

func (p *transferPipeline) Context() context.Context {
	return p.ctx
}

func (p *transferPipeline) Cause() error {
	return context.Cause(p.ctx)
}

func (p *transferPipeline) Enqueue(task transferTask) error {
	select {
	case <-p.ctx.Done():
		return context.Cause(p.ctx)
	case p.tasks <- task:
		return nil
	}
}

func (p *transferPipeline) Finish() (transferOutcome, error) {
	p.closeInput()
	<-p.done
	if cause := context.Cause(p.ctx); cause != nil {
		return p.outcome, cause
	}
	return p.outcome, nil
}

func (p *transferPipeline) Abort() {
	select {
	case <-p.done:
		return
	default:
	}
	p.cancel(context.Canceled)
	p.closeInput()
	<-p.done
}

func (p *transferPipeline) closeInput() {
	p.closeOnce.Do(func() {
		close(p.tasks)
	})
}

func (p *transferPipeline) run() {
	defer close(p.done)
	for {
		select {
		case <-p.ctx.Done():
			return
		case task, ok := <-p.tasks:
			if !ok {
				return
			}
			if err := p.execute(task); err != nil {
				p.cancel(err)
				return
			}
		}
	}
}

func (p *transferPipeline) execute(task transferTask) error {
	if err := p.scanner.API.HeartbeatSourceRun(p.ctx, p.scanner.SourceID, p.scanner.RunID); err != nil {
		return fmt.Errorf("heartbeat before %s: %w", task.Item.Path, err)
	}
	commit, err := p.scanner.Executor.Execute(p.ctx, task.Plan, task.Item, task.Ref)
	if err != nil {
		if p.ctx.Err() != nil {
			return context.Cause(p.ctx)
		}
		p.recordFailure(task, err)
		if failErr := p.scanner.API.FailSourceItems(
			p.ctx,
			p.scanner.SourceID,
			p.scanner.RunID,
			[]client.SourceFailure{sourceFailure(task.Item.ExternalID, err)},
		); failErr != nil {
			return fmt.Errorf("report failed Yike item %s: %w", task.Item.Path, failErr)
		}
		return nil
	}
	if err := p.scanner.API.HeartbeatSourceRun(p.ctx, p.scanner.SourceID, p.scanner.RunID); err != nil {
		return fmt.Errorf("heartbeat after %s: %w", task.Item.Path, err)
	}
	if err := p.commit(commit); err != nil {
		if p.ctx.Err() != nil {
			return context.Cause(p.ctx)
		}
		p.recordFailure(task, err)
		if failErr := p.scanner.API.FailSourceItems(
			p.ctx,
			p.scanner.SourceID,
			p.scanner.RunID,
			[]client.SourceFailure{sourceFailure(task.Item.ExternalID, err)},
		); failErr != nil {
			return fmt.Errorf("report failed Yike commit %s: %w", task.Item.Path, failErr)
		}
	}
	return nil
}

func (p *transferPipeline) commit(commit client.SourceCommit) error {
	var last error
	for attempt := 0; attempt < 2; attempt++ {
		if err := p.scanner.API.CommitSourceItems(
			p.ctx,
			p.scanner.SourceID,
			p.scanner.RunID,
			[]client.SourceCommit{commit},
		); err == nil {
			return nil
		} else {
			last = err
		}
		if p.ctx.Err() != nil {
			return context.Cause(p.ctx)
		}
	}
	return last
}

func (p *transferPipeline) recordFailure(task transferTask, err error) {
	p.outcome.FailedItems++
	if len(p.outcome.Failures) >= 5 {
		return
	}
	p.outcome.Failures = append(p.outcome.Failures, transferFailure{
		ExternalID: task.Item.ExternalID,
		Path:       task.Item.Path,
		Err:        err,
	})
}
