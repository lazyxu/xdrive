package main

import (
	"context"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
	"github.com/lazyxu/xdrive/internal/pullworker"
	"github.com/lazyxu/xdrive/internal/sourceworkerpolicy"
	"gorm.io/gorm"
)

// Called from one Worker event loop only at a completed RunDue boundary.
type sourceWorkerRuntimePolicy struct {
	db             *gorm.DB
	parent         context.Context
	runner         *pullworker.Runner
	scheduler      *background.Scheduler
	scanInterval   time.Duration
	pollInterval   time.Duration
	maxConcurrency int
	revision       uint64
	report         func(sourceWorkerPresenceConfig)
}

func newSourceWorkerScheduler(ctx context.Context, concurrency int) *background.Scheduler {
	cfg := background.DefaultConfig()
	queueCapacity := cfg.QueueCapacity[background.ResourceNetwork]
	cfg.Capacity = map[background.ResourceClass]int{background.ResourceNetwork: concurrency}
	cfg.QueueCapacity = map[background.ResourceClass]int{background.ResourceNetwork: queueCapacity}
	return background.NewScheduler(ctx, cfg)
}

func (w *sourceWorkerRuntimePolicy) presence() sourceWorkerPresenceConfig {
	return sourceWorkerPresenceConfig{
		scanInterval: w.scanInterval, pollInterval: w.pollInterval,
		maxConcurrency: w.maxConcurrency, revision: w.revision,
	}
}

// Completed RunDue batches have awaited all scheduler Handles. Swap capacity
// only at this boundary; never cancel active Pulls to change resource limits.
func (w *sourceWorkerRuntimePolicy) apply(ctx context.Context) (bool, error) {
	next, err := sourceworkerpolicy.Read(ctx, w.db)
	if err != nil {
		return false, err
	}
	if next.Revision <= w.revision {
		return false, nil
	}
	if next.MaxConcurrency != w.maxConcurrency {
		replacement := newSourceWorkerScheduler(w.parent, next.MaxConcurrency)
		old := w.scheduler
		w.scheduler = replacement
		w.runner.Scheduler = replacement
		if old != nil {
			old.Close()
		}
	}
	w.runner.MaxConcurrency = next.MaxConcurrency
	w.scanInterval = time.Duration(next.ScanIntervalSeconds) * time.Second
	w.pollInterval = time.Duration(next.PollIntervalSeconds) * time.Second
	w.maxConcurrency = next.MaxConcurrency
	w.revision = next.Revision
	if w.report != nil {
		w.report(w.presence())
	}
	return true, nil
}
