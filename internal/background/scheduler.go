package background

import (
	"container/heap"
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"sort"
	"sync"
	"time"
)

type Priority uint8

const (
	PriorityP0 Priority = iota
	PriorityP1
	PriorityP2
	PriorityP3
	PriorityP4
)

type ResourceClass string

const (
	ResourceInteractiveIO ResourceClass = "interactive_io"
	ResourceNetwork       ResourceClass = "network"
	ResourceMediaCPU      ResourceClass = "media_cpu"
	ResourceMLCPU         ResourceClass = "ml_cpu"
	ResourceBackgroundCPU ResourceClass = "background_cpu"
	ResourceMaintenanceIO ResourceClass = "maintenance_io"
)

type Scope string

const (
	ScopeSystem Scope = "system"
	ScopeUser   Scope = "user"
)

type Trigger string

const (
	TriggerUserAction  Trigger = "user_action"
	TriggerSystemEvent Trigger = "system_event"
	TriggerSchedule    Trigger = "schedule"
	TriggerReconcile   Trigger = "reconcile"
	TriggerAdminAction Trigger = "admin_action"
)

type Initiator string

const (
	InitiatorSystem  Initiator = "system"
	InitiatorUser    Initiator = "user"
	InitiatorAdmin   Initiator = "admin"
	InitiatorService Initiator = "service"
)

type Identity struct {
	Scope   Scope
	OwnerID uint64
	Key     string
}

func (i Identity) valid() bool {
	if i.Key == "" {
		return false
	}
	switch i.Scope {
	case ScopeSystem:
		return i.OwnerID == 0
	case ScopeUser:
		return i.OwnerID != 0
	default:
		return false
	}
}

func jitterUnit(identity Identity, attempt int) float64 {
	h := fnv.New64a()
	_, _ = fmt.Fprintf(h, "%s:%d:%s:%d", identity.Scope, identity.OwnerID, identity.Key, attempt)
	return float64(h.Sum64()%1_000_000) / 999_999
}

var (
	ErrClosed           = errors.New("background scheduler is closed")
	ErrInvalidTask      = errors.New("background task is invalid")
	ErrQueueFull        = errors.New("background scheduler queue is full")
	ErrExpired          = errors.New("background task expired before execution")
	ErrSuperseded       = errors.New("background task was superseded")
	ErrRunTimeout       = errors.New("background task run timeout")
	ErrLeaseUnavailable = errors.New("background task lease unavailable")
	ErrLeaseLost        = errors.New("background task lease lost")
)

type Descriptor struct {
	Key          string
	Scope        Scope
	OwnerID      uint64
	Trigger      Trigger
	Initiator    Initiator
	InitiatorID  uint64
	ParentKey    string
	TraceID      string
	SupersedeKey string
	Priority     Priority
	Resource     ResourceClass
	Attempt      int
	RunTimeout   time.Duration
	NotAfter     time.Time
}

type Lease struct {
	Heartbeat func(context.Context) error
	Release   func(context.Context, error) error
}

type LeaseProvider func(context.Context, Descriptor) (Lease, bool, error)

type RetryPolicy struct {
	MaxAttempts int
	Initial     time.Duration
	Max         time.Duration
	Multiplier  float64
	Jitter      float64
	Retryable   func(error) bool
}

func (p RetryPolicy) normalized() RetryPolicy {
	if p.MaxAttempts <= 0 {
		p.MaxAttempts = 1
	}
	if p.Initial <= 0 {
		p.Initial = 100 * time.Millisecond
	}
	if p.Max <= 0 {
		p.Max = 30 * time.Second
	}
	if p.Max < p.Initial {
		p.Max = p.Initial
	}
	if p.Multiplier < 1 {
		p.Multiplier = 2
	}
	if p.Jitter == 0 {
		p.Jitter = 0.20
	}
	if p.Jitter < 0 {
		p.Jitter = 0
	}
	if p.Jitter > 1 {
		p.Jitter = 1
	}
	return p
}

func (p RetryPolicy) delay(attempt int, identity Identity) time.Duration {
	p = p.normalized()
	delay := p.Initial
	for i := 1; i < attempt; i++ {
		next := time.Duration(float64(delay) * p.Multiplier)
		if next <= delay || next >= p.Max {
			delay = p.Max
			break
		}
		delay = next
	}
	if delay > p.Max {
		delay = p.Max
	}
	if p.Jitter == 0 || delay <= 0 {
		return delay
	}
	unit := jitterUnit(identity, attempt)
	factor := 1 - p.Jitter + (2 * p.Jitter * unit)
	jittered := time.Duration(float64(delay) * factor)
	if jittered <= 0 {
		return time.Nanosecond
	}
	if jittered > p.Max {
		return p.Max
	}
	return jittered
}

