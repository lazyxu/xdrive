//go:build windows

package mount

import (
	"errors"
	"testing"
)

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

func TestWindowsBackgroundSyncFailureWithoutMutationIsRecorded(t *testing.T) {
	p := &winProvider{activityOwner: "account-a"}
	var events []Event
	SetEventSink(func(ev Event) { events = append(events, ev) })
	defer SetEventSink(nil)
	p.finishBackgroundActivity("remote", nil)
	if len(events) != 0 {
		t.Fatalf("empty successful poll should not create a run: %+v", events)
	}
	p.finishBackgroundActivity("remote", errors.New("remote timeout"))
	if len(events) != 2 || events[0].Kind != EventSyncStarted ||
		events[0].Trigger != "remote" || events[1].Kind != EventSyncFailed ||
		events[1].RunID != events[0].RunID {
		t.Fatalf("failed poll must be persisted as a correlated batch: %+v", events)
	}
	if p.activityRunID != "" {
		t.Fatal("failed poll left a running activity")
	}
}
