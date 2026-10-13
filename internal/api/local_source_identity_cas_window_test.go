package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/storage"
)

type localIdentityUnpinnedStore struct{ storage.Store }

func localIdentityCASWindowFixture(t *testing.T) (*storage.Local, *storage.Local, localEvidenceCloudObject) {
	t.Helper()
	root := t.TempDir()
	reader, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	writer, err := storage.NewLocal(root)
	if err != nil {
		t.Fatal(err)
	}
	body := strings.Repeat("authenticated-content-", 1000)
	sum := sha256.Sum256([]byte(body))
	sha := hex.EncodeToString(sum[:])
	key, err := storage.ContentAddressedKey(sha)
	if err != nil {
		t.Fatal(err)
	}
	if n, err := writer.Put(context.Background(), key, strings.NewReader(body)); err != nil || n != int64(len(body)) {
		t.Fatalf("canonical CAS admission failed: %d %v", n, err)
	}
	return reader, writer, localEvidenceCloudObject{SHA256: sha, Size: int64(len(body)), Key: key}
}

func TestLocalIdentityCASWindowPinsPhysicalBytesAcrossObserver(t *testing.T) {
	reader, writer, object := localIdentityCASWindowFixture(t)
	observed := false
	err := withLocalIdentityPinnedCASWindow(context.Background(), reader, object, func(context.Context) error {
		observed = true
		// Independent instances share the same canonical shard lifetime lease.
		for _, name := range []string{"delete", "put"} {
			ctx, cancel := context.WithTimeout(context.Background(), 170*time.Millisecond)
			var err error
			if name == "delete" {
				err = writer.Delete(ctx, object.Key)
			} else {
				_, err = writer.Put(ctx, object.Key, strings.NewReader("changed"))
			}
			cancel()
			if !errors.Is(err, context.DeadlineExceeded) {
				return errors.New("independent canonical CAS write bypassed shared pin")
			}
		}
		return nil
	})
	if err != nil || !observed {
		t.Fatalf("private pinned CAS observer did not complete: %v, observed=%t", err, observed)
	}
	if err := writer.Delete(context.Background(), object.Key); err != nil {
		t.Fatalf("private CAS pin not released after observer: %v", err)
	}
}

func TestLocalIdentityCASWindowFailsClosedAndReleasesPin(t *testing.T) {
	reader, writer, object := localIdentityCASWindowFixture(t)
	called := false
	for _, sample := range []struct {
		name   string
		store  storage.Store
		object localEvidenceCloudObject
	}{
		{"unleased backend", localIdentityUnpinnedStore{reader}, object},
		{"invalid size", reader, localEvidenceCloudObject{SHA256: object.SHA256, Size: -1, Key: object.Key}},
		{"oversized", reader, localEvidenceCloudObject{SHA256: object.SHA256, Size: localEvidencePhysicalCASLimitBytes + 1, Key: object.Key}},
		{"bad digest", reader, localEvidenceCloudObject{SHA256: strings.Repeat("a", 64), Size: object.Size, Key: object.Key}},
		{"wrong key", reader, localEvidenceCloudObject{SHA256: object.SHA256, Size: object.Size, Key: "temporary/wrong"}},
	} {
		t.Run(sample.name, func(t *testing.T) {
			if err := withLocalIdentityPinnedCASWindow(context.Background(), sample.store, sample.object, func(context.Context) error { called = true; return nil }); err == nil || called {
				t.Fatalf("invalid CAS scope reached observer: %v called=%t", err, called)
			}
		})
	}
	sentinel := errors.New("observer rejected")
	if err := withLocalIdentityPinnedCASWindow(context.Background(), reader, object, func(context.Context) error { return sentinel }); !errors.Is(err, sentinel) {
		t.Fatalf("observer error was not propagated: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	if err := withLocalIdentityPinnedCASWindow(ctx, reader, object, func(context.Context) error { cancel(); return nil }); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled observer returned success: %v", err)
	}
	if err := writer.Delete(context.Background(), object.Key); err != nil {
		t.Fatalf("cancelled observer retained CAS pin: %v", err)
	}
}

func TestLocalIdentityCASWindowDetectsOutOfBandChangeWithoutCommit(t *testing.T) {
	reader, writer, object := localIdentityCASWindowFixture(t)
	full := filepath.Join(reader.FilesystemRoot(), filepath.FromSlash(object.Key))
	if err := withLocalIdentityPinnedCASWindow(context.Background(), reader, object, func(context.Context) error {
		// Deliberately bypass the cooperative Local Store writer protocol to
		// model disk corruption. The second full hash must detect it.
		return os.WriteFile(full, []byte(strings.Repeat("z", int(object.Size))), 0o600)
	}); err == nil {
		t.Fatal("out-of-band same-size physical CAS corruption accepted")
	}
	if err := writer.Delete(context.Background(), object.Key); err != nil {
		t.Fatalf("corrupt CAS pin remained held: %v", err)
	}
}