func (p RetryPolicy) retryable(err error, attempt int) bool {
	p = p.normalized()
	if err == nil || attempt >= p.MaxAttempts {
		return false
	}
	if errors.Is(err, context.Canceled) ||
		errors.Is(err, context.DeadlineExceeded) ||
		errors.Is(err, ErrExpired) ||
		errors.Is(err, ErrSuperseded) {
		return false
	}
	if p.Retryable != nil {
		return p.Retryable(err)
	}
	return true
}

type Task struct {
	Key               string
	Kind              string
	GroupKey          string
	Scope             Scope
	OwnerID           uint64
	Trigger           Trigger
	Initiator         Initiator
	InitiatorID       uint64
	ParentKey         string
	TraceID           string
	SupersedeKey      string
	Priority          Priority
	Resource          ResourceClass
	Retry             RetryPolicy
	Lease             LeaseProvider
	HeartbeatInterval time.Duration
	RunTimeout        time.Duration
	NotAfter          time.Time
	Run               func(context.Context) error
}

func (t Task) normalized() (Task, error) {
	if t.Key == "" || t.Run == nil || t.Priority > PriorityP4 || t.Resource == "" ||
		t.RunTimeout < 0 || t.HeartbeatInterval < 0 {
		return t, ErrInvalidTask
	}
	if !t.identity().valid() {
		return t, ErrInvalidTask
	}
	switch t.Trigger {
	case TriggerUserAction, TriggerSystemEvent, TriggerSchedule, TriggerReconcile, TriggerAdminAction:
	default:
		return t, ErrInvalidTask
	}
	switch t.Initiator {
	case InitiatorSystem, InitiatorService:
		if t.InitiatorID != 0 {
			return t, ErrInvalidTask
		}
	case InitiatorUser, InitiatorAdmin:
		if t.InitiatorID == 0 {
			return t, ErrInvalidTask
		}
	default:
		return t, ErrInvalidTask
	}
	if !t.NotAfter.IsZero() {
		t.NotAfter = t.NotAfter.UTC()
	}
	return t, nil
}

func (t Task) identity() Identity {
	return Identity{Scope: t.Scope, OwnerID: t.OwnerID, Key: t.Key}
}

type TaskProgress struct {
	Phase   string
	Current int64
	Total   int64
	Unit    string
	Message string
}

func (p TaskProgress) normalized() TaskProgress {
	if p.Current < 0 {
		p.Current = 0
	}
	if p.Total < 0 {
		p.Total = 0
	}
	if p.Total > 0 && p.Current > p.Total {
		p.Current = p.Total
	}
	return p
}

type RuntimeTaskSnapshot struct {
	Identity      Identity
	Kind          string
	GroupKey      string
	State         string
	Trigger       Trigger
	Initiator     Initiator
	InitiatorID   uint64
	ParentKey     string
	TraceID       string
	Priority      Priority
	Resource      ResourceClass
	Attempt       int
	Progress      TaskProgress
	SubmittedAt   time.Time
	StartedAt     *time.Time
	UpdatedAt     time.Time
	ReadyAt       *time.Time
	LeaseDeferred bool
}

type progressReporterKey struct{}

func ReportProgress(ctx context.Context, progress TaskProgress) {
	if ctx == nil {
		return
	}
	report, _ := ctx.Value(progressReporterKey{}).(func(TaskProgress))
	if report != nil {
		report(progress.normalized())
	}
}

type Config struct {
	Capacity        map[ResourceClass]int
	QueueCapacity   map[ResourceClass]int
	ReleaseTimeout  time.Duration
	LeaseRetryDelay time.Duration
}

func DefaultConfig() Config {
	return Config{
		Capacity: map[ResourceClass]int{
			ResourceInteractiveIO: 4,
			ResourceNetwork:       2,
			ResourceMediaCPU:      2,
			ResourceMLCPU:         1,
			ResourceBackgroundCPU: 1,
			ResourceMaintenanceIO: 1,
		},
		QueueCapacity: map[ResourceClass]int{
			ResourceInteractiveIO: 128,
			ResourceNetwork:       128,
			ResourceMediaCPU:      256,
			ResourceMLCPU:         64,
			ResourceBackgroundCPU: 128,
			ResourceMaintenanceIO: 32,
		},
		ReleaseTimeout:  5 * time.Second,
		LeaseRetryDelay: 250 * time.Millisecond,
	}
}

type MetricsSnapshot struct {
	Submitted        uint64
	Started          uint64
	Completed        uint64
	Failed           uint64
	Cancelled        uint64
	Retried          uint64
	Deduplicated     uint64
	Promoted         uint64
	Backpressured    uint64
	LeaseUnavailable uint64
	LeaseLost        uint64
	Expired          uint64
	Superseded       uint64
	Queued           int
	Running          int
	ByResource       map[ResourceClass]ResourceSnapshot
}

type ResourceSnapshot struct {
	Queued  int
	Running int
}

