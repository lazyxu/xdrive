package main

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/localpushrunner"
)

func TestLocalFirstFileReadOnlyStatusBoundToOriginalAgentJob(t *testing.T) {
	agentCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c := &agentController{ctx: agentCtx}
	key := testLocalFirstFileJobKey()
	observe := func(k localPushFirstFileJobKey) localBackupFirstFileJobStatus {
		t.Helper()
		got, err := c.inspectLocalFirstFileJobForKey(context.Background(), k)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	if got := observe(key); got.Phase != "not-recorded" || got.PhysicalObserved {
		t.Fatalf("absent in-memory job became positive evidence: %+v", got)
	}
	original := &localPushFirstFileJob{done: make(chan struct{})}
	c.localFirstFileJobMu.Lock()
	c.localFirstFileJobs = map[localPushFirstFileJobKey]*localPushFirstFileJob{key: original}
	c.localFirstFileJobMu.Unlock()
	if got := observe(key); got.Phase != "running" || got.PhysicalObserved {
		t.Fatalf("live upload forged success: %+v", got)
	}
	for _, foreign := range []localPushFirstFileJobKey{
		{server: "https://other.invalid", account: key.account, sessionID: key.sessionID, sourceID: key.sourceID},
		{server: key.server, account: "other", sessionID: key.sessionID, sourceID: key.sourceID},
		{server: key.server, account: key.account, sessionID: "other-login", sourceID: key.sourceID},
		{server: key.server, account: key.account, sessionID: key.sessionID, sourceID: 43},
	} {
		if got := observe(foreign); got.Phase != "not-recorded" || got.PhysicalObserved {
			t.Fatalf("foreign Source/account/session read original job: %+v", got)
		}
	}
	original.result = localBackupFirstFileSummary{
		SourceID: key.sourceID, Revision: 3, ObservedFiles: 1,
		ObservedBytes: 123, PhysicalObserved: true,
		BackupComplete: false, RetirementSafe: false,
	}
	close(original.done)
	got := observe(key)
	if got.Phase != "observed" || got.Revision != 3 || got.ObservedBytes != 123 ||
		!got.PhysicalObserved || got.BackupComplete || got.RetirementSafe {
		t.Fatalf("original physical result not represented safely: %+v", got)
	}
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	for _, private := range []string{"original", "root_path", "stage_id", "request_key", "native_key", "session_id"} {
		if strings.Contains(string(encoded), private) {
			t.Fatalf("private Agent evidence leaked into IPC: %s", encoded)
		}
	}
	// A read never writes to the job map, starts a new Stage or invokes a Runner.
	if len(c.localFirstFileJobs) != 1 {
		t.Fatal("read-only observation mutated source jobs")
	}
}

func TestLocalFirstFileReadOnlyStatusFailsClosedOnUncertainAndCancelled(t *testing.T) {
	agentCtx, shutdown := context.WithCancel(context.Background())
	defer shutdown()
	c := &agentController{ctx: agentCtx}
	key := testLocalFirstFileJobKey()
	failed := &localPushFirstFileJob{done: make(chan struct{})}
	failed.err = errors.New("private original /home/user/secret")
	close(failed.done)
	c.localFirstFileJobs = map[localPushFirstFileJobKey]*localPushFirstFileJob{key: failed}
	got, err := c.inspectLocalFirstFileJobForKey(context.Background(), key)
	if err != nil || got.Phase != "uncertain" || got.PhysicalObserved ||
		got.Revision != 0 || got.ObservedBytes != 0 {
		t.Fatalf("failed operation incorrectly observed: %+v %v", got, err)
	}
	b, _ := json.Marshal(got)
	if strings.Contains(string(b), "/home/user") {
		t.Fatal("private error exposed in status")
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.inspectLocalFirstFileJobForKey(cancelled, key); err == nil {
		t.Fatal("cancelled read accepted")
	}
	key2 := key
	key2.sourceID++
	invalidPositive := &localPushFirstFileJob{done: make(chan struct{})}
	invalidPositive.result = localBackupFirstFileSummary{
		SourceID: key2.sourceID, Revision: 3, ObservedFiles: 1,
		ObservedBytes:    localpushrunner.MaxFirstLeafBytes + 1,
		PhysicalObserved: true,
	}
	close(invalidPositive.done)
	c.localFirstFileJobs[key2] = invalidPositive
	if got, err := c.inspectLocalFirstFileJobForKey(context.Background(), key2); err != nil ||
		got.Phase != "uncertain" || got.PhysicalObserved {
		t.Fatalf("invalid result forged success: %+v %v", got, err)
	}
	shutdown()
	if _, err := c.inspectLocalFirstFileJobForKey(context.Background(), key); err == nil {
		t.Fatal("stopped Agent exposed old process state")
	}
}
