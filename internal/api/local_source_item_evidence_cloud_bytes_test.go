package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/storage"
)

func TestVerifyPhysicalEvidenceCASReadsRealStoredBytesAndFailsClosed(t *testing.T) {
	s, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	body := strings.Repeat("live-content-fingerprint-", 22000)
	digest := sha256.Sum256([]byte(body))
	sha := hex.EncodeToString(digest[:])
	key, err := storage.ContentAddressedKey(sha)
	if err != nil {
		t.Fatal(err)
	}
	object := localEvidenceCloudObject{SHA256: sha, Size: int64(len(body)), Key: key}
	put := func(data string) {
		t.Helper()
		size, err := s.Put(context.Background(), key, strings.NewReader(data))
		if err != nil || size != int64(len(data)) {
			t.Fatalf("CAS fixture write: %d %v", size, err)
		}
	}
	put(body)
	if err := verifyPhysicalEvidenceCAS(context.Background(), s, object); err != nil {
		t.Fatalf("genuine physical bytes not verified: %v", err)
	}
	put(strings.Repeat("x", len(body)))
	if err := verifyPhysicalEvidenceCAS(context.Background(), s, object); err == nil {
		t.Fatal("same-size corrupted physical CAS bytes passed")
	}
	put(body[:len(body)-1])
	if err := verifyPhysicalEvidenceCAS(context.Background(), s, object); err == nil {
		t.Fatal("truncated physical CAS object passed")
	}
	put(body + "overrun")
	if err := verifyPhysicalEvidenceCAS(context.Background(), s, object); err == nil {
		t.Fatal("oversized physical CAS object passed")
	}
	put(body)
	for _, invalid := range []localEvidenceCloudObject{
		{SHA256: sha, Size: -1, Key: key},
		{SHA256: sha, Size: 64<<20 + 1, Key: key},
		{SHA256: sha, Size: object.Size, Key: ".xdrive-uploads/wrong"},
		{SHA256: "invalid", Size: object.Size, Key: key},
	} {
		if err := verifyPhysicalEvidenceCAS(context.Background(), s, invalid); err == nil {
			t.Fatalf("unsafe physical CAS probe accepted: %+v", invalid)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := verifyPhysicalEvidenceCAS(ctx, s, object); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled physical CAS probe not aborted: %v", err)
	}
	if err := s.Delete(context.Background(), key); err != nil {
		t.Fatal(err)
	}
	if err := verifyPhysicalEvidenceCAS(context.Background(), s, object); err == nil {
		t.Fatal("missing physical CAS object passed")
	}
}

type physicalCancelReader struct {
	cancel context.CancelFunc
	once   bool
}

func (r *physicalCancelReader) Read(p []byte) (int, error) {
	if !r.once {
		r.once = true
		p[0] = 'x'
		r.cancel()
		return 1, nil
	}
	return 0, io.EOF
}

func TestPhysicalCASContextReaderStopsMidstreamBeforeReportingSuccess(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	r := contextCASReader{ctx: ctx, src: &physicalCancelReader{cancel: cancel}}
	buf := make([]byte, 1)
	if n, err := r.Read(buf); n != 0 || !errors.Is(err, context.Canceled) {
		t.Fatalf("in-flight cancel not honored: n=%d err=%v", n, err)
	}
	if n, err := r.Read(buf); n != 0 || !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled reader continued: n=%d err=%v", n, err)
	}
}

func TestPhysicalEvidenceBatchBudgetFailsClosed(t *testing.T) {
	item := func(id uint64, size int64) localEvidenceCloudMetadataItem {
		return localEvidenceCloudMetadataItem{
			EvidenceID: id, SHA256: strings.Repeat("a", 64), Size: size,
		}
	}
	valid := [][]localEvidenceCloudMetadataItem{
		{item(1, 0)},
		{item(1, 1), item(2, 2)},
		{item(1, 64<<20)},
		{item(1, 32<<20), item(2, 32<<20)},
		{item(1, 2), item(2, 3), item(3, 4), item(4, 5)},
	}
	for _, batch := range valid {
		if !validLocalEvidencePhysicalCASBatch(batch) {
			t.Fatalf("valid bounded physical batch rejected: %+v", batch)
		}
	}
	invalid := [][]localEvidenceCloudMetadataItem{
		nil,
		{},
		{item(1, -1)},
		{item(1, 64<<20+1)},
		{item(1, 32<<20), item(2, 32<<20+1)},
		{item(1, 1), item(2, 1), item(3, 1), item(4, 1), item(5, 1)},
	}
	for _, batch := range invalid {
		if validLocalEvidencePhysicalCASBatch(batch) {
			t.Fatalf("oversized or empty physical batch accepted: %+v", batch)
		}
	}
}
