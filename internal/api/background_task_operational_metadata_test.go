package api

import (
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/background"
)

func TestAggregateRuntimeBackgroundTasksProjectsOperationalMetadata(t *testing.T) {
	now := time.Date(2026, 10, 7, 6, 0, 0, 0, time.UTC)
	retryLate := now.Add(time.Minute)
	retryEarly := now.Add(30 * time.Second)
	snapshots := []background.RuntimeTaskSnapshot{
		{
			Identity:  background.Identity{Scope: background.ScopeUser, OwnerID: 42, Key: "a"},
			Kind:      "media.index",
			State:     "queued",
			Trigger:   background.TriggerSystemEvent,
			Initiator: background.InitiatorSystem,
			ParentKey: "parent-a",
			TraceID:   "trace-a",
			Priority:  background.PriorityP1,
			Resource:  background.ResourceMediaCPU,
			Attempt:   2,
			UpdatedAt: now,
			ReadyAt:   &retryLate,
		},
		{
			Identity:  background.Identity{Scope: background.ScopeUser, OwnerID: 42, Key: "b"},
			Kind:      "media.index",
			State:     "queued",
			Trigger:   background.TriggerSystemEvent,
			Initiator: background.InitiatorSystem,
			ParentKey: "parent-a",
			TraceID:   "trace-a",
			Priority:  background.PriorityP1,
			Resource:  background.ResourceMediaCPU,
			Attempt:   3,
			UpdatedAt: now.Add(time.Second),
			ReadyAt:   &retryEarly,
		},
	}

	tasks := aggregateRuntimeBackgroundTasks(snapshots, 42, false)
	if len(tasks) != 1 {
		t.Fatalf("runtime groups=%d want=1: %+v", len(tasks), tasks)
	}
	task := tasks[0]
	if task.Attempt != 3 || task.RetryAt == nil || !task.RetryAt.Equal(retryEarly) ||
		task.TraceID != "trace-a" || task.ParentKey != "parent-a" {
		t.Fatalf("unexpected operational metadata: %+v", task)
	}

	snapshots[1].State = "running"
	tasks = aggregateRuntimeBackgroundTasks(snapshots, 42, false)
	task = tasks[0]
	if task.RetryAt == nil || !task.RetryAt.Equal(retryLate) {
		t.Fatalf("running snapshot leaked stale retry_at: %+v", task)
	}

	snapshots[1].TraceID = "trace-b"
	snapshots[1].ParentKey = "parent-b"
	tasks = aggregateRuntimeBackgroundTasks(snapshots, 42, false)
	task = tasks[0]
	if task.TraceID != "" || task.ParentKey != "" {
		t.Fatalf("mixed causal metadata was not suppressed: %+v", task)
	}
}
