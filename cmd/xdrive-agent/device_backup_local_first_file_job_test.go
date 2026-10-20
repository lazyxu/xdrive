package main

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func testLocalFirstFileJobKey() localPushFirstFileJobKey {
	return localPushFirstFileJobKey{
		server: "https://example.invalid", account: "owner",
		sessionID: "current-session", sourceID: 42,
	}
}

func awaitLocalFirstFileJob(t *testing.T, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(10 * time.Second):
		t.Fatal("Agent-owned first-file job hung")
		return nil
	}
}

func TestLocalFirstFileRequestDetachRejoinsWithoutReupload(t *testing.T) {
	agentCtx, stopAgent := context.WithCancel(context.Background())
	defer stopAgent()
	controller := &agentController{ctx: agentCtx}
	key := testLocalFirstFileJobKey()
	started, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	want := localBackupFirstFileSummary{
		SourceID: 42, Revision: 3, ObservedFiles: 1,
		ObservedBytes: 123, PhysicalObserved: true,
		BackupComplete: false, RetirementSafe: false,
	}
	upload := func(ctx context.Context, id uint64) (localBackupFirstFileSummary, error) {
		calls.Add(1)
		close(started)
		select {
		case <-release:
			return want, ctx.Err()
		case <-ctx.Done():
			return localBackupFirstFileSummary{}, ctx.Err()
		}
	}
	requestCtx, disconnect := context.WithCancel(context.Background())
	first := make(chan error, 1)
	go func() {
		_, err := controller.runDetachedLocalPushFirstFile(requestCtx, key, upload)
		first <- err
	}()
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("Agent did not start original physical work")
	}
	disconnect()
	if err := awaitLocalFirstFileJob(t, first); !errors.Is(err, context.Canceled) {
		t.Fatalf("observer cancellation not surfaced: %v", err)
	}
	joined := make(chan error, 1)
	go func() {
		got, err := controller.runDetachedLocalPushFirstFile(context.Background(), key,
			func(context.Context, uint64) (localBackupFirstFileSummary, error) {
				calls.Add(1)
				return localBackupFirstFileSummary{}, errors.New("duplicate physical write")
			})
		if err == nil && got != want {
			err = errors.New("reconnected observer did not see first operation")
		}
		joined <- err
	}()
	close(release)
	if err := awaitLocalFirstFileJob(t, joined); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("original physical upload executed %d times", calls.Load())
	}
	got, err := controller.runDetachedLocalPushFirstFile(context.Background(), key, upload)
	if err != nil || got != want || calls.Load() != 1 {
		t.Fatalf("same-process idempotent replay invalid: %+v %v calls=%d", got, err, calls.Load())
	}
}

func TestLocalFirstFileRejectsOtherDeviceScopeAndConcurrentWork(t *testing.T) {
	agentCtx, stop := context.WithCancel(context.Background())
	defer stop()
	controller := &agentController{ctx: agentCtx}
	key := testLocalFirstFileJobKey()
	started, release := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := controller.runDetachedLocalPushFirstFile(context.Background(), key,
			func(ctx context.Context, id uint64) (localBackupFirstFileSummary, error) {
				close(started)
				select {
				case <-release:
					return localBackupFirstFileSummary{SourceID: id}, nil
				case <-ctx.Done():
					return localBackupFirstFileSummary{}, ctx.Err()
				}
			})
		done <- err
	}()
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("owning job did not start")
	}
	foreign := key
	foreign.account = "different-account"
	nextSource := key
	nextSource.sourceID = 43
	var duplicateCalls atomic.Int32
	rejected := func(context.Context, uint64) (localBackupFirstFileSummary, error) {
		duplicateCalls.Add(1)
		return localBackupFirstFileSummary{}, nil
	}
	for _, attempt := range []localPushFirstFileJobKey{foreign, nextSource, {sourceID: key.sourceID}} {
		if _, err := controller.runDetachedLocalPushFirstFile(context.Background(), attempt, rejected); err == nil {
			t.Fatalf("foreign/busy/invalid scope allowed: %+v", attempt)
		}
	}
	close(release)
	if err := awaitLocalFirstFileJob(t, done); err != nil {
		t.Fatal(err)
	}
	if _, err := controller.runDetachedLocalPushFirstFile(context.Background(), foreign, rejected); err == nil {
		t.Fatal("new account could rejoin original Source")
	}
	if duplicateCalls.Load() != 0 {
		t.Fatalf("admitted unauthorized writer: %d", duplicateCalls.Load())
	}
}

func TestLocalFirstFileAgentShutdownFailsClosed(t *testing.T) {
	agentCtx, shutdown := context.WithCancel(context.Background())
	controller := &agentController{ctx: agentCtx}
	key := testLocalFirstFileJobKey()
	started := make(chan struct{})
	var calls atomic.Int32
	execute := func(ctx context.Context, id uint64) (localBackupFirstFileSummary, error) {
		calls.Add(1)
		close(started)
		<-ctx.Done()
		return localBackupFirstFileSummary{}, ctx.Err()
	}
	result := make(chan error, 1)
	go func() {
		_, err := controller.runDetachedLocalPushFirstFile(context.Background(), key, execute)
		result <- err
	}()
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("shutdown test not started")
	}
	shutdown()
	if err := awaitLocalFirstFileJob(t, result); !errors.Is(err, context.Canceled) {
		t.Fatalf("shutdown erroneously treated as physical success: %v", err)
	}
	if _, err := controller.runDetachedLocalPushFirstFile(context.Background(), key, execute); err == nil || calls.Load() != 1 {
		t.Fatalf("shutdown started another operation: %v calls=%d", err, calls.Load())
	}
}
