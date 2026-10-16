package api

import (
	"context"
	"errors"
	"testing"

	"gorm.io/gorm"
)

func TestBaiduPhotoMapConsentRejectsMissingDatabaseAndUntrustedRevision(t *testing.T) {
	if _, err := verifyBaiduPhotoMapConsentTx(context.Background(), nil, 1, 2); !errors.Is(err, errBaiduPhotoMapConsentDenied) {
		t.Fatal("nil policy database accepted")
	}
	if _, err := verifyBaiduPhotoMapConsentTx(context.Background(), nil, 0, 2); err == nil {
		t.Fatal("anonymous owner accepted")
	}
	if err := revokeBaiduPhotoMapConsent(context.Background(), nil, 1, 2, 1); err == nil {
		t.Fatal("nil DB accepted revocation")
	}
	if err := revokeBaiduPhotoMapConsent(context.Background(), nil, 1, 2, 0); err == nil {
		t.Fatal("zero revision accepted")
	}
	if err := revokeBaiduPhotoMapConsent(context.Background(), nil, 1, 2, ^uint64(0)); err == nil {
		t.Fatal("revision overflow accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var db *gorm.DB
	if _, err := verifyBaiduPhotoMapConsentTx(ctx, db, 1, 2); err == nil {
		t.Fatal("cancelled consent read accepted")
	}
	if err := revokeBaiduPhotoMapConsent(ctx, db, 1, 2, 1); err == nil {
		t.Fatal("cancelled revocation accepted")
	}
}
