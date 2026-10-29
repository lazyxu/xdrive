package client

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"testing"
)

type ownerLiveSourceFixture struct {
	item           MediaItem
	data           []byte
	mime           string
	headerLength   int64
	calls          int
	changeRevision bool
	motionErr      error
}

func (f *ownerLiveSourceFixture) MediaItem(_ context.Context, _ uint64) (MediaItem, error) {
	f.calls++
	out := f.item
	if f.changeRevision && f.calls > 1 {
		out.Node.Revision++
	}
	return out, nil
}

func (f *ownerLiveSourceFixture) MediaLivePhotoMotion(_ context.Context, _ uint64) (io.ReadCloser, string, int64, error) {
	if f.motionErr != nil {
		return nil, "", 0, f.motionErr
	}
	length := f.headerLength
	if length == 0 {
		length = int64(len(f.data))
	}
	return io.NopCloser(bytes.NewReader(f.data)), f.mime, length, nil
}

func liveMotionBytes() []byte {
	return []byte{0, 0, 0, 20, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 1, 2, 3, 4, 5, 6, 7, 8}
}

func liveFixture() *ownerLiveSourceFixture {
	return &ownerLiveSourceFixture{
		item: MediaItem{Node: Node{ID: 42, Revision: 7, Type: "file"}, Metadata: MediaMetadata{MediaKind: "image"}, LivePhoto: true},
		data: liveMotionBytes(), mime: "video/quicktime",
	}
}

func TestReadVerifiedOwnerLiveMotion(t *testing.T) {
	f := liveFixture()
	m, err := ReadVerifiedOwnerLiveMotion(context.Background(), f, 42, 7)
	if err != nil {
		t.Fatal(err)
	}
	if f.calls != 2 {
		t.Fatalf("must verify current Owner twice, got %d", f.calls)
	}
	if !ValidateOwnerLiveMotion(m, 42, 7) || m.MIMEType != "video/quicktime" || m.Size != len(f.data) {
		t.Fatal("valid exact Owner motion rejected")
	}
	if m.NodeID != 42 || m.Revision != 7 || !bytes.Equal(m.Data, f.data) {
		t.Fatal("incorrect motion projection")
	}
	sum := sha256.Sum256(m.Data)
	if hex.EncodeToString(sum[:]) != m.SHA256 {
		t.Fatal("incorrect motion digest")
	}
	m.Data[5] ^= 1
	if ValidateOwnerLiveMotion(m, 42, 7) {
		t.Fatal("corrupt motion accepted")
	}
}

func TestOwnerLiveMotionFailsClosed(t *testing.T) {
	t.Run("not live", func(t *testing.T) {
		f := liveFixture()
		f.item.LivePhoto = false
		if _, err := ReadVerifiedOwnerLiveMotion(context.Background(), f, 42, 7); err == nil {
			t.Fatal("nonlive accepted")
		}
		if f.calls != 1 {
			t.Fatal("motion read after missing Live grant")
		}
	})
	// A current authenticated Node by itself is insufficient: only an
	// actual image Live Photo can expose its embedded or paired motion.
	for _, tc := range []struct {
		name string
		change func(*ownerLiveSourceFixture)
	}{
		{"wrong Owner-visible node", func(f *ownerLiveSourceFixture) { f.item.Node.ID = 43 }},
		{"non-file", func(f *ownerLiveSourceFixture) { f.item.Node.Type = "dir" }},
		{"video is not a Live still", func(f *ownerLiveSourceFixture) { f.item.Metadata.MediaKind = "video" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := liveFixture()
			tc.change(f)
			if _, err := ReadVerifiedOwnerLiveMotion(context.Background(), f, 42, 7); err == nil {
				t.Fatal("invalid Owner Live Photo admitted")
			}
			if f.calls != 1 {
				t.Fatalf("motion fetched before Owner identity admission: %d calls", f.calls)
			}
		})
	}
	t.Run("wrong revision", func(t *testing.T) {
		f := liveFixture()
		if _, err := ReadVerifiedOwnerLiveMotion(context.Background(), f, 42, 8); err == nil {
			t.Fatal("revision mismatch")
		}
	})
	t.Run("old revision after read", func(t *testing.T) {
		f := liveFixture()
		f.changeRevision = true
		if _, err := ReadVerifiedOwnerLiveMotion(context.Background(), f, 42, 7); err == nil {
			t.Fatal("changed Owner accepted")
		}
	})
	t.Run("unsupported mime", func(t *testing.T) {
		f := liveFixture()
		f.mime = "text/html"
		if _, err := ReadVerifiedOwnerLiveMotion(context.Background(), f, 42, 7); err == nil {
			t.Fatal("active content accepted")
		}
	})
	t.Run("truncated", func(t *testing.T) {
		f := liveFixture()
		f.headerLength = int64(len(f.data) + 3)
		if _, err := ReadVerifiedOwnerLiveMotion(context.Background(), f, 42, 7); err == nil {
			t.Fatal("truncated motion accepted")
		}
	})
	t.Run("too big", func(t *testing.T) {
		f := liveFixture()
		f.data = bytes.Repeat([]byte{1}, OwnerLiveMotionMaxBytes+1)
		if _, err := ReadVerifiedOwnerLiveMotion(context.Background(), f, 42, 7); err == nil {
			t.Fatal("oversized Owner motion accepted")
		}
	})
	t.Run("invalid signature", func(t *testing.T) {
		f := liveFixture()
		f.data[4] = 'H'
		if _, err := ReadVerifiedOwnerLiveMotion(context.Background(), f, 42, 7); err == nil {
			t.Fatal("bad motion magic accepted")
		}
	})
	t.Run("Server failure", func(t *testing.T) {
		f := liveFixture()
		f.motionErr = errors.New("private rejection")
		if _, err := ReadVerifiedOwnerLiveMotion(context.Background(), f, 42, 7); err == nil {
			t.Fatal("Server rejected motion accepted")
		}
	})
	t.Run("already canceled", func(t *testing.T) {
		f := liveFixture()
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if _, err := ReadVerifiedOwnerLiveMotion(ctx, f, 42, 7); err == nil {
			t.Fatal("cancelled motion accepted")
		}
		if f.calls != 0 {
			t.Fatal("cancelled request contacted Server")
		}
	})
	t.Run("noncanonical identity", func(t *testing.T) {
		f := liveFixture()
		if _, err := ReadVerifiedOwnerLiveMotion(context.Background(), f, 1<<53, 7); err == nil {
			t.Fatal("unsafe JS ID")
		}
	})
}