type metrics struct {
	mu               sync.Mutex
	submitted        uint64
	started          uint64
	completed        uint64
	failed           uint64
	cancelled        uint64
	retried          uint64
	deduplicated     uint64
	promoted         uint64
	backpressured    uint64
	leaseUnavailable uint64
	leaseLost        uint64
	expired          uint64
	superseded       uint64
	running          map[ResourceClass]int
}

type Handle struct {
	done chan struct{}
	once sync.Once
	mu   sync.Mutex
	err  error
}

func newHandle() *Handle {
	return &Handle{done: make(chan struct{})}
}

func (h *Handle) Done() <-chan struct{} { return h.done }

func (h *Handle) Wait(ctx context.Context) error {
	if h == nil {
		return ErrInvalidTask
	}
	select {
	case <-ctx.Done():
		return context.Cause(ctx)
	case <-h.done:
		h.mu.Lock()
		defer h.mu.Unlock()
		return h.err
	}
}

func (h *Handle) complete(err error) {
	h.once.Do(func() {
		h.mu.Lock()
		h.err = err
		h.mu.Unlock()
		close(h.done)
	})
}

type itemState uint8

const (
	itemQueued itemState = iota
	itemRunning
	itemDone
)

type taskEntry struct {
	task            Task
	identity        Identity
	handle          *Handle
	state           itemState
	attempt         int
	sequence        uint64
	readyAt         time.Time
	submittedAt     time.Time
	startedAt       *time.Time
	updatedAt       time.Time
	progress        TaskProgress
	index           int
	cancel          context.CancelCauseFunc
	cancelRequested bool
	leaseDeferred   bool
}

type taskHeap []*taskEntry

func (h taskHeap) Len() int { return len(h) }
func (h taskHeap) Less(i, j int) bool {
	a, b := h[i], h[j]
	aReady, bReady := a.readyAt.IsZero(), b.readyAt.IsZero()
	if aReady != bReady {
		return aReady
	}
	if !aReady && !a.readyAt.Equal(b.readyAt) {
		return a.readyAt.Before(b.readyAt)
	}
	if a.task.Priority != b.task.Priority {
		return a.task.Priority < b.task.Priority
	}
	return a.sequence < b.sequence
}
func (h taskHeap) Swap(i, j int) {
	h[i], h[j] = h[j], h[i]
	h[i].index = i
	h[j].index = j
}
func (h *taskHeap) Push(x any) {
	entry := x.(*taskEntry)
	entry.index = len(*h)
	*h = append(*h, entry)
}
func (h *taskHeap) Pop() any {
	old := *h
	n := len(old)
	entry := old[n-1]
	old[n-1] = nil
	entry.index = -1
	*h = old[:n-1]
	return entry
}

type fairnessOwner struct {
	scope   Scope
	ownerID uint64
}

type fairnessBucket struct {
	priority Priority
	owner    fairnessOwner
}

type resourceQueue struct {
	mu             sync.Mutex
	items          taskHeap
	notify         chan struct{}
	stopped        bool
	capacity       int
	nextOwnerOrder uint64
	ownerOrder     map[fairnessBucket]uint64
	lastOwnerOrder map[Priority]uint64
}

func newResourceQueue(capacity int) *resourceQueue {
	q := &resourceQueue{
		notify:         make(chan struct{}),
		capacity:       capacity,
		ownerOrder:     make(map[fairnessBucket]uint64),
		lastOwnerOrder: make(map[Priority]uint64),
	}
	heap.Init(&q.items)
	return q
}

func fairnessBucketFor(entry *taskEntry) fairnessBucket {
	return fairnessBucket{
		priority: entry.task.Priority,
		owner: fairnessOwner{
			scope:   entry.identity.Scope,
			ownerID: entry.identity.OwnerID,
		},
	}
}

func (q *resourceQueue) ensureOwnerOrderLocked(bucket fairnessBucket) uint64 {
	if order, ok := q.ownerOrder[bucket]; ok {
		return order
	}
	q.nextOwnerOrder++
	q.ownerOrder[bucket] = q.nextOwnerOrder
	return q.nextOwnerOrder
}

func (q *resourceQueue) dropOwnerOrderIfEmptyLocked(bucket fairnessBucket) {
	for _, entry := range q.items {
		if fairnessBucketFor(entry) == bucket {
			return
		}
	}
	delete(q.ownerOrder, bucket)
}

