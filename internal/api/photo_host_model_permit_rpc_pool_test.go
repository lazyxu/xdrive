package api

import (
	"context"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

func TestOfflinePhotoModelRPCUsesOnePinnedDatabaseSessionPostgres(t *testing.T) {
	db := photoHostAdmissionWorkloadTestDB(t)
	if err := db.Create(&meta.PhotoHostAdmissionGate{
		Name: photoHostAdmissionSettingName, Revision: 21,
	}).Error; err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	lease, admitted, err := tryAcquirePhotoHostAdmission(ctx, db)
	if err != nil || !admitted || lease == nil {
		t.Fatalf("single database connection admission failed: %v / %v", admitted, err)
	}
	called := false
	err = lease.runOfflinePhotoModelRPC(
		ctx, offlinePhotoRPCTestSpec(),
		func(callCtx context.Context, c photointelligence.PhotoModelPermitV1, mac string, body []byte) error {
			called = true
			if callCtx.Err() != nil || c.Revision != 21 || mac == "" || len(body) == 0 {
				t.Error("invalid single-session test claim")
				return errOfflinePhotoModelPermitUnavailable
			}
			return nil
		},
	)
	if err != nil || !called {
		lease.Close()
		t.Fatalf("one pooled session could not span issue/callback/final heartbeat: %v", err)
	}
	if err := lease.Heartbeat(ctx); err != nil {
		lease.Close()
		t.Fatal(err)
	}
	lease.Close()
	// Once released, the same one-connection pool must be reusable; a
	// leaked SQL Conn would deadlock on this bounded operation.
	if err := db.WithContext(ctx).Exec("SELECT 1").Error; err != nil {
		t.Fatalf("single pooled connection leaked: %v", err)
	}
}
