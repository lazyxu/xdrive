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
 case mount.EventSyncStarted,mount.EventSyncCompleted,mount.EventSyncFailed,mount.EventSyncDeferred:
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
 case mount.EventSyncCompleted:
  // A successful Mount reconciliation does not prove every item was observed.
  err=store.Finish(ctx,event.RunID,syncactivity.StatusCompleted,false)
 case mount.EventSyncDeferred:
  // Cloud Files hydration settling is a deferred attempt, not "sync failed".
  err=store.Finish(ctx,event.RunID,syncactivity.StatusInterrupted,false)
 case mount.EventSyncFailed:
  status:=syncactivity.StatusFailed
  // Once item instrumentation lands, a failed attempt with committed changes
  // must report partial success rather than erase its successful receipts.
  if run,readErr:=store.Get(ctx,event.RunID);readErr==nil && run.Stats.Successful>0{
   status=syncactivity.StatusPartial
  }
  err=store.Finish(ctx,event.RunID,status,false)
 }
 if err!=nil && !errors.Is(err,syncactivity.ErrTerminal){
  log.Printf("xDrive sync activity receipt unavailable (%s): %v",event.Kind,err)
 }
}