func (q *resourceQueue) nextReadyIndexLocked(now time.Time) (int, time.Time) {
	bestPriority := PriorityP4
	foundPriority := false
	candidateByOwner := make(map[fairnessBucket]int)
	var earliestReadyAt time.Time

	for index, entry := range q.items {
		if !entry.readyAt.IsZero() && entry.readyAt.After(now) {
			if earliestReadyAt.IsZero() || entry.readyAt.Before(earliestReadyAt) {
				earliestReadyAt = entry.readyAt
			}
			continue
		}

		priority := entry.task.Priority
		if !foundPriority || priority < bestPriority {
			bestPriority = priority
			foundPriority = true
			clear(candidateByOwner)
		} else if priority > bestPriority {
			continue
		}

		bucket := fairnessBucketFor(entry)
		if currentIndex, ok := candidateByOwner[bucket]; !ok ||
			entry.sequence < q.items[currentIndex].sequence {
			candidateByOwner[bucket] = index
		}
	}

	if !foundPriority {
		return -1, earliestReadyAt
	}

	lastOrder := q.lastOwnerOrder[bestPriority]
	selectedIndex := -1
	selectedOrder := uint64(0)
	wrapIndex := -1
	wrapOrder := uint64(0)

	for bucket, index := range candidateByOwner {
		order := q.ensureOwnerOrderLocked(bucket)
		if wrapIndex < 0 || order < wrapOrder {
			wrapIndex = index
			wrapOrder = order
		}
		if order > lastOrder && (selectedIndex < 0 || order < selectedOrder) {
			selectedIndex = index
			selectedOrder = order
		}
	}
	if selectedIndex < 0 {
		selectedIndex = wrapIndex
	}
	return selectedIndex, earliestReadyAt
}

func (q *resourceQueue) signalLocked() {
	close(q.notify)
	q.notify = make(chan struct{})
}

func (q *resourceQueue) push(entry *taskEntry, enforceCapacity bool) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.stopped {
		return false
	}
	if enforceCapacity && q.capacity > 0 && len(q.items) >= q.capacity {
		return false
	}
	heap.Push(&q.items, entry)
	q.ensureOwnerOrderLocked(fairnessBucketFor(entry))
	q.signalLocked()
	return true
}

func (q *resourceQueue) canAdmitAfter(removing int) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.stopped {
		return false
	}
	queued := len(q.items) - removing
	if queued < 0 {
		queued = 0
	}
	return q.capacity <= 0 || queued < q.capacity
}

func (q *resourceQueue) promote(entry *taskEntry, task Task) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if entry.state != itemQueued || task.Priority >= entry.task.Priority || entry.index < 0 {
		return false
	}
	oldBucket := fairnessBucketFor(entry)
	entry.task.Priority = task.Priority
	entry.task.Trigger = task.Trigger
	entry.task.Initiator = task.Initiator
	entry.task.InitiatorID = task.InitiatorID
	entry.task.ParentKey = task.ParentKey
	entry.task.TraceID = task.TraceID
	q.ensureOwnerOrderLocked(fairnessBucketFor(entry))
	q.dropOwnerOrderIfEmptyLocked(oldBucket)
	heap.Fix(&q.items, entry.index)
	q.signalLocked()
	return true
}

func (q *resourceQueue) remove(entry *taskEntry) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if entry.state != itemQueued || entry.index < 0 || entry.index >= len(q.items) {
		return false
	}
	bucket := fairnessBucketFor(entry)
	heap.Remove(&q.items, entry.index)
	q.dropOwnerOrderIfEmptyLocked(bucket)
	q.signalLocked()
	return true
}

func (q *resourceQueue) stop() {
	q.mu.Lock()
	if !q.stopped {
		q.stopped = true
		q.signalLocked()
	}
	q.mu.Unlock()
}

func (q *resourceQueue) next(ctx context.Context) (*taskEntry, bool) {
	for {
		q.mu.Lock()
		if q.stopped {
			q.mu.Unlock()
			return nil, false
		}
		if len(q.items) == 0 {
			notify := q.notify
			q.mu.Unlock()
			select {
			case <-ctx.Done():
				return nil, false
			case <-notify:
				continue
			}
		}

		now := time.Now()
		index, earliestReadyAt := q.nextReadyIndexLocked(now)
		if index >= 0 {
			entry := q.items[index]
			bucket := fairnessBucketFor(entry)
			order := q.ensureOwnerOrderLocked(bucket)
			heap.Remove(&q.items, index)
			q.lastOwnerOrder[entry.task.Priority] = order
			q.dropOwnerOrderIfEmptyLocked(bucket)
			q.mu.Unlock()
			return entry, true
		}

		notify := q.notify
		q.mu.Unlock()
		if earliestReadyAt.IsZero() {
			select {
			case <-ctx.Done():
				return nil, false
			case <-notify:
				continue
			}
		}
		wait := time.Until(earliestReadyAt)
		if wait < 0 {
			wait = 0
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return nil, false
		case <-notify:
			if !timer.Stop() {
				<-timer.C
			}
			continue
		case <-timer.C:
			continue
		}
	}
}

