package storage

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func immutableTestKey(t *testing.T, content string) string {
	t.Helper()
	sum := sha256.Sum256([]byte(content))
	key, err := ContentAddressedKey(hex.EncodeToString(sum[:]))
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func immutableTestRead(t *testing.T, store *Local, key string) string {
	t.Helper()
	file, err := store.Open(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	data, err := io.ReadAll(file)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestCanonicalCASPutImmutableAcrossStoreInstances(t *testing.T) {
	root := t.TempDir()
	first, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	key := immutableTestKey(t, "trusted")
	if n, err := first.Put(context.Background(), key, strings.NewReader("trusted")); err != nil || n != 7 {
		t.Fatalf("first canonical put: bytes=%d err=%v", n, err)
	}
	if n, err := second.Put(context.Background(), key, strings.NewReader("trusted")); err != nil || n != 7 {
		t.Fatalf("idempotent canonical put: bytes=%d err=%v", n, err)
	}
	if _, err := second.Put(context.Background(), key, strings.NewReader("changed")); err == nil {
		t.Fatal("same-size hash-colliding replacement was accepted")
	}
	if got := immutableTestRead(t, first, key); got != "trusted" {
		t.Fatalf("CAS was overwritten: %q", got)
	}
	if _, err := second.Put(context.Background(), immutableTestKey(t, "absent"), strings.NewReader("bad")); err == nil {
		t.Fatal("unmatched digest created canonical CAS")
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(immutableTestKey(t, "absent")))); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("mismatched write left published bytes: %v", err)
	}
}

func TestCanonicalCASPutRefusesCorruptExistingOrSymlink(t *testing.T) {
	store, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	key := immutableTestKey(t, "expected")
	path := filepath.Join(store.root, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("replaced"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put(context.Background(), key, strings.NewReader("expected")); err == nil {
		t.Fatal("corrupt canonical content was silently replaced")
	}
	if got := immutableTestRead(t, store, key); got != "replaced" {
		t.Fatalf("corrupt existing CAS was modified: %q", got)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside")
	if err := os.WriteFile(outside, []byte("expected"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, path); err != nil {
		t.Skipf("symlink unsupported: %v", err)
	}
	if _, err := store.Put(context.Background(), key, strings.NewReader("expected")); err == nil {
		t.Fatal("symlink CAS target was accepted")
	}
	if data, err := os.ReadFile(outside); err != nil || string(data) != "expected" {
		t.Fatalf("outside symlink target changed: %q %v", data, err)
	}
}

func TestCanonicalCASPromoteVerifiesSourceAndExistingTarget(t *testing.T) {
	store, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	key := immutableTestKey(t, "verified")
	bad := "temporary/bad"
	if _, err := store.Put(context.Background(), bad, strings.NewReader("different")); err != nil {
		t.Fatal(err)
	}
	if err := store.Promote(context.Background(), bad, key, 9); err == nil {
		t.Fatal("unmatched staged object was promoted")
	}
	if _, err := store.Open(context.Background(), key); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("invalid promotion published content: %v", err)
	}
	good := "temporary/good"
	if _, err := store.Put(context.Background(), good, strings.NewReader("verified")); err != nil {
		t.Fatal(err)
	}
	if err := store.Promote(context.Background(), good, key, 8); err != nil {
		t.Fatal(err)
	}
	if got := immutableTestRead(t, store, key); got != "verified" {
		t.Fatalf("promoted CAS bytes=%q", got)
	}
	if _, err := store.Open(context.Background(), good); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("canonical promotion did not move staged bytes: %v", err)
	}
	idempotent := "temporary/reuse"
	if _, err := store.Put(context.Background(), idempotent, strings.NewReader("verified")); err != nil {
		t.Fatal(err)
	}
	if err := store.Promote(context.Background(), idempotent, key, 8); err != nil {
		t.Fatal(err)
	}
	if got := immutableTestRead(t, store, idempotent); got != "verified" {
		t.Fatalf("idempotent reuse changed staged file: %q", got)
	}
	if _, err := store.Put(context.Background(), "temporary/legacy", strings.NewReader("old")); err != nil {
		t.Fatal(err)
	}
	if err := store.Promote(context.Background(), "temporary/legacy", "legacy/final", 3); err != nil {
		t.Fatalf("non-CAS promotion changed: %v", err)
	}
}

func TestCanonicalCASWriteRejectsCanceledContext(t *testing.T) {
	store, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	key := immutableTestKey(t, "cancelled")
	if _, err := store.Put(ctx, key, strings.NewReader("cancelled")); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled canonical Put=%v", err)
	}
	if err := store.Promote(ctx, "staging/none", key, 9); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled canonical Promote=%v", err)
	}
}
