package api

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
)

func offlinePhotoRPCTestSpec() offlinePhotoModelRPCSpec {
	return offlinePhotoModelRPCSpec{
		keyHex:          offlineTestPermitKey,
		deploymentEpoch: offlineTestPermitEpoch,
		serverID:        strings.Repeat("1", 32),
		modelID:         strings.Repeat("2", 32),
		method:          "POST",
		path:            "/v1/semantic-text",
		body:            []byte("{\"text\":\"hello\"}"),
		now:             time.Now(),
	}
}

func TestOfflinePhotoModelRPCMaintainsLeaseDuringRemoteCallbackPostgres(t *testing.T) {
	db := photoHostAdmissionWorkloadTestDB(t)
	if err := db.Create(&meta.PhotoHostAdmissionGate{
		Name: photoHostAdmissionSettingName, Revision: 11,
	}).Error; err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	lease, admitted, err := tryAcquirePhotoHostAdmission(ctx, db)
	if err != nil || !admitted || lease == nil {
		t.Fatalf("cannot acquire preexisting shared lease: %v / %v", admitted, err)
	}
	defer lease.Close()

	entered := make(chan struct{})
	release := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		result <- lease.runOfflinePhotoModelRPC(
			ctx, offlinePhotoRPCTestSpec(),
			func(callCtx context.Context, claim photointelligence.PhotoModelPermitV1, mac string, body []byte) error {
				if claim.Revision != 11 || claim.ExpiresAt-claim.IssuedAt != 10 ||
					claim.Path != "/v1/semantic-text" || mac == "" ||
					string(body) != "{\"text\":\"hello\"}" {
					return errors.New("invalid permit in synthetic remote callback")
				}
				close(entered)
				select {
				case <-release:
					return nil
				case <-callCtx.Done():
					return callCtx.Err()
				}
			},
		)
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("synthetic callback never reached with an admitted permit")
	}
	// A synthetic remote call must hold the original shared session even
	// after the local signer returned. A competing exclusive maintenance
	// writer may not sneak in while the callback is still in flight.
	writer, taken, err := sourceaccount.TryAcquire(ctx, db, photoHostAdmissionLockName)
	if writer != nil {
		writer.Close()
	}
	if err != nil || taken {
		t.Fatalf("exclusive writer overtook in-flight permitted RPC: %v / %v", taken, err)
	}
	// Exercise at least one independent heartbeat while the remote callback
	// remains in flight. No second database connection is consumed by signer.
	time.Sleep(3 * offlinePhotoModelRPCHearbeatInterval)
	close(release)
	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("healthy remote callback lost its admission lease: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("synthetic remote callback did not complete")
	}
	writer, taken, err = sourceaccount.TryAcquire(ctx, db, photoHostAdmissionLockName)
	if writer != nil {
		writer.Close()
	}
	if err != nil || taken {
		t.Fatalf("caller-owned lease released before caller closed it: %v / %v", taken, err)
	}
	lease.Close()
	writer, taken, err = sourceaccount.TryAcquire(ctx, db, photoHostAdmissionLockName)
	if err != nil || !taken || writer == nil {
		t.Fatalf("exclusive maintenance writer unavailable after release: %v / %v", taken, err)
	}
	writer.Close()
}

func TestOfflinePhotoModelRPCRejectsLostLeaseAndCanceledParentPostgres(t *testing.T) {
	db := photoHostAdmissionWorkloadTestDB(t)
	if err := db.Create(&meta.PhotoHostAdmissionGate{
		Name: photoHostAdmissionSettingName, Revision: 9,
	}).Error; err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(4)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	lease, ok, err := tryAcquirePhotoHostAdmission(ctx, db)
	if err != nil || !ok || lease == nil {
		t.Fatalf("unable to acquire shared session: %v / %v", ok, err)
	}
	entered := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		result <- lease.runOfflinePhotoModelRPC(
			ctx, offlinePhotoRPCTestSpec(),
			func(callCtx context.Context, _ photointelligence.PhotoModelPermitV1, _ string, _ []byte) error {
				close(entered)
				<-callCtx.Done()
				return callCtx.Err()
			},
		)
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		lease.Close()
		t.Fatal("callback did not begin")
	}
	// Simulate external lease loss during a request. A rejected heartbeat
	// must cancel the callback and refuse the would-be success result.
	lease.Close()
	select {
	case err := <-result:
		if err == nil {
			t.Fatal("lease loss incorrectly verified remote execution")
		}
	case <-ctx.Done():
		t.Fatal("lease loss did not terminate synthetic call")
	}

	second, admitted, err := tryAcquirePhotoHostAdmission(ctx, db)
	if err != nil || !admitted {
		t.Fatalf("new shared admission was not released: %v / %v", admitted, err)
	}
	canceled, stop := context.WithCancel(ctx)
	stop()
	if err := second.runOfflinePhotoModelRPC(
		canceled, offlinePhotoRPCTestSpec(),
		func(context.Context, photointelligence.PhotoModelPermitV1, string, []byte) error {
			t.Fatal("canceled request unexpectedly invoked remote inference")
			return nil
		},
	); err == nil {
		second.Close()
		t.Fatal("cancelled request received positive permit response")
	}
	second.Close()
}

func TestOfflinePhotoModelRPCRefusesMissingRevisionOrCallbackFailurePostgres(t *testing.T) {
	db := photoHostAdmissionWorkloadTestDB(t)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	lease, admitted, err := tryAcquirePhotoHostAdmission(ctx, db)
	if err != nil || !admitted {
		t.Fatalf("legacy default work admission changed: %v / %v", admitted, err)
	}
	count := 0
	remote := func(context.Context, photointelligence.PhotoModelPermitV1, string, []byte) error {
		count++
		return errors.New("synthetic remote request error")
	}
	if err := lease.runOfflinePhotoModelRPC(ctx, offlinePhotoRPCTestSpec(), remote); err == nil || count != 0 {
		lease.Close()
		t.Fatal("missing admission revision still sent a signed RPC")
	}
	lease.Close()
	if err := db.Create(&meta.PhotoHostAdmissionGate{
		Name: photoHostAdmissionSettingName, Revision: 4,
	}).Error; err != nil {
		t.Fatal(err)
	}
	lease, admitted, err = tryAcquirePhotoHostAdmission(ctx, db)
	if err != nil || !admitted {
		t.Fatalf("explicit unfrozen revision rejected: %v / %v", admitted, err)
	}
	if err := lease.runOfflinePhotoModelRPC(ctx, offlinePhotoRPCTestSpec(), remote); err == nil || count != 1 {
		lease.Close()
		t.Fatal("synthetic failed model call was incorrectly counted as success")
	}
	if err := lease.runOfflinePhotoModelRPC(ctx, offlinePhotoRPCTestSpec(), nil); err == nil {
		lease.Close()
		t.Fatal("nil remote callback issued a model permit")
	}
	lease.Close()
}
