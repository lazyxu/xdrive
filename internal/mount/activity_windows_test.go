//go:build windows

package mount

import "testing"

func TestWindowsActivityReceiptsKeepRunOwnerAndNoFakeDownload(t *testing.T) {
 p := &winProvider{activityOwner:"account-a",activityTrigger:"remote"}
 var events []Event
 SetEventSink(func(ev Event){events=append(events,ev)})
 defer SetEventSink(nil)
 p.recordActivity("create","local","","docs/new.txt",nil)
 if len(events)!=2 || events[0].Kind!=EventSyncStarted || events[1].Kind!=EventSyncItemCommitted {
  t.Fatalf("expected lazy start and actual create receipt: %+v",events)
 }
 runID:=p.activityRunID
 if runID=="" || events[0].RunID!=runID || events[1].RunID!=runID {
  t.Fatal("file receipt was not correlated with active run")
 }
 if events[1].Direction!="local" || events[1].TransferredBytes!=nil {
  t.Fatal("placeholder creation must not be counted as a network download")
 }
 p.notifyConflict("docs/new (conflict).txt","docs/new.txt",7,8)
 if len(events)!=3 || events[2].Kind!=EventConflict || events[2].RunID!=runID ||
  events[2].ActivityOwner!="account-a" || events[2].ItemID=="" {
  t.Fatalf("conflict did not preserve run correlation: %+v",events)
 }
 p.finishActivity(runID,nil,false)
 if len(events)!=4 || events[3].Kind!=EventSyncCompleted || p.activityRunID!="" {
  t.Fatalf("run not finalized: %+v",events)
 }
}
