package syncactivity

import (
 "context"
 "errors"
 "os"
 "path/filepath"
 "testing"
 "time"
)

func openTestStore(t *testing.T) *Store {
 t.Helper()
 s,err:=Open(filepath.Join(t.TempDir(),"activity.db"),"https://nas.example\x00alice")
 if err!=nil{t.Fatal(err)}
 t.Cleanup(func(){_ = s.Close()})
 return s
}

func ptr(n int64)*int64{return &n}
func beginRun(t *testing.T,s *Store,id string,started time.Time){
 t.Helper()
 if err:=s.Begin(context.Background(),Run{ID:id,Engine:"mount",Trigger:"manual",StartedAt:started});err!=nil{t.Fatal(err)}
}
func item(run,id,action,direction string,logical,network *int64)Item{
 return Item{RunID:run,ID:id,Action:action,Direction:direction,Status:"completed",NewPath:"docs/"+id,LogicalBytes:logical,TransferredBytes:network,AppliedAt:time.Date(2026,11,3,1,0,0,0,time.UTC)}
}

func TestRunReceiptsAreDurableIdempotentAndCursorPaged(t *testing.T){
 ctx:=context.Background()
 s:=openTestStore(t)
 started:=time.Date(2026,11,3,1,0,0,0,time.UTC)
 beginRun(t,s,"r1",started)
 x:=item("r1","file-1","create","upload",ptr(3),ptr(2))
 if err:=s.Append(ctx,x);err!=nil{t.Fatal(err)}
 if err:=s.Append(ctx,x);err!=nil{t.Fatalf("same event should be idempotent: %v",err)}
 changed:=x;changed.NewPath="docs/different"
 if err:=s.Append(ctx,changed);!errors.Is(err,ErrReceiptConflict){t.Fatalf("conflicting replay: %v",err)}
 if err:=s.Append(ctx,item("r1","file-2","update","local",ptr(6),nil));err!=nil{t.Fatal(err)}
 if err:=s.Finish(ctx,"r1",StatusCompleted,true);err!=nil{t.Fatal(err)}
 r,err:=s.Get(ctx,"r1");if err!=nil{t.Fatal(err)}
 if r.Stats.Items!=2||r.Stats.Successful!=2||r.Stats.Created!=1||r.Stats.Updated!=1||r.Stats.Uploaded!=1||r.Stats.Downloaded!=0||r.Stats.TransferredBytes==nil||*r.Stats.TransferredBytes!=2{
  t.Fatalf("miscounted receipts: %+v",r)
 }
 if !r.DetailComplete||r.Outcome!="changed"{t.Fatalf("wrong outcome: %+v",r)}
 if err:=s.Append(ctx,item("r1","late","create","upload",ptr(1),nil));!errors.Is(err,ErrTerminal){t.Fatalf("late item: %v",err)}
 page,err:=s.Items(ctx,"r1",1,nil);if err!=nil||len(page)!=1{t.Fatalf("first page: %v %+v",err,page)}
 next,err:=s.Items(ctx,"r1",5,&ItemCursor{AppliedAt:page[0].AppliedAt,ID:page[0].ID})
 if err!=nil||len(next)!=1||next[0].ID==page[0].ID{t.Fatalf("next page: %v %+v",err,next)}
 beginRun(t,s,"r2",started.Add(time.Second))
 if err:=s.Finish(ctx,"r2",StatusCompleted,false);err!=nil{t.Fatal(err)}
 empty,err:=s.Get(ctx,"r2");if err!=nil{t.Fatal(err)}
 if empty.Outcome=="no_change" {t.Fatal("unverified empty run must not claim no changes")}
 list,err:=s.List(ctx,1,nil);if err!=nil||len(list)!=1||list[0].ID!="r2"{t.Fatalf("first run page: %+v %v",list,err)}
 other,err:=s.List(ctx,1,&RunCursor{StartedAt:list[0].StartedAt,ID:list[0].ID})
 if err!=nil||len(other)!=1||other[0].ID!="r1"{t.Fatalf("next run page: %+v %v",other,err)}
}

func TestExplicitVerifiedNoChangeAndPartialFailure(t *testing.T){
 ctx:=context.Background()
 s:=openTestStore(t)
 now:=time.Now().UTC()
 beginRun(t,s,"empty",now)
 if err:=s.Finish(ctx,"empty",StatusCompleted,true);err!=nil{t.Fatal(err)}
 r,err:=s.Get(ctx,"empty");if err!=nil||r.Outcome!="no_change"{t.Fatalf("verified empty: %+v %v",r,err)}
 beginRun(t,s,"partial",now.Add(time.Second))
 if err:=s.Append(ctx,item("partial","ok","create","upload",ptr(1),ptr(1)));err!=nil{t.Fatal(err)}
 bad:=item("partial","bad","create","upload",ptr(1),nil);bad.Status="failed";bad.ErrorCode="permission_denied"
 if err:=s.Append(ctx,bad);err!=nil{t.Fatal(err)}
 if err:=s.Finish(ctx,"partial",StatusCompleted,true);!errors.Is(err,ErrIncomplete){t.Fatalf("false completion accepted: %v",err)}
 if err:=s.Finish(ctx,"partial",StatusPartial,false);err!=nil{t.Fatal(err)}
 partial,err:=s.Get(ctx,"partial");if err!=nil||partial.Stats.Created!=1||partial.Stats.Failed!=1||partial.Status!=StatusPartial{
  t.Fatalf("partial result: %+v %v",partial,err)
 }
}

