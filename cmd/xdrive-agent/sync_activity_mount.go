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
 case mount.EventSyncStarted,mount.EventSyncCompleted,mount.EventSyncFailed,mount.EventSyncDeferred,mount.EventSyncItemCommitted:
 default:return
 }
 c.syncActivityMu.Lock()
 defer c.syncActivityMu.Unlock()
 if c.syncActivity==nil || c.syncActivityKey!=event.ActivityOwner{return}
 store,err:=c.syncActivityForCurrentAccount()
 if err!=nil{return}
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
  }
 case mount.EventSyncItemCommitted:
  if c.syncActivityPending==nil {return}
  buffered,ok:=c.syncActivityPending[event.RunID]
  if !ok{return}
  if len(buffered)>=500 {
   // Never grow an unbounded in-memory backlog after a disk error.
   log.Printf("xDrive sync activity buffer is full for run %s",event.RunID)
   return
  }
  receipt:=syncactivity.Item{
   RunID:event.RunID,ID:event.ItemID,Action:event.Action,Direction:event.Direction,
   OldPath:event.OldPath,NewPath:event.Path,Status:"completed",
   LogicalBytes:event.LogicalBytes,TransferredBytes:event.TransferredBytes,
   AppliedAt:time.Now().UTC(),
  }
  buffered=append(buffered,receipt)
  c.syncActivityPending[event.RunID]=buffered
  if len(buffered)==500 {
   err=store.AppendBatch(ctx,buffered)
   if err==nil{c.syncActivityPending[event.RunID]=nil}
  }
 case mount.EventSyncCompleted,mount.EventSyncDeferred,mount.EventSyncFailed:
  if buffered,ok:=c.syncActivityPending[event.RunID];ok && len(buffered)>0 {
   if flushErr:=store.AppendBatch(ctx,buffered);flushErr!=nil{
    log.Printf("xDrive sync activity terminal batch not durable (%s): %v",event.RunID,flushErr)
   }
  }
  delete(c.syncActivityPending,event.RunID)
  switch event.Kind {
  case mount.EventSyncCompleted:
   // The Mount code still has mutation paths without receipt coverage.
   err=store.Finish(ctx,event.RunID,syncactivity.StatusCompleted,false)
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
}
