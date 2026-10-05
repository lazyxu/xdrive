package pullworker

import (
	"context"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/meta"
)

type changeScanTestResult struct{}
type changeScanTestScanner struct{}

func (changeScanTestScanner) ScanFull(context.Context) (changeScanTestResult, error) {
	return changeScanTestResult{}, nil
}
func (changeScanTestScanner) ScanChanges(context.Context, string) (changeScanTestResult, string, error) {
	return changeScanTestResult{}, "next", nil
}

var _ FullScanner[changeScanTestResult] = changeScanTestScanner{}
var _ ChangeScanner[changeScanTestResult] = changeScanTestScanner{}

type changeScanTestHandler struct{ capabilities ChangeScanCapabilities }

func (h changeScanTestHandler) RunPullSource(context.Context, meta.Source) (client.SyncRun, error) {
	return client.SyncRun{}, nil
}
func (h changeScanTestHandler) PullSourceChangeCapabilities() ChangeScanCapabilities {
	return h.capabilities
}

func provenChangeCapabilities() ChangeScanCapabilities {
	return ChangeScanCapabilities{
		IncrementalChanges: true,
		StableIdentity:     true,
		ReliableCheckpoint: true,
		DeletionTombstones: true,
		FullFallback:       true,
	}
}

func TestResolveChangeScanRequiresProvenContractAndCheckpoint(t *testing.T) {
	proven := provenChangeCapabilities()
	decision := ResolveChangeScan(proven, " opaque-checkpoint ", false)
	if decision.Mode != ScanModeChanges || decision.Checkpoint != "opaque-checkpoint" || decision.CompleteInventory {
		t.Fatalf("incremental decision = %+v", decision)
	}

	for name, mutate := range map[string]func(*ChangeScanCapabilities){
		"incremental": func(c *ChangeScanCapabilities) { c.IncrementalChanges = false },
		"identity":    func(c *ChangeScanCapabilities) { c.StableIdentity = false },
		"checkpoint":  func(c *ChangeScanCapabilities) { c.ReliableCheckpoint = false },
		"deletions":   func(c *ChangeScanCapabilities) { c.DeletionTombstones = false },
		"fallback":    func(c *ChangeScanCapabilities) { c.FullFallback = false },
	} {
		t.Run(name, func(t *testing.T) {
			capabilities := proven
			mutate(&capabilities)
			got := ResolveChangeScan(capabilities, "checkpoint", false)
			if got.Mode != ScanModeFull || !got.CompleteInventory || got.Checkpoint != "" {
				t.Fatalf("unsafe capability decision = %+v", got)
			}
		})
	}

	for name, got := range map[string]ChangeScanDecision{
		"empty checkpoint": ResolveChangeScan(proven, "   ", false),
		"forced full":      ResolveChangeScan(proven, "checkpoint", true),
	} {
		t.Run(name, func(t *testing.T) {
			if got.Mode != ScanModeFull || !got.CompleteInventory || got.Checkpoint != "" {
				t.Fatalf("full decision = %+v", got)
			}
		})
	}
}

func TestSourceChangeCapabilitiesDefaultsToFullOnly(t *testing.T) {
	plain := SourceHandlerFunc(func(context.Context, meta.Source) (client.SyncRun, error) {
		return client.SyncRun{}, nil
	})
	if got := SourceChangeCapabilities(plain); got.SupportsIncrementalChanges() {
		t.Fatalf("plain handler unexpectedly supports incremental changes: %+v", got)
	}
	proven := provenChangeCapabilities()
	if got := SourceChangeCapabilities(changeScanTestHandler{capabilities: proven}); got != proven {
		t.Fatalf("declared capabilities = %+v, want %+v", got, proven)
	}
}
