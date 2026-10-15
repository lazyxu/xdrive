package api

import (
	"context"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourceaccount"
)

func TestPhotoHostManualInferenceHoldsSharedAdmissionForEntireCanaryPostgres(t *testing.T) {
	db := photoHostAdmissionWorkloadTestDB(t)
	server := &Server{DB: db}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	entered := make(chan struct{})
	release := make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	finished := make(chan bool, 1)
	go func() {
		finished <- server.photoHostRunAdmittedSyntheticInference(ctx, func(inferCtx context.Context) {
			close(entered)
			select {
			case <-release:
			case <-inferCtx.Done():
			}
		})
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal("manual fixed inference did not enter with migrated open admission")
	}
	writer, acquired, err := sourceaccount.TryAcquire(ctx, db, photoHostAdmissionLockName)
	if writer != nil {
		writer.Close()
	}
	if err != nil || acquired {
		t.Fatalf("exclusive writer overtook active manual canary: %v / %v", acquired, err)
	}
	close(release)
	select {
	case passed := <-finished:
		if !passed {
			t.Fatal("model-local canary lost shared admission unexpectedly")
		}
	case <-ctx.Done():
		t.Fatal("manual inference admission did not finish")
	}
	writer, acquired, err = sourceaccount.TryAcquire(ctx, db, photoHostAdmissionLockName)
	if err != nil || !acquired {
		t.Fatalf("manual inference leaked shared advisory lock: %v / %v", acquired, err)
	}
	writer.Close()
}

func TestPhotoHostManualInferenceFailsClosedForFreezeWriterAndMissingTablePostgres(t *testing.T) {
	db := photoHostAdmissionWorkloadTestDB(t)
	server := &Server{DB: db}
	calls := 0
	probe := func(context.Context) { calls++ }
	writer, acquired, err := sourceaccount.TryAcquire(context.Background(), db, photoHostAdmissionLockName)
	if err != nil || !acquired {
		t.Fatalf("exclusive maintenance writer unavailable: %v / %v", acquired, err)
	}
	if server.photoHostRunAdmittedSyntheticInference(context.Background(), probe) || calls != 0 {
		writer.Close()
		t.Fatal("manual inference ran during exclusive maintenance writer")
	}
	writer.Close()

	if err := db.Create(&meta.PhotoHostAdmissionGate{
		Name: photoHostAdmissionSettingName, Revision: 1, Frozen: true,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if server.photoHostRunAdmittedSyntheticInference(context.Background(), probe) || calls != 0 {
		t.Fatal("frozen revision admitted manual canary")
	}
	if err := db.Model(&meta.PhotoHostAdmissionGate{}).
		Where("name = ?", photoHostAdmissionSettingName).
		Updates(map[string]any{"revision": 2, "frozen": false}).Error; err != nil {
		t.Fatal(err)
	}
	if !server.photoHostRunAdmittedSyntheticInference(context.Background(), probe) || calls != 1 {
		t.Fatal("unfrozen revision failed to admit fixed canary")
	}
	if err := db.Migrator().DropTable(&meta.PhotoHostAdmissionGate{}); err != nil {
		t.Fatal(err)
	}
	if server.photoHostRunAdmittedSyntheticInference(context.Background(), probe) || calls != 1 {
		t.Fatal("missing admission table admitted manual canary")
	}
}

func TestPhotoHostManualInferenceCancellationInvalidatesEvidencePostgres(t *testing.T) {
	db := photoHostAdmissionWorkloadTestDB(t)
	server := &Server{DB: db}
	ctx, cancel := context.WithCancel(context.Background())
	called := false
	if server.photoHostRunAdmittedSyntheticInference(ctx, func(inferCtx context.Context) {
		called = true
		cancel()
		<-inferCtx.Done()
	}) || !called {
		t.Fatal("canceled manual canary published a positive admission result")
	}
	writer, acquired, err := sourceaccount.TryAcquire(context.Background(), db, photoHostAdmissionLockName)
	if err != nil || !acquired {
		t.Fatalf("canceled manual canary leaked shared lease: %v / %v", acquired, err)
	}
	writer.Close()
	if server.photoHostRunAdmittedSyntheticInference(ctx, func(context.Context) {
		t.Fatal("canceled context unexpectedly reached model")
	}) {
		t.Fatal("canceled context admitted model inference")
	}
	var missing *Server
	if missing.photoHostRunAdmittedSyntheticInference(context.Background(), func(context.Context) {
		t.Fatal("nil server unexpectedly reached model")
	}) {
		t.Fatal("nil Server authorized manual model inference")
	}
	if (&Server{}).photoHostRunAdmittedSyntheticInference(context.Background(), func(context.Context) {
		t.Fatal("missing DB unexpectedly reached model")
	}) {
		t.Fatal("missing database authorized manual model inference")
	}
}
