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
	CloudParentID  uint64
	CloudNodeID    uint64
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
	CloudParentID         uint64     `json:"cloud_parent_id,omitempty"`
	CloudNodeID           uint64     `json:"cloud_node_id,omitempty"`
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
	SpeedSource           string     `json:"speed_source,omitempty"`
	SpeedUpdatedAt        *time.Time `json:"speed_updated_at,omitempty"`
	ElapsedMilliseconds   int64      `json:"elapsed_ms"`
	Error                 string     `json:"error,omitempty"`
	RetryCount            int        `json:"retry_count"`
	Retryable             bool       `json:"retryable"`
	Cancelable            bool       `json:"cancelable,omitempty"`
	StartedAt             time.Time  `json:"started_at"`
	UpdatedAt             time.Time  `json:"updated_at"`
	CompletedAt           *time.Time `json:"completed_at,omitempty"`
}

type entry struct {
	task              Task
	retry             RetryFunc
	cancel            context.CancelFunc
	lastBytes         int64
	lastAt            time.Time
	rateBaseBytes     int64
	rateStartedAt     time.Time
	networkGeneration uint64
}

type Manager struct {
	mu       sync.Mutex
	nextID   uint64
	revision uint64
	changed  chan struct{}
	limit    int
	order    []string
	entries  map[string]*entry
	roots    map[string]struct{}
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
		roots:    make(map[string]struct{}),
	}
}

func (m *Manager) Start(spec Spec) *Handle {
	if m == nil {
		return nil
	}
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	handle := m.startLocked(spec, now)
	m.trimLocked()
	m.touchLocked()
	return handle
}

func (m *Manager) startLocked(spec Spec, now time.Time) *Handle {
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
		CloudParentID:  spec.CloudParentID,
		CloudNodeID:    spec.CloudNodeID,
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
	m.roots[rootID] = struct{}{}
	return &Handle{manager: m, id: id}
}

func (m *Manager) StartGroup(spec Spec) *Handle {
	spec.Scope = ScopeGroup
	if spec.Phase == "" {
		spec.Phase = PhaseScanning
	}
	return m.Start(spec)
}

func (m *Manager) Handle(id string) *Handle {
	if m == nil || id == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.entries[id] == nil {
		return nil
	}
	return &Handle{manager: m, id: id}
}

func (m *Manager) StartChildByID(parentID string, spec Spec) *Handle {
	return m.StartChild(m.Handle(parentID), spec)
}

