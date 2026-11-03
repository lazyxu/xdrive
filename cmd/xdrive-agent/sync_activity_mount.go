package main

import (
 "context"
 "errors"
 "log"
 "time"

 "github.com/lazyxu/xdrive/internal/mount"
 "github.com/lazyxu/xdrive/internal/syncactivity"
)

// A Mount instance carries the exact hashed Owner scope captured at creation.
// A stale old-account Mount is NEVER allowed to begin or finish a run in the
// next account's store, even when callbacks arrive during a login switch.
func (c *agentController) captureMountSyncActivity(event mount.Event){
 if event.RunID=="" || event.ActivityOwner=="" {return}
 switch event.Kind {
 case mount.EventSyncStarted,mount.EventSyncCompleted,mount.EventSyncFailed,mount.EventSyncDeferred,mount.EventSyncItemCommitted,mount.EventConflict:
 default:return
 }
 c.syncActivityMu.Lock()
 defer c.syncActivityMu.Unlock()
 if c.syncActivity==nil || c.syncActivityKey!=event.ActivityOwner{return}
 // The event was stamped with the Mount's immutable Owner key at creation.
 // The mutex + key check above fence an old Mount after login switch; avoid
 // re-reading userconfig from disk for every file during a large sync.
 store:=c.syncActivity
 var err error
 ctx,cancel:=context.WithTimeout(context.Background(),10*time.Second)
 defer cancel()
 switch event.Kind {
 case mount.EventSyncStarted:
  trigger:=event.Trigger
  if trigger==""{trigger="unknown"}
  err=store.Begin(ctx,syncactivity.Run{
   ID:event.RunID,Engine:"mount",Trigger:trigger,StartedAt:time.Now().UTC(),
  })
  if err==nil {
   if c.syncActivityPending==nil{c.syncActivityPending=make(map[string][]syncactivity.Item)}
   c.syncActivityPending[event.RunID]=nil
   delete(c.syncActivityLost,event.RunID)
  }
 case mount.EventSyncItemCommitted,mount.EventConflict:
  if c.syncActivityPending==nil {return}
  buffered,ok:=c.syncActivityPending[event.RunID]
  if !ok{return}
  if c.syncActivityLost[event.RunID] {return}
  if len(buffered)>=500 {
   // Lost receipts must permanently downgrade the run to interrupted.
   // Otherwise the UI could falsely imply its history is trustworthy.
   c.syncActivityLost[event.RunID]=true
   log.Printf("xDrive sync activity item buffer full for run %s",event.RunID)
   return
  }
  receipt:=syncactivity.Item{
   RunID:event.RunID,ID:event.ItemID,Action:event.Action,Direction:event.Direction,
   OldPath:event.OldPath,NewPath:event.Path,Status:"completed",
   LogicalBytes:event.LogicalBytes,TransferredBytes:event.TransferredBytes,
   AppliedAt:time.Now().UTC(),
  }
  if event.Kind==mount.EventConflict {
   receipt.Action="create"
   receipt.Direction="none"
   receipt.Status="conflict"
   receipt.OldPath=event.OriginalPath
   receipt.NewPath=event.Path
  }
  buffered=append(buffered,receipt)
  c.syncActivityPending[event.RunID]=buffered
  if len(buffered)==500 {
   err=store.AppendBatch(ctx,buffered)
   if err==nil{
    c.syncActivityPending[event.RunID]=nil
   } else {
    c.syncActivityLost[event.RunID]=true
   }
  }
 case mount.EventSyncCompleted,mount.EventSyncDeferred,mount.EventSyncFailed:
  lost:=c.syncActivityLost[event.RunID]
  if buffered,ok:=c.syncActivityPending[event.RunID];ok && len(buffered)>0 {
   if flushErr:=store.AppendBatch(ctx,buffered);flushErr!=nil{
    lost=true
    log.Printf("xDrive sync activity terminal batch not durable (%s): %v",event.RunID,flushErr)
   }
  }
  delete(c.syncActivityPending,event.RunID)
  delete(c.syncActivityLost,event.RunID)
  if lost {
   // When any committed item receipt was dropped, the run is not complete,
   // regardless of a successful file-engine status transition.
   err=store.Finish(ctx,event.RunID,syncactivity.StatusInterrupted,false)
   break
  }
  switch event.Kind {
  case mount.EventSyncCompleted:
   // An engine can finish reconciling and still have unresolved conflicts.
   // Do not publish that run as fully completed if any conflict was retained.
   status:=syncactivity.StatusCompleted
   if run,readErr:=store.Get(ctx,event.RunID);readErr==nil && run.Stats.Conflicted>0 {
    status=syncactivity.StatusPartial
   }
   err=store.Finish(ctx,event.RunID,status,false)
  case mount.EventSyncDeferred:
   err=store.Finish(ctx,event.RunID,syncactivity.StatusInterrupted,false)
  case mount.EventSyncFailed:
   status:=syncactivity.StatusFailed
   if run,readErr:=store.Get(ctx,event.RunID);readErr==nil && run.Stats.Successful>0{
    status=syncactivity.StatusPartial
   }
   err=store.Finish(ctx,event.RunID,status,false)
  }
 }
 if err!=nil && !errors.Is(err,syncactivity.ErrTerminal){
  log.Printf("xDrive sync activity receipt unavailable (%s): %v",event.Kind,err)
 }
 if err==nil && event.Kind!=mount.EventSyncStarted &&
  event.Kind!=mount.EventSyncItemCommitted && event.Kind!=mount.EventConflict &&
  time.Since(c.syncActivityPrunedAt)>=24*time.Hour {
  now:=time.Now().UTC()
  if cleanupErr:=store.Prune(ctx,now);cleanupErr!=nil {
   log.Printf("xDrive sync activity retention cleanup failed: %v",cleanupErr)
  } else {
   c.syncActivityPrunedAt=now
  }
 }
}