type Scheduler struct {
	ctx             context.Context
	cancel          context.CancelCauseFunc
	releaseTimeout  time.Duration
	leaseRetryDelay time.Duration

	mu       sync.Mutex
	closed   bool
	sequence uint64
	entries  map[Identity]*taskEntry
	queues   map[ResourceClass]*resourceQueue

	metrics metrics
	wg      sync.WaitGroup

	// Closed only when all workers have exited and shutdown bookkeeping is done.
	shutdownDone chan struct{}
}

func NewScheduler(parent context.Context, cfg Config) *Scheduler {
	if parent == nil {
		parent = context.Background()
	}
	defaults := DefaultConfig()
	if cfg.ReleaseTimeout <= 0 {
		cfg.ReleaseTimeout = defaults.ReleaseTimeout
	}
	if cfg.LeaseRetryDelay <= 0 {
		cfg.LeaseRetryDelay = defaults.LeaseRetryDelay
	}
	if len(cfg.Capacity) == 0 {
		cfg.Capacity = defaults.Capacity
	}
	if len(cfg.QueueCapacity) == 0 {
		cfg.QueueCapacity = defaults.QueueCapacity
	}
	ctx, cancel := context.WithCancelCause(parent)
	s := &Scheduler{
		ctx:             ctx,
		cancel:          cancel,
		releaseTimeout:  cfg.ReleaseTimeout,
		leaseRetryDelay: cfg.LeaseRetryDelay,
		entries:         make(map[Identity]*taskEntry),
		queues:          make(map[ResourceClass]*resourceQueue),
		shutdownDone:    make(chan struct{}),
	}
	s.metrics.running = make(map[ResourceClass]int)
	for resource, capacity := range cfg.Capacity {
		if capacity <= 0 {
			continue
		}
		queueCapacity := cfg.QueueCapacity[resource]
		if queueCapacity <= 0 {
			queueCapacity = defaults.QueueCapacity[resource]
		}
		if queueCapacity <= 0 {
			queueCapacity = 64
		}
		q := newResourceQueue(queueCapacity)
		s.queues[resource] = q
		for i := 0; i < capacity; i++ {
			s.wg.Add(1)
			go s.worker(resource, q)
		}
	}
	go func() {
		<-ctx.Done()
		s.shutdown(context.Cause(ctx))
	}()
	return s
}

func (s *Scheduler) Submit(task Task) (*Handle, error) {
	if s == nil {
		return nil, ErrInvalidTask
	}
	var err error
	task, err = task.normalized()
	if err != nil {
		return nil, err
	}
	identity := task.identity()
	if !task.NotAfter.IsZero() && !time.Now().Before(task.NotAfter) {
		s.metrics.mu.Lock()
		s.metrics.expired++
		s.metrics.mu.Unlock()
		return nil, ErrExpired
	}

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, ErrClosed
	}
	q := s.queues[task.Resource]
	if q == nil {
		s.mu.Unlock()
		return nil, fmt.Errorf("%w: resource class %q has no capacity", ErrInvalidTask, task.Resource)
	}
	if existing := s.entries[identity]; existing != nil && existing.state != itemDone {
		if existing.task.Resource != task.Resource {
			s.mu.Unlock()
			return nil, fmt.Errorf("%w: duplicate task %q changed resource class", ErrInvalidTask, task.Key)
		}
		handle := existing.handle
		s.metrics.mu.Lock()
		s.metrics.deduplicated++
		s.metrics.mu.Unlock()
		promoted := false
		if existing.state == itemQueued && task.Priority < existing.task.Priority {
			promoted = s.queues[existing.task.Resource].promote(existing, task)
		}
		if existing.task.Kind == "" && task.Kind != "" {
			existing.task.Kind = task.Kind
		}
		if existing.task.GroupKey == "" && task.GroupKey != "" {
			existing.task.GroupKey = task.GroupKey
		}
		existing.updatedAt = time.Now().UTC()
		if promoted {
			s.metrics.mu.Lock()
			s.metrics.promoted++
			s.metrics.mu.Unlock()
		}
		s.mu.Unlock()
		return handle, nil
	}

	type supersedeCandidate struct {
		identity Identity
		entry    *taskEntry
	}
	candidates := make([]supersedeCandidate, 0)
	targetQueueRemovals := 0
	if task.SupersedeKey != "" {
		for existingIdentity, existing := range s.entries {
			if existing.state != itemQueued ||
				existingIdentity.Scope != identity.Scope ||
				existingIdentity.OwnerID != identity.OwnerID ||
				existing.task.SupersedeKey == "" ||
				existing.task.SupersedeKey != task.SupersedeKey {
				continue
			}
			candidates = append(candidates, supersedeCandidate{
				identity: existingIdentity,
				entry:    existing,
			})
			if existing.task.Resource == task.Resource && existing.index >= 0 {
				targetQueueRemovals++
			}
		}
	}
	if !q.canAdmitAfter(targetQueueRemovals) {
		s.metrics.mu.Lock()
		s.metrics.backpressured++
		s.metrics.mu.Unlock()
		s.mu.Unlock()
		return nil, ErrQueueFull
	}

	superseded := make([]*taskEntry, 0, len(candidates))
	for _, candidate := range candidates {
		existingQueue := s.queues[candidate.entry.task.Resource]
		if existingQueue != nil && existingQueue.remove(candidate.entry) {
			candidate.entry.state = itemDone
			delete(s.entries, candidate.identity)
			superseded = append(superseded, candidate.entry)
		}
	}

	s.sequence++
	now := time.Now().UTC()
	entry := &taskEntry{
		task:        task,
		identity:    identity,
		handle:      newHandle(),
		state:       itemQueued,
		attempt:     1,
		sequence:    s.sequence,
		submittedAt: now,
		updatedAt:   now,
		index:       -1,
	}
	if !q.push(entry, false) {
		s.mu.Unlock()
		for _, old := range superseded {
			old.handle.complete(ErrSuperseded)
		}
		return nil, ErrClosed
	}
	s.entries[identity] = entry
	s.metrics.mu.Lock()
	s.metrics.submitted++
	s.metrics.superseded += uint64(len(superseded))
	s.metrics.mu.Unlock()
	s.mu.Unlock()

	for _, old := range superseded {
		old.handle.complete(ErrSuperseded)
	}
	return entry.handle, nil
}

