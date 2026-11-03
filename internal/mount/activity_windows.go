//go:build windows

package mount

import (
	"github.com/google/uuid"
)

// The run ID identifies one execution attempt (not an individual fle).
// The captured owner key is provided by the owning Agent at Mount creation;
// an old Mount cannot write a subsequent account's history.
func (p *winProvider) beginActivity(trigger string) string {
	id := uuid.NewString()
	p.activityRunID = id
	emitEvent(Event{
		Kind:          EventSyncStarted,
		RunID:         id,
		Trigger:       trigger,
		ActivityOwner: p.activityOwner,
	})
	return id
}

func (p *winProvider) finishActivity(runID string, err error, notify bool) {
	evt := Event{Kind: EventSyncCompleted, RunID: runID, ActivityOwner: p.activityOwner, Notify: notify}
	if err != nil {
		evt.Kind = EventSyncFailed
		evt.Message = err.Error()
	}
	emitEvent(evt)
	if p.activityRunID == runID {
		p.activityRunID = ""
	}
}

func (p *winProvider) deferActivity(runID string) {
	emitEvent(Event{Kind: EventSyncDeferred, RunID: runID, ActivityOwner: p.activityOwner})
	if p.activityRunID == runID {
		p.activityRunID = ""
	}
}

// Only call after the actual remote/local metadata operation has committed.
// Bytes transmitted by a resumable/CAS upload cannot be inferred from fle
// length, so this receipt intentionally leaves transferred_bytes unknown.
func (p *winProvider) recordActivity(action, direction, oldPath, newPath string, logicalBytes *int64) {
	if p.activityOwner == "" {
		return
	}
	if p.activityRunID == "" && p.activityTrigger != "" {
		p.beginActivity(p.activityTrigger)
	}
	if p.activityRunID == "" {
		return
	}
	emitEvent(Event{
		Kind: EventSyncItemCommitted, RunID: p.activityRunID, ActivityOwner: p.activityOwner,
		ItemID: uuid.NewString(), Action: action, Direction: direction,
		OldPath: oldPath, Path: newPath, LogicalBytes: logicalBytes,
	})
}

// notifyConflict preserves the existing conflict notification and ties its
// affected file to the current run without exposing a different Owner's data.
func (p *winProvider) notifyConflict(conflictPath, originalPath string, originalNodeID, conflictNodeID uint64) {
 if p.activityRunID == "" && p.activityTrigger != "" {
  p.beginActivity(p.activityTrigger)
 }
 emitEvent(Event{
  Kind: EventConflict,
  Path: conflictPath,
  OriginalPath: originalPath,
  OriginalNodeID: originalNodeID,
  ConflictNodeID: conflictNodeID,
  RunID: p.activityRunID,
  ActivityOwner: p.activityOwner,
  ItemID: uuid.NewString(),
 })
}

// finishBackgroundActivity avoids recording idle successful scans but persists
// failed remote/audit attempts even when no file mutation was observed.
func (p *winProvider) finishBackgroundActivity(trigger string, err error) {
	if p.activityRunID == "" && err != nil {
		p.beginActivity(trigger)
	}
	if p.activityRunID != "" {
		p.finishActivity(p.activityRunID, err, false)
	}
}
