package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"testing"

	"github.com/lazyxu/xdrive/internal/client"
)

func TestAgentOwnerSmallUploadStagesIntoOriginalUploader(t *testing.T) {
	data := []byte("exact current Owner byte payload")
	digest := sha256.Sum256(data)
	input := agentOwnerSmallUploadInput{
		ParentID: 17, Name: "owner.txt", SHA256: hex.EncodeToString(digest[:]), Data: data,
	}
	var staged string
	calls := 0
	node, err := stageAgentOwnerSmallUpload(context.Background(), input,
		func(_ context.Context, id uint64, path, name string) (client.Node, error) {
			calls++
			staged = path
			if id != 17 || name != "owner.txt" {
				t.Fatalf("wrong Owner destination: %d %q", id, name)
			}
			contents, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(contents, data) {
				t.Fatalf("invalid Agent staging: %v", err)
			}
			return client.Node{ID: 42}, nil
		})
	if err != nil || node.ID != 42 || calls != 1 {
		t.Fatalf("original CAS uploader was not used exactly once: %v %#v %d", err, node, calls)
	}
	if _, err := os.Stat(staged); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("staged file remains after success: %v", err)
	}
	_, err = stageAgentOwnerSmallUpload(context.Background(), input,
		func(_ context.Context, _ uint64, path, _ string) (client.Node, error) {
			staged = path
			return client.Node{}, errors.New("Server rejected the upload")
		})
	if err == nil {
		t.Fatal("original uploader rejection was swallowed")
	}
	if _, err := os.Stat(staged); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("staged file remains after failure: %v", err)
	}
}

func TestAgentOwnerSmallUploadRejectsInvalidPayloadBeforeWriting(t *testing.T) {
	data := []byte("payload")
	sum := sha256.Sum256(data)
	valid := agentOwnerSmallUploadInput{
		ParentID: 17, Name: "ok.txt", SHA256: hex.EncodeToString(sum[:]), Data: data,
	}
	for label, mutate := range map[string]func(*agentOwnerSmallUploadInput){
		"zero parent": func(x *agentOwnerSmallUploadInput) { x.ParentID = 0 },
		"path name": func(x *agentOwnerSmallUploadInput) { x.Name = "../escape" },
		"empty name": func(x *agentOwnerSmallUploadInput) { x.Name = "" },
		"bad digest": func(x *agentOwnerSmallUploadInput) { x.SHA256 = "0" + x.SHA256[1:] },
		"empty content": func(x *agentOwnerSmallUploadInput) { x.Data = nil },
		"oversized content": func(x *agentOwnerSmallUploadInput) {
			x.Data = make([]byte, dsmOwnerSmallUploadMaxBytes+1)
		},
	} {
		t.Run(label, func(t *testing.T) {
			input := valid
			mutate(&input)
			called := false
			_, err := stageAgentOwnerSmallUpload(context.Background(), input,
				func(context.Context, uint64, string, string) (client.Node, error) {
					called = true
					return client.Node{}, nil
				})
			if err == nil || called {
				t.Fatalf("invalid content passed to uploader: err=%v called=%v", err, called)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := stageAgentOwnerSmallUpload(ctx, valid,
		func(context.Context, uint64, string, string) (client.Node, error) {
			t.Fatal("cancelled upload invoked writer")
			return client.Node{}, nil
		})
	if err == nil {
		t.Fatal("cancelled upload accepted")
	}
}
