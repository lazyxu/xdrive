package transfer

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sync"
	"time"
)

const DefaultHistoryLimit = 200

const (
	StateQueued     = "queued"
	StateRunning    = "running"
	StateCompleted  = "completed"
	StatePartial    = "partial"
	StateFailed     = "failed"
	StateRetrying   = "retrying"
	StateCancelling = "cancelling"
	StateCancelled  = "cancelled"
)

const (
	ScopeItem  = "item"
	ScopeGroup = "group"
)

const (
	PhaseScanning     = "scanning"
	PhaseQueued       = "queued"
	PhaseTransferring = "transferring"
	PhaseFinalizing   = "finalizing"
)

const (
	KindUpload      = "upload"
	KindDownload    = "download"
	KindHydration   = "hydration"
	KindDehydration = "dehydration"
)

type RetryFunc func(context.Context) error

type Spec struct {
	FileName       string
	Path           string
	RelativePath   string
	Kind           string
	Direction      string
	ParentID       string
	RootID         string
	Scope          string
	Phase          string
	ScanComplete   bool
	TotalBytes     int64
	TotalItems     int64
	CompletedItems int64
	FailedItems    int64
	RunningItems   int64
	QueuedItems    int64
	Retry          RetryFunc
}

type GroupProgress struct {
	Phase          string
	ScanComplete   bool
	BytesDone      int64
	BytesTotal     int64
	TotalItems     int64
	CompletedItems int64
	FailedItems    int64
	RunningItems   int64
	QueuedItems    int64
}

