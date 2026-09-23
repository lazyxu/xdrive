package mount

import "sync"

type EventKind string

const (
	EventConflict EventKind = "conflict"
)

type Event struct {
	Kind EventKind
	Path string
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
