package pullworker

import (
	"context"
	"strings"
)

type ScanMode string

const (
	ScanModeFull    ScanMode = "full"
	ScanModeChanges ScanMode = "changes"
)

// ChangeScanCapabilities records the safety properties a connector must prove
// before the shared Source layer may choose ScanChanges. Provider pagination
// cursors, mtimes, indexed timestamps, or similar listing hints do not satisfy
// this contract by themselves.
type ChangeScanCapabilities struct {
	IncrementalChanges bool
	StableIdentity     bool
	ReliableCheckpoint bool
	DeletionTombstones bool
	FullFallback       bool
}

func (c ChangeScanCapabilities) SupportsIncrementalChanges() bool {
	return c.IncrementalChanges &&
		c.StableIdentity &&
		c.ReliableCheckpoint &&
		c.DeletionTombstones &&
		c.FullFallback
}

func FullReconciliationOnly() ChangeScanCapabilities {
	return ChangeScanCapabilities{}
}

type SourceChangeCapabilityProvider interface {
	PullSourceChangeCapabilities() ChangeScanCapabilities
}

type FullScanner[T any] interface {
	ScanFull(context.Context) (T, error)
}

type ChangeScanner[T any] interface {
	FullScanner[T]
	ScanChanges(context.Context, string) (T, string, error)
}

type ChangeScanDecision struct {
	Mode              ScanMode
	Checkpoint        string
	CompleteInventory bool
}

// ResolveChangeScan chooses the only safe scan mode for a capability set.
// Incremental runs are never complete inventories: deletions must come from
// explicit tombstones, not from unseen-item inference.
func ResolveChangeScan(capabilities ChangeScanCapabilities, checkpoint string, forceFull bool) ChangeScanDecision {
	checkpoint = strings.TrimSpace(checkpoint)
	if forceFull || checkpoint == "" || !capabilities.SupportsIncrementalChanges() {
		return ChangeScanDecision{Mode: ScanModeFull, CompleteInventory: true}
	}
	return ChangeScanDecision{
		Mode: ScanModeChanges, Checkpoint: checkpoint, CompleteInventory: false,
	}
}

func SourceChangeCapabilities(handler SourceHandler) ChangeScanCapabilities {
	if provider, ok := handler.(SourceChangeCapabilityProvider); ok {
		return provider.PullSourceChangeCapabilities()
	}
	return FullReconciliationOnly()
}