type Task struct {
	ID                    string     `json:"id"`
	ParentID              string     `json:"parent_id,omitempty"`
	RootID                string     `json:"root_id"`
	Scope                 string     `json:"scope"`
	Phase                 string     `json:"phase,omitempty"`
	ScanComplete          bool       `json:"scan_complete"`
	FileName              string     `json:"file_name"`
	Path                  string     `json:"path,omitempty"`
	RelativePath          string     `json:"relative_path,omitempty"`
	Kind                  string     `json:"kind"`
	Direction             string     `json:"direction"`
	State                 string     `json:"state"`
	BytesDone             int64      `json:"bytes_done"`
	BytesTotal            int64      `json:"bytes_total"`
	Percent               float64    `json:"percent"`
	ItemsTotal            int64      `json:"items_total"`
	ItemsCompleted        int64      `json:"items_completed"`
	ItemsFailed           int64      `json:"items_failed"`
	ItemsRunning          int64      `json:"items_running"`
	ItemsQueued           int64      `json:"items_queued"`
	InstantBytesPerSecond float64    `json:"instant_bytes_per_second"`
	AverageBytesPerSecond float64    `json:"average_bytes_per_second"`
	ElapsedMilliseconds   int64      `json:"elapsed_ms"`
	Error                 string     `json:"error,omitempty"`
	RetryCount            int        `json:"retry_count"`
	Retryable             bool       `json:"retryable"`
	StartedAt             time.Time  `json:"started_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
	CompletedAt           *time.Time `json:"completed_at,omitempty"`
}

type entry struct {
	task          Task
	retry         RetryFunc
	lastBytes     int64
	lastAt        time.Time
	rateBaseBytes int64
	rateStartedAt time.Time
}

type Manager struct {
	mu       sync.Mutex
	nextID   uint64
	revision uint64
	changed  chan struct{}
	limit    int
	order    []string
	entries  map[string]*entry
}

type Handle struct {
	manager *Manager
	id      string
}

func NewManager(limit int) *Manager {
	if limit <= 0 {
		limit = DefaultHistoryLimit
	}
	return &Manager{
		revision: 1,
		changed:  make(chan struct{}),
		limit:    limit,
		entries:  make(map[string]*entry),
	}
}

func (m *Manager) Start(spec Spec) *Handle {
	if m == nil {
		return nil
	}
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextID++
	id := fmt.Sprintf("transfer-%d", m.nextID)
	total := max64(spec.TotalBytes, 0)
	scope := spec.Scope
	if scope != ScopeGroup {
		scope = ScopeItem
	}
	rootID := spec.RootID
	if rootID == "" {
		if spec.ParentID != "" {
			rootID = spec.ParentID
		} else {
			rootID = id
		}
	}
	phase := spec.Phase
	if phase == "" {
		if scope == ScopeGroup {
			phase = PhaseScanning
		} else {
			phase = PhaseTransferring
		}
	}
	state := StateRunning
	if phase == PhaseQueued {
		state = StateQueued
	}
	itemsTotal := max64(spec.TotalItems, 0)
	itemsCompleted := max64(spec.CompletedItems, 0)
	itemsFailed := max64(spec.FailedItems, 0)
	itemsRunning := max64(spec.RunningItems, 0)
	itemsQueued := max64(spec.QueuedItems, 0)
	scanComplete := spec.ScanComplete
	if scope == ScopeItem {
		scanComplete = true
		if itemsTotal == 0 {
			itemsTotal = 1
		}
		if state == StateQueued && itemsQueued == 0 {
			itemsQueued = 1
		}
		if state == StateRunning && itemsRunning == 0 {
			itemsRunning = 1
		}
	}
	item := Task{
		ID:             id,
		ParentID:       spec.ParentID,
		RootID:         rootID,
		Scope:          scope,
		Phase:          phase,
		ScanComplete:   scanComplete,
		FileName:       spec.FileName,
		Path:           spec.Path,
		RelativePath:   spec.RelativePath,
		Kind:           spec.Kind,
		Direction:      spec.Direction,
		State:          state,
		BytesTotal:     total,
		ItemsTotal:     itemsTotal,
		ItemsCompleted: itemsCompleted,
		ItemsFailed:    itemsFailed,
		ItemsRunning:   itemsRunning,
		ItemsQueued:    itemsQueued,
		Retryable:      spec.Retry != nil,
		StartedAt:      now,
		UpdatedAt:      now,
	}
	m.entries[id] = &entry{task: item, retry: spec.Retry, lastAt: now, rateStartedAt: now}
	m.order = append(m.order, id)
	m.trimLocked()
	m.touchLocked()
	return &Handle{manager: m, id: id}
}

func (m *Manager) StartGroup(spec Spec) *Handle {
	spec.Scope = ScopeGroup
	if spec.Phase == "" {
		spec.Phase = PhaseScanning
	}
	return m.Start(spec)
}

func (m *Manager) StartChild(parent *Handle, spec Spec) *Handle {
	if m == nil || parent == nil || parent.manager != m {
		return nil
	}
	spec.Scope = ScopeItem
	spec.ParentID = parent.ID()
	if spec.RootID == "" {
		spec.RootID = parent.ID()
		m.mu.Lock()
		if e := m.entries[parent.ID()]; e != nil && e.task.RootID != "" {
			spec.RootID = e.task.RootID
		}
		m.mu.Unlock()
	}
	if spec.Phase == "" {
		spec.Phase = PhaseTransferring
	}
	return m.Start(spec)
}

func (h *Handle) ID() string {
	if h == nil {
		return ""
	}
	return h.id
}

func (h *Handle) SetPhase(phase string) {
	if h == nil || h.manager == nil || phase == "" {
		return
	}
	h.manager.setPhase(h.id, phase)
}

func (h *Handle) UpdateGroup(progress GroupProgress) {
	if h == nil || h.manager == nil {
		return
	}
	h.manager.updateGroup(h.id, progress)
}

func (h *Handle) Progress(done, total int64) {
	if h == nil || h.manager == nil {
		return
	}
	h.manager.progress(h.id, done, total)
}

func (h *Handle) Baseline(done, total int64) {
	if h == nil || h.manager == nil {
		return
	}
	h.manager.baseline(h.id, done, total)
}

func (h *Handle) Add(delta int64) {
	if h == nil || h.manager == nil || delta <= 0 {
		return
	}
	h.manager.mu.Lock()
	e := h.manager.entries[h.id]
	if e == nil {
		h.manager.mu.Unlock()
		return
	}
	done := e.task.BytesDone + delta
	total := e.task.BytesTotal
	h.manager.mu.Unlock()
	h.Progress(done, total)
}

func (h *Handle) Complete() {
	if h == nil || h.manager == nil {
		return
	}
	h.manager.finish(h.id, nil)
}

func (h *Handle) CompleteSkipped() {
	if h == nil || h.manager == nil {
		return
	}
	h.manager.finishSkipped(h.id)
}

func (h *Handle) Fail(err error) {
	if h == nil || h.manager == nil {
		return
	}
	if err == nil {
		err = errors.New("transfer failed")
	}
	h.manager.finish(h.id, err)
}

func (m *Manager) Clear() {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.entries) == 0 && len(m.order) == 0 {
		return
	}
	m.entries = make(map[string]*entry)
	m.order = nil
	m.touchLocked()
}

func (m *Manager) ClearHistory() {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.order) == 0 {
		return
	}

	kept := m.order[:0]
	changed := false
	for _, id := range m.order {
		e := m.entries[id]
		if e == nil {
			changed = true
			continue
		}
		if terminalState(e.task.State) {
			delete(m.entries, id)
			changed = true
			continue
		}
		kept = append(kept, id)
	}
	if !changed {
		return
	}
	m.order = kept
	m.touchLocked()
}

func (m *Manager) Snapshot() (uint64, []Task) {
	if m == nil {
		return 0, nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.revision, m.snapshotLocked()
}

func (m *Manager) Wait(ctx context.Context, after uint64) (uint64, []Task, bool) {
	if m == nil {
		return 0, nil, false
	}
	for {
		m.mu.Lock()
		revision := m.revision
		if revision != after {
			items := m.snapshotLocked()
			m.mu.Unlock()
			return revision, items, true
		}
		changed := m.changed
		m.mu.Unlock()
		select {
		case <-ctx.Done():
			revision, items := m.Snapshot()
			return revision, items, false
		case <-changed:
		}
	}
}

func (m *Manager) Retry(ctx context.Context, id string) error {
	if m == nil {
		return errors.New("transfer manager is unavailable")
	}
	now := time.Now()
	m.mu.Lock()
	e := m.entries[id]
	if e == nil {
		m.mu.Unlock()
		return errors.New("transfer not found")
	}
	if e.task.State != StateFailed {
		m.mu.Unlock()
		return errors.New("only failed transfers can be retried")
	}
	if e.retry == nil {
		m.mu.Unlock()
		return errors.New("transfer is not retryable")
	}
	retry := e.retry
	e.task.State = StateRetrying
	e.task.Phase = PhaseTransferring
	e.task.Error = ""
	e.task.RetryCount++
	e.task.BytesDone = 0
	e.task.Percent = 0
	if e.task.Scope == ScopeItem {
		e.task.ItemsCompleted = 0
		e.task.ItemsFailed = 0
		e.task.ItemsRunning = 1
		e.task.ItemsQueued = 0
	}
	e.task.InstantBytesPerSecond = 0
	e.task.AverageBytesPerSecond = 0
	e.task.ElapsedMilliseconds = 0
	e.task.CompletedAt = nil
	e.task.StartedAt = now
	e.task.UpdatedAt = now
	e.lastBytes = 0
	e.lastAt = now
	e.rateBaseBytes = 0
	e.rateStartedAt = now
	m.touchLocked()
	m.mu.Unlock()

	err := retry(ctx)
	if err != nil {
		m.finish(id, err)
		return err
	}
	m.finish(id, nil)
	return nil
}

func (m *Manager) setPhase(id, phase string) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.entries[id]
	if e == nil || phase == "" {
		return
	}
	if e.task.Phase == phase {
		return
	}
	e.task.Phase = phase
	if phase == PhaseQueued && e.task.State == StateRunning {
		e.task.State = StateQueued
	} else if phase == PhaseTransferring && e.task.State == StateQueued {
		e.task.State = StateRunning
	}
	e.task.UpdatedAt = now
	e.task.ElapsedMilliseconds = now.Sub(e.task.StartedAt).Milliseconds()
	m.touchLocked()
}

func (m *Manager) updateGroup(id string, progress GroupProgress) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.entries[id]
	if e == nil || e.task.Scope != ScopeGroup {
		return
	}
	if progress.Phase != "" {
		e.task.Phase = progress.Phase
		if progress.Phase == PhaseQueued && e.task.State == StateRunning {
			e.task.State = StateQueued
		} else if progress.Phase == PhaseTransferring && e.task.State == StateQueued {
			e.task.State = StateRunning
		}
	}
	e.task.ScanComplete = progress.ScanComplete
	e.task.ItemsTotal = max64(progress.TotalItems, 0)
	e.task.ItemsCompleted = max64(progress.CompletedItems, 0)
	e.task.ItemsFailed = max64(progress.FailedItems, 0)
	e.task.ItemsRunning = max64(progress.RunningItems, 0)
	e.task.ItemsQueued = max64(progress.QueuedItems, 0)
	done := max64(progress.BytesDone, 0)
	total := max64(progress.BytesTotal, 0)
	if total > 0 && done > total {
		done = total
	}
	deltaBytes := done - e.lastBytes
	deltaTime := now.Sub(e.lastAt).Seconds()
	if deltaBytes >= 0 && deltaTime > 0 {
		e.task.InstantBytesPerSecond = float64(deltaBytes) / deltaTime
	}
	e.task.BytesDone = done
	e.task.BytesTotal = total
	e.task.Percent = percentage(done, total)
	elapsed := now.Sub(e.task.StartedAt)
	e.task.ElapsedMilliseconds = elapsed.Milliseconds()
	rateElapsed := now.Sub(e.rateStartedAt)
	if rateElapsed > 0 {
		rateBytes := done - e.rateBaseBytes
		if rateBytes < 0 {
			rateBytes = 0
		}
		e.task.AverageBytesPerSecond = float64(rateBytes) / rateElapsed.Seconds()
	}
	e.task.UpdatedAt = now
	e.lastBytes = done
	e.lastAt = now
	m.touchLocked()
}

func (m *Manager) baseline(id string, done, total int64) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.entries[id]
	if e == nil || (e.task.State != StateRunning && e.task.State != StateRetrying) {
		return
	}
	if done < 0 {
		done = 0
	}
	if total >= 0 {
		e.task.BytesTotal = total
	}
	if e.task.BytesTotal > 0 && done > e.task.BytesTotal {
		done = e.task.BytesTotal
	}
	e.task.BytesDone = done
	e.task.Percent = percentage(done, e.task.BytesTotal)
	e.task.InstantBytesPerSecond = 0
	e.task.AverageBytesPerSecond = 0
	e.task.UpdatedAt = now
	e.task.ElapsedMilliseconds = now.Sub(e.task.StartedAt).Milliseconds()
	e.lastBytes = done
	e.lastAt = now
	e.rateBaseBytes = done
	e.rateStartedAt = now
	m.touchLocked()
}

func (m *Manager) progress(id string, done, total int64) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.entries[id]
	if e == nil || (e.task.State != StateRunning && e.task.State != StateRetrying) {
		return
	}
	if done < 0 {
		done = 0
	}
	nextTotal := e.task.BytesTotal
	if total >= 0 {
		nextTotal = total
	}
	if done == e.task.BytesDone && nextTotal == e.task.BytesTotal {
		return
	}
	e.task.BytesTotal = nextTotal
	if e.task.BytesTotal > 0 && done > e.task.BytesTotal {
		done = e.task.BytesTotal
	}
	deltaBytes := done - e.lastBytes
	deltaTime := now.Sub(e.lastAt).Seconds()
	if deltaBytes >= 0 && deltaTime > 0 {
		e.task.InstantBytesPerSecond = float64(deltaBytes) / deltaTime
	}
	e.task.BytesDone = done
	e.task.Percent = percentage(done, e.task.BytesTotal)
	elapsed := now.Sub(e.task.StartedAt)
	e.task.ElapsedMilliseconds = elapsed.Milliseconds()
	rateElapsed := now.Sub(e.rateStartedAt)
	if rateElapsed > 0 {
		rateBytes := done - e.rateBaseBytes
		if rateBytes < 0 {
			rateBytes = 0
		}
		e.task.AverageBytesPerSecond = float64(rateBytes) / rateElapsed.Seconds()
	}
	e.task.UpdatedAt = now
	e.lastBytes = done
	e.lastAt = now
	m.touchLocked()
}

func (m *Manager) finishSkipped(id string) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.entries[id]
	if e == nil {
		return
	}
	e.task.State = StateCompleted
	e.task.Phase = PhaseFinalizing
	e.task.Error = ""
	e.task.BytesDone = 0
	e.task.Percent = 100
	if e.task.Scope == ScopeItem {
		e.task.ItemsCompleted = 1
		e.task.ItemsFailed = 0
		e.task.ItemsRunning = 0
		e.task.ItemsQueued = 0
	}
	e.task.InstantBytesPerSecond = 0
	e.task.AverageBytesPerSecond = 0
	e.task.UpdatedAt = now
	e.task.ElapsedMilliseconds = now.Sub(e.task.StartedAt).Milliseconds()
	e.task.CompletedAt = &now
	m.trimLocked()
	m.touchLocked()
}

func (m *Manager) finish(id string, err error) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.entries[id]
	if e == nil {
		return
	}
	if err == nil {
		e.task.State = StateCompleted
		e.task.Phase = PhaseFinalizing
		e.task.Error = ""
		if e.task.BytesTotal > 0 {
			e.task.BytesDone = e.task.BytesTotal
			e.task.Percent = 100
		}
		if e.task.Scope == ScopeItem {
			e.task.ItemsCompleted = 1
			e.task.ItemsFailed = 0
			e.task.ItemsRunning = 0
			e.task.ItemsQueued = 0
		}
	} else {
		e.task.State = StateFailed
		e.task.Error = err.Error()
		if e.task.Scope == ScopeItem {
			e.task.ItemsCompleted = 0
			e.task.ItemsFailed = 1
			e.task.ItemsRunning = 0
			e.task.ItemsQueued = 0
		}
	}
	e.task.UpdatedAt = now
	e.task.ElapsedMilliseconds = now.Sub(e.task.StartedAt).Milliseconds()
	rateElapsed := now.Sub(e.rateStartedAt)
	if rateElapsed > 0 {
		rateBytes := e.task.BytesDone - e.rateBaseBytes
		if rateBytes < 0 {
			rateBytes = 0
		}
		e.task.AverageBytesPerSecond = float64(rateBytes) / rateElapsed.Seconds()
	}
	e.task.InstantBytesPerSecond = 0
	e.task.CompletedAt = &now
	m.trimLocked()
	m.touchLocked()
}

func (m *Manager) snapshotLocked() []Task {
	out := make([]Task, 0, len(m.order))
	for i := len(m.order) - 1; i >= 0; i-- {
		if e := m.entries[m.order[i]]; e != nil {
			out = append(out, e.task)
		}
	}
	return out
}

func (m *Manager) trimLocked() {
	if m.limit <= 0 || len(m.order) <= m.limit {
		return
	}
	for len(m.order) > m.limit {
		remove := -1
		for i, id := range m.order {
			e := m.entries[id]
			if e == nil || !activeState(e.task.State) {
				remove = i
				break
			}
		}
		if remove < 0 {
			return
		}
		id := m.order[remove]
		delete(m.entries, id)
		m.order = append(m.order[:remove], m.order[remove+1:]...)
	}
}

func (m *Manager) touchLocked() {
	m.revision++
	close(m.changed)
	m.changed = make(chan struct{})
}

func activeState(state string) bool {
	switch state {
	case StateQueued, StateRunning, StateRetrying, StateCancelling:
		return true
	default:
		return false
	}
}

func terminalState(state string) bool {
	switch state {
	case StateCompleted, StatePartial, StateFailed, StateCancelled:
		return true
	default:
		return false
	}
}

func percentage(done, total int64) float64 {
	if total <= 0 {
		return 0
	}
	value := float64(done) * 100 / float64(total)
	return math.Max(0, math.Min(100, value))
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
