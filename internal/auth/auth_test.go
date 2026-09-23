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
