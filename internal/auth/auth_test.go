package auth

import (
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

func TestMediaStreamJWT(t *testing.T) {
	manager := New("test-secret-that-is-long-enough", time.Hour)
	token, expiresAt, err := manager.IssueMediaStream(42, 7, 99, 3, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !expiresAt.After(time.Now()) {
		t.Fatalf("expiresAt=%v", expiresAt)
	}
	claims, err := manager.ParseMediaStream(token)
	if err != nil {
		t.Fatal(err)
	}
	if claims.UserID != 42 || claims.SessionVersion != 7 ||
		claims.NodeID != 99 || claims.NodeRevision != 3 {
		t.Fatalf("claims=%+v", claims)
	}
	if _, _, err := manager.Parse(token); err == nil {
		t.Fatal("media stream ticket was accepted as an access token")
	}
	if _, err := New("different-secret", time.Hour).ParseMediaStream(token); err == nil {
		t.Fatal("media stream ticket signed by another secret was accepted")
	}
}

func TestMediaStreamJWTRejectsInvalidTTL(t *testing.T) {
	manager := New("test-secret-that-is-long-enough", time.Hour)
	if _, _, err := manager.IssueMediaStream(1, 1, 2, 3, 3*time.Hour); err == nil {
		t.Fatal("oversized media stream ttl was accepted")
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
	if _, err := manager.ParseMediaStream(token); err == nil {
		t.Fatal("preview stream ticket was accepted as a media stream ticket")
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
