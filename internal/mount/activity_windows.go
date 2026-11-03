//go:build windows

package mount

import (
 "github.com/google/uuid"
)

// The run ID identifies one execution attempt (not an individual file).
// The captured owner key is provided by the owning Agent at Mount creation;
// an old Mount cannot write a subsequent account's history.
func (p *winProvider) beginActivity(trigger string) string {
 id:=uuid.NewString()
 p.activityRunID=id
 emitEvent(Event{
  Kind:EventSyncStarted,
  RunID:id,
  Trigger:trigger,
  ActivityOwner:p.activityOwner,
 })
 return id
}

func (p *winProvider) finishActivity(runID string,err error,notify bool) {
 evt:=Event{Kind:EventSyncCompleted,RunID:runID,ActivityOwner:p.activityOwner,Notify:notify}
 if err!=nil{
  evt.Kind=EventSyncFailed
  evt.Message=err.Error()
 }
 emitEvent(evt)
 if p.activityRunID==runID{p.activityRunID=""}
}

func (p *winProvider) deferActivity(runID string) {
 emitEvent(Event{Kind:EventSyncDeferred,RunID:runID,ActivityOwner:p.activityOwner})
 if p.activityRunID==runID{p.activityRunID=""}
}

// Only call after the actual remote/local metadata operation has committed.
// Bytes transmitted by a resumable/CAS upload cannot be inferred from file
// length, so this receipt intentionally leaves transferred_bytes unknown.
func (p *winProvider) recordActivity(action,direction,oldPath,newPath string,logicalBytes *int64) {
 if p.activityRunID=="" || p.activityOwner=="" {return}
 emitEvent(Event{
  Kind:EventSyncItemCommitted,RunID:p.activityRunID,ActivityOwner:p.activityOwner,
  ItemID:uuid.NewString(),Action:action,Direction:direction,
  OldPath:oldPath,Path:newPath,LogicalBytes:logicalBytes,
 })
}

