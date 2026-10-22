package localpushcommon

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

type fakeUploader struct {
	calls     []client.UploadInit
	failAt    int
	badHashAt int
}

func (f *fakeUploader) UploadStreamResumableVerifiedResult(_ context.Context, init client.UploadInit,
	_ client.UploadStreamOpen, _ client.UploadProgress) (client.UploadResult, error) {
	f.calls = append(f.calls, init)
	n := len(f.calls)
	if n == f.failAt {
		return client.UploadResult{}, errors.New("lost finalize ACK")
	}
	id := uint64(n)
	parent := init.ParentID
	if init.NodeID != nil {
		id = *init.NodeID
		parent = nil
	}
	hash := init.SHA256
	if n == f.badHashAt {
		hash = strings.Repeat("0", 64)
	}
	return client.UploadResult{
		SHA256: hash,
		Node:   client.Node{ID: id, ParentID: parent, Name: init.Name, Type: "file", Size: init.Size, SHA256: hash, Revision: 1},
	}, nil
}

func TestCommonUploadSerialUsesSameEngineForTwoFiles(t *testing.T) {
	a := fixturePlan()
	b := fixturePlan()
	b.OperationID = "44567890-1234-1234-1234-123456789abc"
	b.RelativePath = "nested/second.txt"
	b.Target.Name = "second.txt"
	b.ContentSHA256 = strings.Repeat("d", 64)
	open := func(context.Context, int64) (io.ReadCloser, error) { return io.NopCloser(strings.NewReader("")), nil }
	f := &fakeUploader{}
	got, err := UploadSerial(context.Background(), f, []Task{{Plan: a, Open: open}, {Plan: b, Open: open}})
	if err != nil || len(got) != 2 || len(f.calls) != 2 {
		t.Fatalf("two common uploads got=%d calls=%d err=%v", len(got), len(f.calls), err)
	}
	if f.calls[0].ResumeKey == f.calls[1].ResumeKey || f.calls[0].SHA256 != a.ContentSHA256 || f.calls[1].SHA256 != b.ContentSHA256 ||
		f.calls[0].ParentID == nil || *f.calls[0].ParentID != a.Target.ParentID {
		t.Fatalf("wrong shared engine bindings: %+v", f.calls)
	}
}

func TestCommonUploadUncertainStopsBeforeNextFile(t *testing.T) {
	a := fixturePlan()
	b := fixturePlan()
	b.OperationID = "44567890-1234-1234-1234-123456789abc"
	b.RelativePath = "nested/second.txt"
	b.Target.Name = "second.txt"
	b.ContentSHA256 = strings.Repeat("d", 64)
	open := func(context.Context, int64) (io.ReadCloser, error) { return io.NopCloser(strings.NewReader("")), nil }
	for _, f := range []*fakeUploader{{failAt: 2}, {badHashAt: 2}} {
		got, err := UploadSerial(context.Background(), f, []Task{{Plan: a, Open: open}, {Plan: b, Open: open}, {Plan: func() Plan { c := b; c.OperationID = "54567890-1234-1234-1234-123456789abc"; return c }(), Open: open}})
		if !errors.Is(err, ErrUncertain) || len(got) != 1 || len(f.calls) != 2 {
			t.Fatalf("unsafe retry after lost ACK: results=%d calls=%d err=%v", len(got), len(f.calls), err)
		}
	}
}

func TestCommonUploadInvalidBatchNoSideEffects(t *testing.T) {
	p := fixturePlan()
	open := func(context.Context, int64) (io.ReadCloser, error) { return io.NopCloser(strings.NewReader("")), nil }
	f := &fakeUploader{}
	_, err := UploadSerial(context.Background(), f, []Task{{Plan: p, Open: open}, {Plan: p, Open: open}})
	if !errors.Is(err, ErrInvalidPlan) || len(f.calls) != 0 {
		t.Fatalf("duplicate key mutated server: %v", err)
	}
}