func (m *Manager) StartChildrenByID(parentID string, specs []Spec) []*Handle {
	if m == nil || parentID == "" || len(specs) == 0 {
		return nil
	}
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	parent := m.entries[parentID]
	if parent == nil {
		return nil
	}
	rootID := transferRootID(parent.task)
	handles := make([]*Handle, 0, len(specs))
	for _, spec := range specs {
		spec.Scope = ScopeItem
		spec.ParentID = parentID
		if spec.RootID == "" {
			spec.RootID = rootID
		}
		if spec.Phase == "" {
			spec.Phase = PhaseTransferring
		}
		handles = append(handles, m.startLocked(spec, now))
	}
	m.trimLocked()
	m.touchLocked()
	return handles
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

// NetworkProgressObserver starts a fresh client network counter and binds it to
// the current attempt. Retrying or registering another observer invalidates the
// old callback, including delayed reads or closes from an HTTP request body.
func (h *Handle) NetworkProgressObserver() func(int64) {
	if h == nil || h.manager == nil {
		return nil
	}
	m := h.manager
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.entries[h.id]
	if e == nil || (e.task.State != StateRunning && e.task.State != StateRetrying) {
		return nil
	}
	e.networkGeneration++
	generation := e.networkGeneration
	e.beginNetworkProgress(time.Now())
	m.touchLocked()
	return func(sent int64) {
		m.mu.Lock()
		defer m.mu.Unlock()
		current := m.entries[h.id]
		if current == nil || current.networkGeneration != generation {
			return
		}
		if m.networkProgressLocked(h.id, sent, time.Now()) {
			m.touchLocked()
		}
	}
}

// NetworkProgress records a synchronous cumulative client payload counter.
// Start with zero; include retries but not resumed bytes. Logical Progress and
// Baseline remain separate. Use NetworkProgressObserver for asynchronous work.
func (h *Handle) NetworkProgress(sent int64) {
	if h == nil || h.manager == nil {
		return
	}
	m := h.manager
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.networkProgressLocked(h.id, sent, time.Now()) {
		m.touchLocked()
	}
}

func (h *Handle) Baseline(done, total int64) {
	if h == nil || h.manager == nil {
		return
	}
	h.manager.baseline(h.id, done, total)
}

func (h *Handle) BaselineAndUpdateGroup(group *Handle, done, total int64, progress GroupProgress) {
	if h == nil || h.manager == nil {
		return
	}
	groupID := ""
	if group != nil && group.manager == h.manager {
		groupID = group.id
	}
	h.manager.updateChildAndGroup(h.id, groupID, done, total, true, progress)
}

func (h *Handle) ProgressAndUpdateGroup(group *Handle, done, total int64, progress GroupProgress) {
	if h == nil || h.manager == nil {
		return
	}
	groupID := ""
	if group != nil && group.manager == h.manager {
		groupID = group.id
	}
	h.manager.updateChildAndGroup(h.id, groupID, done, total, false, progress)
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

func (h *Handle) Finish(state string, err error) error {
	if h == nil || h.manager == nil {
		return errors.New("transfer handle is unavailable")
	}
	return h.manager.finishState(h.id, state, err)
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

// BindCancel connects only the actual Agent-owned operation to its handle.
func (h *Handle) BindCancel(cancel context.CancelFunc) bool {
	if h == nil || h.manager == nil || cancel == nil {
		return false
	}
	m := h.manager
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.entries[h.id]
	if e == nil || !activeState(e.task.State) || e.task.State == StateCancelling {
		return false
	}
	e.cancel = cancel
	e.task.Cancelable = true
	m.touchLocked()
	return true
}

// Cancel requests abort of exactly one bound request. Only its original
// worker may confirm a terminal state after the I/O has stopped.
func (m *Manager) Cancel(id string) error {
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
	if e.cancel == nil || !activeState(e.task.State) || e.task.State == StateCancelling {
		m.mu.Unlock()
		return errors.New("this transfer does not support cancellation")
	}
	cancel := e.cancel
	e.cancel = nil
	e.task.Cancelable = false
	e.task.State = StateCancelling
	e.task.Phase = PhaseFinalizing
	e.task.InstantBytesPerSecond = 0
	e.task.UpdatedAt = now
	m.touchLocked()
	m.mu.Unlock()
	cancel()
	return nil
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
	m.roots = make(map[string]struct{})
	m.touchLocked()
}

func (m *Manager) ClearHistory(scopes ...string) {
	if m == nil {
		return
	}
	scope := "all"
	if len(scopes) > 0 && scopes[0] != "" {
		scope = scopes[0]
	}
	if scope != "all" && scope != "network" && scope != "local" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.order) == 0 {
		return
	}

	removeRoots := make(map[string]bool)
	activeRoots := make(map[string]bool)
	for _, id := range m.order {
		e := m.entries[id]
		if e == nil {
			continue
		}
		rootID := transferRootID(e.task)
		if activeState(e.task.State) {
			activeRoots[rootID] = true
		}
	}
	for _, id := range m.order {
		e := m.entries[id]
		if e == nil || e.task.ID != transferRootID(e.task) {
			continue
		}
		network := (e.task.Direction == "upload" || e.task.Direction == "download") && e.task.Kind != KindDehydration
		if (scope == "network" && !network) || (scope == "local" && network) {
			continue
		}
		if terminalState(e.task.State) && !activeRoots[e.task.ID] {
			removeRoots[e.task.ID] = true
		}
	}

	kept := m.order[:0]
	changed := false
	for _, id := range m.order {
		e := m.entries[id]
		if e == nil {
			changed = true
			continue
		}
		if removeRoots[transferRootID(e.task)] {
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
	for rootID := range removeRoots {
		delete(m.roots, rootID)
	}
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
	e.task.SpeedUpdatedAt = nil
	e.task.StartedAt = now
	e.task.UpdatedAt = now
	e.lastBytes = 0
	e.lastAt = now
	e.rateBaseBytes = 0
	e.rateStartedAt = now
	e.networkGeneration++
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
	if !m.updateGroupLocked(id, progress, now) {
		return
	}
	m.touchLocked()
}

func (m *Manager) updateGroupLocked(id string, progress GroupProgress, now time.Time) bool {
	e := m.entries[id]
	if e == nil || e.task.Scope != ScopeGroup {
		return false
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
	if e.task.SpeedSource == "" {
		e.updateRate(done, now)
	}
	e.task.BytesDone = done
	e.task.BytesTotal = total
	e.task.Percent = percentage(done, total)
	elapsed := now.Sub(e.task.StartedAt)
	e.task.ElapsedMilliseconds = elapsed.Milliseconds()
	e.task.UpdatedAt = now
	return true
}

func (m *Manager) baseline(id string, done, total int64) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.baselineLocked(id, done, total, now) {
		return
	}
	m.touchLocked()
}

func (m *Manager) networkProgressLocked(id string, sent int64, now time.Time) bool {
	e := m.entries[id]
	if e == nil || sent < 0 || (e.task.State != StateRunning && e.task.State != StateRetrying) {
		return false
	}
	initialized := e.task.SpeedSource != "client"
	if initialized {
		e.beginNetworkProgress(now)
	}
	if sent <= e.lastBytes {
		return initialized
	}
	e.updateRate(sent, now)
	e.task.SpeedUpdatedAt = &now
	e.task.UpdatedAt = now
	e.task.ElapsedMilliseconds = now.Sub(e.task.StartedAt).Milliseconds()
	return true
}

func (e *entry) beginNetworkProgress(now time.Time) {
	e.task.SpeedSource = "client"
	e.task.SpeedUpdatedAt = nil
	e.task.InstantBytesPerSecond = 0
	e.task.AverageBytesPerSecond = 0
	e.lastBytes = 0
	e.lastAt = now
	e.rateBaseBytes = 0
	e.rateStartedAt = now
}

func (e *entry) updateRate(done int64, now time.Time) {
	deltaBytes := done - e.lastBytes
	deltaTime := now.Sub(e.lastAt).Seconds()
	if deltaBytes >= 0 && deltaTime > 0 {
		e.task.InstantBytesPerSecond = float64(deltaBytes) / deltaTime
	}
	e.updateAverageRate(done, now)
	e.lastBytes = done
	e.lastAt = now
}

func (e *entry) updateAverageRate(done int64, now time.Time) {
	rateElapsed := now.Sub(e.rateStartedAt)
	if rateElapsed > 0 {
		rateBytes := max64(done-e.rateBaseBytes, 0)
		e.task.AverageBytesPerSecond = float64(rateBytes) / rateElapsed.Seconds()
	}
}

func (m *Manager) baselineLocked(id string, done, total int64, now time.Time) bool {
	e := m.entries[id]
	if e == nil || (e.task.State != StateRunning && e.task.State != StateRetrying) {
		return false
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
	if e.task.SpeedSource == "" {
		e.task.InstantBytesPerSecond = 0
		e.task.AverageBytesPerSecond = 0
		e.lastBytes = done
		e.lastAt = now
		e.rateBaseBytes = done
		e.rateStartedAt = now
	}
	e.task.UpdatedAt = now
	e.task.ElapsedMilliseconds = now.Sub(e.task.StartedAt).Milliseconds()
	return true
}

func (m *Manager) progress(id string, done, total int64) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.progressLocked(id, done, total, now) {
		return
	}
	m.touchLocked()
}

func (m *Manager) progressLocked(id string, done, total int64, now time.Time) bool {
	e := m.entries[id]
	if e == nil || (e.task.State != StateRunning && e.task.State != StateRetrying) {
		return false
	}
	if done < 0 {
		done = 0
	}
	nextTotal := e.task.BytesTotal
	if total >= 0 {
		nextTotal = total
	}
	if done == e.task.BytesDone && nextTotal == e.task.BytesTotal {
		return false
	}
	e.task.BytesTotal = nextTotal
	if e.task.BytesTotal > 0 && done > e.task.BytesTotal {
		done = e.task.BytesTotal
	}
	if e.task.SpeedSource == "" {
		e.updateRate(done, now)
	}
	e.task.BytesDone = done
	e.task.Percent = percentage(done, e.task.BytesTotal)
	elapsed := now.Sub(e.task.StartedAt)
	e.task.ElapsedMilliseconds = elapsed.Milliseconds()
	e.task.UpdatedAt = now
	return true
}

func (m *Manager) updateChildAndGroup(
	childID string,
	groupID string,
	done, total int64,
	baseline bool,
	progress GroupProgress,
) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()

	changed := false
	if baseline {
		changed = m.baselineLocked(childID, done, total, now)
	} else {
		changed = m.progressLocked(childID, done, total, now)
	}
	if groupID != "" && m.updateGroupLocked(groupID, progress, now) {
		changed = true
	}
	if changed {
		m.touchLocked()
	}
}

func (m *Manager) finishSkipped(id string) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.entries[id]
	if e == nil {
		return
	}
	e.cancel = nil
	e.task.Cancelable = false
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
	if e.task.SpeedSource != "" {
		e.updateAverageRate(e.lastBytes, now)
	} else {
		e.task.AverageBytesPerSecond = 0
	}
	e.task.UpdatedAt = now
	e.task.ElapsedMilliseconds = now.Sub(e.task.StartedAt).Milliseconds()
	e.task.CompletedAt = &now
	m.trimLocked()
	m.touchLocked()
}

func (m *Manager) finishState(id, state string, err error) error {
	switch state {
	case StateCompleted, StatePartial, StateFailed, StateCancelled:
	default:
		return fmt.Errorf("invalid terminal transfer state %q", state)
	}
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.entries[id]
	if e == nil {
		return errors.New("transfer not found")
	}
	e.cancel = nil
	e.task.Cancelable = false
	e.task.State = state
	e.task.Phase = PhaseFinalizing
	e.task.ItemsRunning = 0
	e.task.ItemsQueued = 0
	if err != nil {
		e.task.Error = err.Error()
	} else if state == StateCompleted {
		e.task.Error = ""
	}
	if e.task.Scope == ScopeItem {
		switch state {
		case StateCompleted:
			e.task.ItemsCompleted = 1
			e.task.ItemsFailed = 0
			if e.task.BytesTotal > 0 {
				e.task.BytesDone = e.task.BytesTotal
				e.task.Percent = 100
			}
		case StateFailed:
			e.task.ItemsCompleted = 0
			e.task.ItemsFailed = 1
		}
	}
	rateBytes := e.task.BytesDone
	if e.task.SpeedSource != "" {
		rateBytes = e.lastBytes
	}
	e.updateAverageRate(rateBytes, now)
	e.task.InstantBytesPerSecond = 0
	e.task.UpdatedAt = now
	e.task.ElapsedMilliseconds = now.Sub(e.task.StartedAt).Milliseconds()
	e.task.CompletedAt = &now
	m.trimLocked()
	m.touchLocked()
	return nil
}

func (m *Manager) finish(id string, err error) {
	now := time.Now()
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.entries[id]
	if e == nil {
		return
	}
	e.cancel = nil
	e.task.Cancelable = false
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
	rateBytes := e.task.BytesDone
	if e.task.SpeedSource != "" {
		rateBytes = e.lastBytes
	}
	e.updateAverageRate(rateBytes, now)
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
	if m.limit <= 0 || len(m.roots) <= m.limit {
		return
	}
	for len(m.roots) > m.limit {
		rootOrder := make([]string, 0, len(m.roots))
		seen := make(map[string]bool, len(m.roots))
		activeRoots := make(map[string]bool, len(m.roots))
		for _, id := range m.order {
			e := m.entries[id]
			if e == nil {
				continue
			}
			rootID := transferRootID(e.task)
			if !seen[rootID] {
				seen[rootID] = true
				rootOrder = append(rootOrder, rootID)
			}
			if activeState(e.task.State) {
				activeRoots[rootID] = true
			}
		}

		removeRoot := ""
		for _, rootID := range rootOrder {
			root := m.entries[rootID]
			if root == nil {
				removeRoot = rootID
				break
			}
			if terminalState(root.task.State) && !activeRoots[rootID] {
				removeRoot = rootID
				break
			}
		}
		if removeRoot == "" {
			return
		}

		kept := m.order[:0]
		for _, id := range m.order {
			e := m.entries[id]
			if e == nil || transferRootID(e.task) == removeRoot {
				delete(m.entries, id)
				continue
			}
			kept = append(kept, id)
		}
		m.order = kept
		delete(m.roots, removeRoot)
	}
}

func transferRootID(task Task) string {
	if task.RootID != "" {
		return task.RootID
	}
	return task.ID
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