func TestInterruptedRunRecoveryAndAccountSeal(t *testing.T){
 ctx:=context.Background()
 path:=filepath.Join(t.TempDir(),"history.db")
 s,err:=Open(path,"owner-a");if err!=nil{t.Fatal(err)}
 started:=time.Now().UTC()
 if err:=s.Begin(ctx,Run{ID:"crash",Engine:"mount",Trigger:"local",StartedAt:started});err!=nil{t.Fatal(err)}
 if err:=s.Close();err!=nil{t.Fatal(err)}
 if _,err:=Open(path,"owner-b");err==nil{t.Fatal("cross-account database opened")}
 reopened,err:=Open(path,"owner-a");if err!=nil{t.Fatal(err)}
 defer reopened.Close()
 r,err:=reopened.Get(ctx,"crash");if err!=nil||r.Status!=StatusInterrupted||r.Outcome!="unknown"||r.DetailComplete{
  t.Fatalf("unproven run marked successful: %+v %v",r,err)
 }
 if err:=reopened.Finish(ctx,"crash",StatusCompleted,true);!errors.Is(err,ErrTerminal){t.Fatalf("late success accepted: %v",err)}
 if err:=reopened.Append(ctx,item("crash","late","create","upload",ptr(1),ptr(1)));!errors.Is(err,ErrTerminal){t.Fatalf("late entry accepted: %v",err)}
}

func TestPruneKeepsCountersAndMarksExpiredDetails(t *testing.T){
 ctx:=context.Background()
 s:=openTestStore(t)
 started:=time.Now().UTC().Add(-31*24*time.Hour)
 beginRun(t,s,"old",started)
 x:=item("old","old-file","create","upload",ptr(5),ptr(5))
 x.AppliedAt=started
 if err:=s.Append(ctx,x);err!=nil{t.Fatal(err)}
 if err:=s.Finish(ctx,"old",StatusCompleted,true);err!=nil{t.Fatal(err)}
 if err:=s.Prune(ctx,time.Now().UTC());err!=nil{t.Fatal(err)}
 old,err:=s.Get(ctx,"old");if err!=nil{t.Fatal(err)}
 if !old.DetailsExpired||old.Stats.Created!=1 {t.Fatalf("lost summary during pruning: %+v",old)}
 items,err:=s.Items(ctx,"old",10,nil);if err!=nil||len(items)!=0{t.Fatalf("old detail retained: %+v %v",items,err)}
}

func TestRejectSymlinkDatabaseAndInvalidReceipts(t *testing.T){
 dir:=t.TempDir()
 target:=filepath.Join(dir,"target.db")
 if err:=os.WriteFile(target,[]byte("not a database"),0600);err!=nil{t.Fatal(err)}
 link:=filepath.Join(dir,"linked.db")
 if err:=os.Symlink(target,link);err==nil{
  if store,openErr:=Open(link,"owner");openErr==nil{_ = store.Close();t.Fatal("followed a symlink")}
 }
 s:=openTestStore(t)
 beginRun(t,s,"run",time.Now().UTC())
 if err:=s.Append(context.Background(),Item{RunID:"run",ID:"id",Action:"create",Direction:"upload",Status:"completed",NewPath:"a",LogicalBytes:ptr(-1)});err==nil{
  t.Fatal("negative file size accepted")
 }
}

func TestAtomicBatchReplaysAndRollback(t *testing.T){
 ctx:=context.Background()
 s:=openTestStore(t)
 beginRun(t,s,"batch",time.Now().UTC())
 first:=item("batch","a","create","upload",ptr(10),ptr(8))
 second:=item("batch","b","update","download",ptr(12),nil)
 if err:=s.AppendBatch(ctx,[]Item{first,second});err!=nil{t.Fatal(err)}
 replay:=first;replay.AppliedAt=time.Now().UTC() // timestamp cannot change the receipt identity
 if err:=s.AppendBatch(ctx,[]Item{replay,second});err!=nil{t.Fatalf("replay: %v",err)}
 if err:=s.AppendBatch(ctx,[]Item{first,Item{RunID:"different",ID:"x",Action:"create",Direction:"upload",Status:"completed"}});err==nil{
  t.Fatal("mixed-run batch was accepted")
 }
 altered:=second;altered.Direction="upload"
 if err:=s.AppendBatch(ctx,[]Item{item("batch","new","create","upload",ptr(1),ptr(1)),altered});!errors.Is(err,ErrReceiptConflict){
  t.Fatalf("conflicting replay did not abort transaction: %v",err)
 }
 r,err:=s.Get(ctx,"batch");if err!=nil{t.Fatal(err)}
 if r.Stats.Items!=2||r.Stats.Created!=1||r.Stats.Updated!=1||r.Stats.Uploaded!=1||r.Stats.Downloaded!=1{
  t.Fatalf("partial rollback or double count: %+v",r)
 }
 if r.Stats.TransferredBytes==nil||*r.Stats.TransferredBytes!=8{t.Fatalf("unknown bytes must not become a fabricated transfer: %+v",r)}
 rows,err:=s.Items(ctx,"batch",50,nil);if err!=nil||len(rows)!=2{t.Fatalf("atomicity broken: %+v %v",rows,err)}
 if err:=s.Finish(ctx,"batch",StatusCompleted,false);err!=nil{t.Fatal(err)}
}
