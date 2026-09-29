package pullsync

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/client"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
)

type RunAPI interface {
	CommitSourceItems(context.Context, uint64, string, []client.SourceCommit) error
	FailSourceItems(context.Context, uint64, string, []client.SourceFailure) error
	HeartbeatSourceRun(context.Context, uint64, string) error
}

func ExecutionAction(action sourcepkg.PlanAction) bool {
	switch action {
	case sourcepkg.ActionCreate, sourcepkg.ActionUpdate, sourcepkg.ActionMove, sourcepkg.ActionMoveUpdate:
		return true
	default:
		return false
	}
}

type PlanExecutor[Ref any] interface {
	Execute(context.Context, client.SourcePlan, sourcepkg.DiscoveredItem, Ref) (client.SourceCommit, error)
}

type Task[Ref any] struct {
	Plan client.SourcePlan
	Item sourcepkg.DiscoveredItem
	Ref  Ref
}

type WorkerResult struct {
	Summary sourcepkg.Summary
	Errors  []string
	Err     error
}

type Pipeline[Ref any] struct {
	ctx      context.Context
	cancel   context.CancelFunc
	tasks    chan Task[Ref]
	done     chan WorkerResult
	closed   bool
	result   *WorkerResult
	label    string
	sourceID uint64
	runID    string
	api      RunAPI
	executor PlanExecutor[Ref]
}

func NewPipeline[Ref any](
	parent context.Context,
	queueSize int,
	label string,
	sourceID uint64,
	runID string,
	api RunAPI,
	executor PlanExecutor[Ref],
) *Pipeline[Ref] {
	if queueSize <= 0 {
		queueSize = 64
	}
	ctx, cancel := context.WithCancel(parent)
	p := &Pipeline[Ref]{
		ctx: ctx, cancel: cancel,
		tasks:    make(chan Task[Ref], queueSize),
		done:     make(chan WorkerResult, 1),
		label:    strings.TrimSpace(label),
		sourceID: sourceID, runID: runID,
		api: api, executor: executor,
	}
	go func() {
		p.done <- p.runWorker(ctx)
	}()
	return p
}

func (p *Pipeline[Ref]) Submit(plan client.SourcePlan, item sourcepkg.DiscoveredItem, ref Ref) error {
	if p == nil {
		return fmt.Errorf("pull transfer pipeline is unavailable")
	}
	if p.result != nil {
		if p.result.Err != nil {
			return p.result.Err
		}
		return fmt.Errorf("%s transfer worker stopped unexpectedly", p.connectorLabel())
	}
	task := Task[Ref]{Plan: plan, Item: item, Ref: ref}
	select {
	case p.tasks <- task:
		return nil
	case result := <-p.done:
		p.capture(result)
		if result.Err != nil {
			return result.Err
		}
		return fmt.Errorf("%s transfer worker stopped unexpectedly", p.connectorLabel())
	case <-p.ctx.Done():
		return p.ctx.Err()
	}
}

func (p *Pipeline[Ref]) Finish() WorkerResult {
	if p == nil {
		return WorkerResult{}
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

func (p *Pipeline[Ref]) Abort() {
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

func (p *Pipeline[Ref]) capture(result WorkerResult) {
	if !p.closed {
		close(p.tasks)
		p.closed = true
	}
	p.cancel()
	p.result = &result
}

func (p *Pipeline[Ref]) runWorker(ctx context.Context) WorkerResult {
	var out WorkerResult
	if p.api == nil || p.executor == nil || p.sourceID == 0 || strings.TrimSpace(p.runID) == "" {
		out.Err = fmt.Errorf("%s transfer worker is not configured", p.connectorLabel())
		return out
	}
	for task := range p.tasks {
		if err := ctx.Err(); err != nil {
			out.Err = err
			return out
		}
		if err := p.api.HeartbeatSourceRun(ctx, p.sourceID, p.runID); err != nil {
			out.Err = err
			return out
		}
		commit, err := p.executor.Execute(ctx, task.Plan, task.Item, task.Ref)
		if err != nil {
			if ctx.Err() != nil {
				out.Err = ctx.Err()
				return out
			}
			out.Summary.AddFailure()
			appendError(&out.Errors, task.Item.ExternalID, task.Item.Path, err)
			if failErr := p.api.FailSourceItems(ctx, p.sourceID, p.runID, []client.SourceFailure{
				sourceFailure(task.Item.ExternalID, err),
			}); failErr != nil {
				out.Err = failErr
				return out
			}
			continue
		}
		commitFailures, err := p.commitResults(ctx, []client.SourceCommit{commit}, &out)
		if err != nil {
			out.Err = err
			return out
		}
		if len(commitFailures) != 0 {
			if err := p.api.FailSourceItems(ctx, p.sourceID, p.runID, commitFailures); err != nil {
				out.Err = err
				return out
			}
		}
		if err := p.api.HeartbeatSourceRun(ctx, p.sourceID, p.runID); err != nil {
			out.Err = err
			return out
		}
	}
	return out
}

func (p *Pipeline[Ref]) commitResults(ctx context.Context, commits []client.SourceCommit, result *WorkerResult) ([]client.SourceFailure, error) {
	if err := p.api.CommitSourceItems(ctx, p.sourceID, p.runID, commits); err == nil {
		return nil, nil
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	failures := make([]client.SourceFailure, 0)
	for _, commit := range commits {
		if err := p.api.CommitSourceItems(ctx, p.sourceID, p.runID, []client.SourceCommit{commit}); err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			result.Summary.AddFailure()
			appendError(&result.Errors, commit.ExternalID, commit.Path, err)
			failures = append(failures, sourceFailure(commit.ExternalID, err))
		}
	}
	return failures, nil
}

func (p *Pipeline[Ref]) connectorLabel() string {
	if p == nil || p.label == "" {
		return "pull"
	}
	return p.label
}

func sourceFailure(externalID string, err error) client.SourceFailure {
	message := "source item execution failed"
	if err != nil && strings.TrimSpace(err.Error()) != "" {
		message = strings.TrimSpace(err.Error())
	}
	return client.SourceFailure{ExternalID: externalID, Error: trimUTF8Bytes(message, 4<<10)}
}

func appendError(errorsOut *[]string, externalID, itemPath string, err error) {
	if errorsOut == nil || err == nil || len(*errorsOut) >= 5 {
		return
	}
	*errorsOut = append(*errorsOut, trimUTF8Bytes(
		fmt.Sprintf("%s (%s): %v", externalID, itemPath, err), 1024,
	))
}

func trimUTF8Bytes(value string, maxBytes int) string {
	if maxBytes <= 0 || len([]byte(value)) <= maxBytes {
		return value
	}
	for len(value) > 0 && len([]byte(value)) > maxBytes {
		_, size := utf8.DecodeLastRuneInString(value)
		if size <= 0 {
			break
		}
		value = value[:len(value)-size]
	}
	return value
}
