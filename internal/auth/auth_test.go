package auth

import (
	"strings"
	"testing"
	"time"
)

func TestPasswordAndJWT(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if err := CheckPassword(hash, "correct horse battery staple"); err != nil {
		t.Fatalf("valid password rejected: %v", err)
	}
	if err := CheckPassword(hash, "wrong password"); err == nil {
		t.Fatal("wrong password accepted")
	}

	manager := New("test-secret-that-is-long-enough", time.Hour)
	token, err := manager.Issue(42, 7)
	if err != nil {
		t.Fatal(err)
	}
	uid, version, err := manager.Parse(token)
	if err != nil || uid != 42 || version != 7 {
		t.Fatalf("parse token uid=%d version=%d err=%v", uid, version, err)
	}
	if _, _, err := New("different-secret", time.Hour).Parse(token); err == nil {
		t.Fatal("token signed by another secret was accepted")
	}
}

func TestPasswordMinimumLength(t *testing.T) {
	if _, err := HashPassword("short"); err == nil {
		t.Fatal("short password accepted")
	}
}

func TestPreviewStreamJWT(t *testing.T) {
	manager := New("test-secret-that-is-long-enough", time.Hour)
	token, expiresAt, err := manager.IssuePreviewStream(42, 7, 99, 3, "pdf", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !expiresAt.After(time.Now()) {
		t.Fatalf("expiresAt=%v", expiresAt)
	}
	claims, err := manager.ParsePreviewStream(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.UserID != 42 || claims.SessionVersion != 7 ||
		claims.NodeID != 99 || claims.NodeRevision != 3 || claims.PreviewKind != "pdf" {
		t.Fatalf("claims=%+v", claims)
	}
	if _, _, err := manager.Parse(token); err == nil {
		t.Fatal("preview stream ticket was accepted as an access token")
	}
	if _, err := New("different-secret", time.Hour).ParsePreviewStream(token); err == nil {
		t.Fatal("preview stream ticket signed by another secret was accepted")
	}
}

func TestPreviewStreamJWTRejectsInvalidClaims(t *testing.T) {
	manager := New("test-secret-that-is-long-enough", time.Hour)
	if _, _, err := manager.IssuePreviewStream(1, 1, 2, 3, "", time.Minute); err == nil {
		t.Fatal("empty preview kind was accepted")
	}
	if _, _, err := manager.IssuePreviewStream(1, 1, 2, 3, "pdf", 3*time.Hour); err == nil {
		t.Fatal("oversized preview stream ttl was accepted")
	}
}

func TestPreviewResourceStreamJWT(t *testing.T) {
	manager := New("test-secret-that-is-long-enough", time.Hour)
	fingerprint := "livp:" + strings.Repeat("a", 64) + ":128:2048"
	token, _, err := manager.IssuePreviewResourceStream(
		42, 7, 99, 3, "live_motion", fingerprint, time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := manager.ParsePreviewStream(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.PreviewKind != "live_motion" ||
		claims.ResourceFingerprint != fingerprint {
		t.Fatalf("claims=%+v", claims)
	}
	if _, _, err := manager.IssuePreviewResourceStream(
		42, 7, 99, 3, "live_motion", "", time.Minute,
	); err == nil {
		t.Fatal("empty resource fingerprint was accepted")
	}
}

func TestSourceRunJWTClaimsAreExactAndOrdinaryJWTStaysUnscoped(t *testing.T) {
	manager := New("test-secret-that-is-long-enough", time.Hour)
	ordinary, err := manager.Issue(42, 7)
	if err != nil {
		t.Fatal(err)
	}
	ordinaryClaims, err := manager.ParseClaims(ordinary)
	if err != nil || ordinaryClaims.SourceID != 0 || ordinaryClaims.SourceRunID != "" {
		t.Fatalf("ordinary JWT acquired SourceRun scope: %+v err=%v", ordinaryClaims, err)
	}

	runToken, err := manager.IssueSourceRunAccess(42, 7, 33, "b743a2ec-74c8-4b36-9e61-2f9016eb71ff")
	if err != nil {
		t.Fatal(err)
	}
	runClaims, err := manager.ParseClaims(runToken)
	if err != nil || runClaims.UserID != 42 || runClaims.SessionVersion != 7 ||
		runClaims.SourceID != 33 || runClaims.SourceRunID != "b743a2ec-74c8-4b36-9e61-2f9016eb71ff" {
		t.Fatalf("SourceRun JWT claims are not exact: %+v err=%v", runClaims, err)
	}
	if _, _, err := New("different-secret", time.Hour).Parse(runToken); err == nil {
		t.Fatal("SourceRun JWT signed with the wrong secret was accepted")
	}
	if _, err := manager.IssueSourceRunAccess(42, 7, 0, "b743a2ec-74c8-4b36-9e61-2f9016eb71ff"); err == nil {
		t.Fatal("zero SourceID was accepted")
	}
	if _, err := manager.IssueSourceRunAccess(42, 7, 33, ""); err == nil {
		t.Fatal("empty SourceRunID was accepted")
	}
}
