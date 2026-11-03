package main

import (
 "context"
 "path/filepath"
 "testing"
 "time"

 "github.com/lazyxu/xdrive/internal/mount"
 "github.com/lazyxu/xdrive/internal/syncactivity"
)

func TestMountActivityReceiptsRecordConflictsAndFenceOwnerSwitch(t *testing.T) {
 store, err := syncactivity.Open(filepath.Join(t.TempDir(), "sync-history.sqlite"), "owner-a")
 if err != nil { t.Fatal(err) }
 defer store.Close()
 c := &agentController{
  syncActivity: store,
  syncActivityKey: "owner-a",
  syncActivityPending: make(map[string][]syncactivity.Item),
  syncActivityLost: make(map[string]bool),
  syncActivityPrunedAt: time.Now(),
 }
 c.captureMountSyncActivity(mount.Event{
  Kind:mount.EventSyncStarted,RunID:"r1",ActivityOwner:"owner-a",Trigger:"local",
 })
 size:=int64(35)
 c.captureMountSyncActivity(mount.Event{
  Kind:mount.EventSyncItemCommitted,RunID:"r1",ActivityOwner:"owner-a",
  ItemID:"successful-file",Action:"create",Direction:"upload",Path:"files/a.txt",LogicalBytes:&size,
 })
 c.captureMountSyncActivity(mount.Event{
  Kind:mount.EventConflict,RunID:"r1",ActivityOwner:"owner-a",
  ItemID:"conflict-copy",Path:"files/a (conflict).txt",OriginalPath:"files/a.txt",
 })
 c.captureMountSyncActivity(mount.Event{
  Kind:mount.EventSyncCompleted,RunID:"r1",ActivityOwner:"owner-a",
 })
 run,err:=store.Get(context.Background(),"r1")
 if err!=nil {t.Fatal(err)}
 if run.Status!=syncactivity.StatusPartial || run.DetailComplete ||
  run.Stats.Items!=2 || run.Stats.Created!=1 || run.Stats.Conflicted!=1 || run.Stats.Uploaded!=1 {
  t.Fatalf("inaccurate sync receipt or conflict status: %+v",run)
 }
 items,err:=store.Items(context.Background(),"r1",20,nil)
 if err!=nil||len(items)!=2{t.Fatalf("missing file results: %+v %v",items,err)}
 c.captureMountSyncActivity(mount.Event{
  Kind:mount.EventSyncStarted,RunID:"wrong-account",ActivityOwner:"owner-b",Trigger:"manual",
 })
 if _,err:=store.Get(context.Background(),"wrong-account");err!=syncactivity.ErrNotFound {
  t.Fatalf("old or other account wrote a run: %v",err)
 }
}

func TestMountActivityIncompleteReceiptNeverCompletes(t *testing.T){
 store,err:=syncactivity.Open(filepath.Join(t.TempDir(),"sync-history.sqlite"),"owner-a")
 if err!=nil{t.Fatal(err)}
 defer store.Close()
 c:=&agentController{
  syncActivity:store,syncActivityKey:"owner-a",
  syncActivityPending:make(map[string][]syncactivity.Item),
  syncActivityLost:make(map[string]bool),
  syncActivityPrunedAt:time.Now(),
 }
 c.captureMountSyncActivity(mount.Event{Kind:mount.EventSyncStarted,RunID:"r2",ActivityOwner:"owner-a",Trigger:"manual"})
 // A malformed item receipt must not permit the terminal status to become
 // "completed" after its database transaction was rejected.
 c.captureMountSyncActivity(mount.Event{
  Kind:mount.EventSyncItemCommitted,RunID:"r2",ActivityOwner:"owner-a",
  ItemID:"broken",Action:"invalid-action",Direction:"upload",Path:"x",
 })
 c.captureMountSyncActivity(mount.Event{Kind:mount.EventSyncCompleted,RunID:"r2",ActivityOwner:"owner-a"})
 run,err:=store.Get(context.Background(),"r2")
 if err!=nil{t.Fatal(err)}
 if run.Status!=syncactivity.StatusInterrupted || run.DetailComplete || run.Outcome=="no_change"{
  t.Fatalf("lost item was reported successful: %+v",run)
 }
}