func (s *Scheduler) Cancel(identity Identity) bool {
	if s == nil || !identity.valid() {
		return false
	}
	s.mu.Lock()
	entry := s.entries[identity]
	if entry == nil || entry.state == itemDone {
		s.mu.Unlock()
		return false
	}
	q := s.queues[entry.task.Resource]
	if entry.state == itemQueued {
		if q != nil {
			_ = q.remove(entry)
		}
		entry.state = itemDone
		entry.cancelRequested = true
		delete(s.entries, identity)
		s.mu.Unlock()
		s.metrics.mu.Lock()
		s.metrics.cancelled++
		s.metrics.mu.Unlock()
		entry.handle.complete(context.Canceled)
		return true
	}
	entry.cancelRequested = true
	entry.updatedAt = time.Now().UTC()
	cancel := entry.cancel
	s.mu.Unlock()
	if cancel != nil {
		cancel(context.Canceled)
		return true
	}
	return false
}

func (s *Scheduler) Close() {
	if s == nil {
		return
	}
	s.shutdown(ErrClosed)
}

func (s *Scheduler) shutdown(cause error) {
	if cause == nil {
		cause = ErrClosed
	}
	s.mu.Lock()
	if s.closed {
		done := s.shutdownDone
		s.mu.Unlock()
		<-done // Joining callers must not outlive a running task's finalizer.
		return
	}
	s.closed = true
	defer close(s.shutdownDone)
	queued := make([]*taskEntry, 0)
	runningCancels := make([]context.CancelCauseFunc, 0)
	for key, entry := range s.entries {
		switch entry.state {
		case itemQueued:
			entry.state = itemDone
			queued = append(queued, entry)
			delete(s.entries, key)
		case itemRunning:
			if entry.cancel != nil {
				runningCancels = append(runningCancels, entry.cancel)
			}
		}
	}
	for _, q := range s.queues {
		q.stop()
	}
	s.cancel(cause)
	s.mu.Unlock()

	for _, cancel := range runningCancels {
		cancel(cause)
	}
	for _, entry := range queued {
		entry.handle.complete(cause)
	}
	s.wg.Wait()

	s.mu.Lock()
	for key, entry := range s.entries {
		if entry.state != itemDone {
			entry.state = itemDone
			delete(s.entries, key)
		}
	}
	s.mu.Unlock()
}

func (s *Scheduler) updateTaskProgress(
	identity Identity,
	progress TaskProgress,
) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.entries[identity]
	if entry == nil || entry.state == itemDone {
		return
	}
	entry.progress = progress.normalized()
	entry.updatedAt = time.Now().UTC()
}

