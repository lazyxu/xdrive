package mount

import "sync"

type EventKind string

const (
	EventSyncStarted   EventKind = "sync_started"
	EventSyncCompleted EventKind = "sync_completed"
	EventSyncFailed    EventKind = "sync_failed"
	EventConflict      EventKind = "conflict"
)

type Event struct {
	Kind           EventKind
	Path           string
	OriginalPath   string
	OriginalNodeID uint64
	ConflictNodeID uint64
	Message        string
	Notify         bool
}

var mountEventSink struct {
	sync.RWMutex
	fn func(Event)
}

func SetEventSink(fn func(Event)) {
	mountEventSink.Lock()
	mountEventSink.fn = fn
	mountEventSink.Unlock()
}

func emitEvent(event Event) {
	mountEventSink.RLock()
	fn := mountEventSink.fn
	mountEventSink.RUnlock()
	if fn != nil {
		fn(event)
	}
}
