package api

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

func fixedSemanticInfoForHostProbe() photointelligence.SemanticAnalyzerInfo {
	model := photointelligence.FaceAnalyzerModelInfo{
		Name: "fixed-model", Version: "v1",
		SHA256: strings.Repeat("a", 64), License: "Apache-2.0",
	}
	return photointelligence.SemanticAnalyzerInfo{
		ProtocolVersion: photointelligence.SemanticAnalyzerProtocolVersion,
		Name:            "semantic-test", PipelineVersion: "v1",
		VisionModel: model, TextModel: model,
		TokenizerSHA256:     strings.Repeat("b", 64),
		EmbeddingFormat:     photointelligence.SemanticEmbeddingFormatI8Norm,
		EmbeddingDimensions: 128,
		RuntimeInstanceID:   "0123456789abcdef0123456789abcdef",
		HostApplyReceipt: &photointelligence.HostApplyReceipt{
			Revision: 7, RequestID: "0123456789abcdef01234567",
		},
	}
}

func TestPhotoHostFixedTextInferenceAndRedaction(t *testing.T) {
	info := fixedSemanticInfoForHostProbe()
	gate := meta.AdminPhotoHostApply{
		State: "host-verified", Revision: 7, RequestID: info.HostApplyReceipt.RequestID,
	}
	check := photoHostModelInfoCheck{
		ID: "photo-semantic", State: "ready", runtimeInstanceID: info.RuntimeInstanceID,
		hostReceipt: info.HostApplyReceipt,
	}
	raw := make([]byte, info.EmbeddingDimensions)
	raw[0] = 15
	vector := photointelligence.SemanticEmbedding{
		Embedding: raw, Format: info.EmbeddingFormat, Dimensions: info.EmbeddingDimensions,
	}
	calls := 0
	embed := func(_ context.Context, text string) (photointelligence.SemanticEmbedding, error) {
		calls++
		if text != "a photo of a dog" {
			t.Fatalf("unexpected user-selected prompt %q", text)
		}
		return vector, nil
	}
	read := func(context.Context) (photointelligence.SemanticAnalyzerInfo, error) {
		return info, nil
	}
	if !runPhotoHostSemanticTextInference(context.Background(), check, gate, embed, read) || calls != 1 {
		t.Fatal("fixed real inference or post-generation validation failed")
	}
	public, err := json.Marshal(adminPhotoHostPreflightDTO{SemanticTextTaskState: "verified"})
	if err != nil || strings.Contains(string(public), info.RuntimeInstanceID) ||
		strings.Contains(string(public), info.HostApplyReceipt.RequestID) ||
		strings.Contains(string(public), photoHostSemanticProbeText) ||
		strings.Contains(string(public), "embedding") {
		t.Fatal("private prompt, embedding or host identity leaked")
	}
	for name, bad := range map[string]struct {
		check    photoHostModelInfoCheck
		gate     meta.AdminPhotoHostApply
		info     photointelligence.SemanticAnalyzerInfo
		vector   photointelligence.SemanticEmbedding
		embedErr error
		infoErr  error
	}{
		"new model generation": {check, gate, func() photointelligence.SemanticAnalyzerInfo {
			x := info
			x.RuntimeInstanceID = strings.Repeat("c", 32)
			return x
		}(), vector, nil, nil},
		"mismatched host receipt": {check, gate, func() photointelligence.SemanticAnalyzerInfo {
			x := info
			x.HostApplyReceipt = &photointelligence.HostApplyReceipt{Revision: 8, RequestID: gate.RequestID}
			return x
		}(), vector, nil, nil},
		"missing host receipt":    {check, gate, func() photointelligence.SemanticAnalyzerInfo { x := info; x.HostApplyReceipt = nil; return x }(), vector, nil, nil},
		"all-zero embedding":      {check, gate, info, photointelligence.SemanticEmbedding{Embedding: make([]byte, 128), Format: info.EmbeddingFormat, Dimensions: 128}, nil, nil},
		"invalid embedding bytes": {check, gate, info, photointelligence.SemanticEmbedding{Embedding: []byte{1}, Format: info.EmbeddingFormat, Dimensions: 128}, nil, nil},
		"upstream failure":        {check, gate, info, vector, errors.New("private-path"), nil},
		"post Info failure":       {check, gate, info, vector, nil, errors.New("private-secret")},
		"missing ACK":             {func() photoHostModelInfoCheck { x := check; x.hostReceipt = nil; return x }(), gate, info, vector, nil, nil},
		"queued gate":             {check, meta.AdminPhotoHostApply{State: "queued", Revision: 7, RequestID: gate.RequestID}, info, vector, nil, nil},
	} {
		t.Run(name, func(t *testing.T) {
			got := runPhotoHostSemanticTextInference(context.Background(), bad.check, bad.gate,
				func(context.Context, string) (photointelligence.SemanticEmbedding, error) {
					return bad.vector, bad.embedErr
				},
				func(context.Context) (photointelligence.SemanticAnalyzerInfo, error) { return bad.info, bad.infoErr },
			)
			if got {
				t.Fatal("invalid model effect was counted as verified")
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	if runPhotoHostSemanticTextInference(ctx, check, gate,
		func(context.Context, string) (photointelligence.SemanticEmbedding, error) {
			called = true
			return vector, nil
		},
		read,
	) || called {
		t.Fatal("cancelled request invoked inference")
	}
}