func (s *Scheduler) TaskSnapshots(ownerID *uint64) []RuntimeTaskSnapshot {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	out := make([]RuntimeTaskSnapshot, 0, len(s.entries))
	for _, entry := range s.entries {
		if entry == nil || entry.state == itemDone {
			continue
		}
		if ownerID != nil {
			if entry.identity.Scope != ScopeUser ||
				entry.identity.OwnerID != *ownerID {
				continue
			}
		}
		state := "queued"
		if entry.state == itemRunning {
			state = "running"
			if entry.cancelRequested {
				state = "cancelling"
			}
		}
		var startedAt *time.Time
		if entry.startedAt != nil {
			value := entry.startedAt.UTC()
			startedAt = &value
		}
		var readyAt *time.Time
		if !entry.readyAt.IsZero() {
			value := entry.readyAt.UTC()
			readyAt = &value
		}
		out = append(out, RuntimeTaskSnapshot{
			Identity:      entry.identity,
			Kind:          entry.task.Kind,
			GroupKey:      entry.task.GroupKey,
			State:         state,
			Trigger:       entry.task.Trigger,
			Initiator:     entry.task.Initiator,
			InitiatorID:   entry.task.InitiatorID,
			ParentKey:     entry.task.ParentKey,
			TraceID:       entry.task.TraceID,
			Priority:      entry.task.Priority,
			Resource:      entry.task.Resource,
			Attempt:       entry.attempt,
			Progress:      entry.progress,
			SubmittedAt:   entry.submittedAt.UTC(),
			StartedAt:     startedAt,
			UpdatedAt:     entry.updatedAt.UTC(),
			ReadyAt:       readyAt,
			LeaseDeferred: entry.leaseDeferred,
		})
	}
	s.mu.Unlock()

	sort.Slice(out, func(i, j int) bool {
		if !out[i].SubmittedAt.Equal(out[j].SubmittedAt) {
			return out[i].SubmittedAt.Before(out[j].SubmittedAt)
		}
		if out[i].Identity.Scope != out[j].Identity.Scope {
			return out[i].Identity.Scope < out[j].Identity.Scope
		}
		if out[i].Identity.OwnerID != out[j].Identity.OwnerID {
			return out[i].Identity.OwnerID < out[j].Identity.OwnerID
		}
		return out[i].Identity.Key < out[j].Identity.Key
	})
	return out
}

func (s *Scheduler) Snapshot() MetricsSnapshot {
	if s == nil {
		return MetricsSnapshot{}
	}
	snapshot := MetricsSnapshot{ByResource: make(map[ResourceClass]ResourceSnapshot)}
	s.metrics.mu.Lock()
	snapshot.Submitted = s.metrics.submitted
	snapshot.Started = s.metrics.started
	snapshot.Completed = s.metrics.completed
	snapshot.Failed = s.metrics.failed
	snapshot.Cancelled = s.metrics.cancelled
	snapshot.Retried = s.metrics.retried
	snapshot.Deduplicated = s.metrics.deduplicated
	snapshot.Promoted = s.metrics.promoted
	snapshot.Backpressured = s.metrics.backpressured
	snapshot.LeaseUnavailable = s.metrics.leaseUnavailable
	snapshot.LeaseLost = s.metrics.leaseLost
	snapshot.Expired = s.metrics.expired
	snapshot.Superseded = s.metrics.superseded
	for resource, running := range s.metrics.running {
		rs := snapshot.ByResource[resource]
		rs.Running = running
		snapshot.ByResource[resource] = rs
		snapshot.Running += running
	}
	s.metrics.mu.Unlock()
	for resource, q := range s.queues {
		q.mu.Lock()
		queued := len(q.items)
		q.mu.Unlock()
		rs := snapshot.ByResource[resource]
		rs.Queued = queued
		snapshot.ByResource[resource] = rs
		snapshot.Queued += queued
	}
	return snapshot
}

func (s *Scheduler) worker(resource ResourceClass, q *resourceQueue) {
	defer s.wg.Done()
	for {
		entry, ok := q.next(s.ctx)
		if !ok {
			return
		}
		s.runEntry(resource, q, entry)
	}
}

func (s *Scheduler) runEntry(resource ResourceClass, q *resourceQueue, entry *taskEntry) {
	baseCtx, cancel := context.WithCancelCause(s.ctx)
	runCtx := context.Context(baseCtx)
	stopTimeout := func() {}
	if entry.task.RunTimeout > 0 {
		var timeoutCancel context.CancelFunc
		runCtx, timeoutCancel = context.WithTimeoutCause(baseCtx, entry.task.RunTimeout, ErrRunTimeout)
		stopTimeout = timeoutCancel
	}
	defer stopTimeout()

	s.mu.Lock()
	if s.closed || entry.state != itemQueued {
		s.mu.Unlock()
		cancel(ErrClosed)
		return
	}
	if !entry.task.NotAfter.IsZero() && !time.Now().Before(entry.task.NotAfter) {
		entry.state = itemDone
		delete(s.entries, entry.identity)
		s.mu.Unlock()
		s.metrics.mu.Lock()
		s.metrics.expired++
		s.metrics.mu.Unlock()
		entry.handle.complete(ErrExpired)
		cancel(ErrExpired)
		return
	}
	now := time.Now().UTC()
	entry.state = itemRunning
	entry.cancel = cancel
	entry.leaseDeferred = false
	entry.startedAt = &now
	entry.updatedAt = now
	runCtx = context.WithValue(
		runCtx,
		progressReporterKey{},
		func(progress TaskProgress) {
			s.updateTaskProgress(entry.identity, progress)
		},
	)
	s.metrics.mu.Lock()
	s.metrics.started++
	s.metrics.running[resource]++
	s.metrics.mu.Unlock()
	s.mu.Unlock()

	err := s.execute(runCtx, cancel, entry)
	cancel(err)

	s.metrics.mu.Lock()
	s.metrics.running[resource]--
	if errors.Is(err, ErrLeaseLost) {
		s.metrics.leaseLost++
	}
	s.metrics.mu.Unlock()

	s.mu.Lock()
	cancelRequested := entry.cancelRequested
	if cancelRequested && s.ctx.Err() == nil {
		err = context.Canceled
	}

	if !s.closed && !cancelRequested && s.ctx.Err() == nil && entry.state == itemRunning &&
		errors.Is(err, ErrLeaseUnavailable) {
		entry.readyAt = time.Now().Add(s.leaseRetryDelay)
		entry.state = itemQueued
		entry.cancel = nil
		entry.leaseDeferred = true
		entry.updatedAt = time.Now().UTC()
		s.metrics.mu.Lock()
		s.metrics.leaseUnavailable++
		s.metrics.mu.Unlock()
		_ = q.push(entry, false)
		s.mu.Unlock()
		return
	}

	if !s.closed && !cancelRequested && s.ctx.Err() == nil &&
		entry.state == itemRunning &&
		entry.task.Retry.retryable(err, entry.attempt) {
		entry.attempt++
		entry.readyAt = time.Now().Add(entry.task.Retry.delay(entry.attempt-1, entry.identity))
		entry.state = itemQueued
		entry.cancel = nil
		entry.updatedAt = time.Now().UTC()
		s.metrics.mu.Lock()
		s.metrics.retried++
		s.metrics.mu.Unlock()
		_ = q.push(entry, false)
		s.mu.Unlock()
		return
	}
	if entry.state != itemDone {
		entry.state = itemDone
		entry.cancel = nil
		delete(s.entries, entry.identity)
	}
	s.mu.Unlock()

	switch {
	case s.ctx.Err() != nil, errors.Is(err, context.Canceled), errors.Is(err, ErrClosed):
		s.metrics.mu.Lock()
		s.metrics.cancelled++
		s.metrics.mu.Unlock()
	case errors.Is(err, ErrExpired):
		s.metrics.mu.Lock()
		s.metrics.expired++
		s.metrics.mu.Unlock()
	case err != nil:
		s.metrics.mu.Lock()
		s.metrics.failed++
		s.metrics.mu.Unlock()
	default:
		s.metrics.mu.Lock()
		s.metrics.completed++
		s.metrics.mu.Unlock()
	}
	entry.handle.complete(err)
}

func (s *Scheduler) execute(ctx context.Context, cancel context.CancelCauseFunc, entry *taskEntry) (runErr error) {
	descriptor := Descriptor{
		Key:          entry.task.Key,
		Scope:        entry.task.Scope,
		OwnerID:      entry.task.OwnerID,
		Trigger:      entry.task.Trigger,
		Initiator:    entry.task.Initiator,
		InitiatorID:  entry.task.InitiatorID,
		ParentKey:    entry.task.ParentKey,
		TraceID:      entry.task.TraceID,
		SupersedeKey: entry.task.SupersedeKey,
		Priority:     entry.task.Priority,
		Resource:     entry.task.Resource,
		Attempt:      entry.attempt,
		RunTimeout:   entry.task.RunTimeout,
		NotAfter:     entry.task.NotAfter,
	}

	var lease Lease
	if entry.task.Lease != nil {
		acquiredLease, acquired, err := entry.task.Lease(ctx, descriptor)
		if err != nil {
			return err
		}
		if !acquired {
			return ErrLeaseUnavailable
		}
		lease = acquiredLease
		if lease.Release != nil {
			defer func() {
				releaseCtx, releaseCancel := context.WithTimeout(context.Background(), s.releaseTimeout)
				defer releaseCancel()
				if err := lease.Release(releaseCtx, runErr); err != nil && runErr == nil {
					runErr = err
				}
			}()
		}
	}

	heartbeatDone := make(chan struct{})
	if lease.Heartbeat != nil && entry.task.HeartbeatInterval > 0 {
		go func() {
			defer close(heartbeatDone)
			ticker := time.NewTicker(entry.task.HeartbeatInterval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if err := lease.Heartbeat(ctx); err != nil {
						if errors.Is(err, context.Canceled) {
							cancel(context.Canceled)
						} else {
							cancel(fmt.Errorf("%w: %v", ErrLeaseLost, err))
						}
						return
					}
				}
			}
		}()
	} else {
		close(heartbeatDone)
	}

	err := entry.task.Run(ctx)
	if cause := context.Cause(ctx); cause != nil && !errors.Is(cause, context.Canceled) {
		runErr = cause
	} else {
		runErr = err
	}
	cancel(runErr)
	<-heartbeatDone
	return runErr
}
