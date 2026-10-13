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

func TestPhotoHostSyntheticImageInferenceBoundToOriginalGeneration(t *testing.T) {
	info := fixedSemanticInfoForHostProbe()
	gate := meta.AdminPhotoHostApply{State: "host-verified", Revision: 7, RequestID: info.HostApplyReceipt.RequestID}
	check := photoHostModelInfoCheck{
		ID: "photo-semantic", State: "ready", runtimeInstanceID: info.RuntimeInstanceID,
		hostReceipt: info.HostApplyReceipt,
	}
	bytes := make([]byte, info.EmbeddingDimensions)
	bytes[0] = 15
	vector := photointelligence.SemanticEmbedding{Embedding: bytes, Format: info.EmbeddingFormat, Dimensions: info.EmbeddingDimensions}
	calls, reads := 0, 0
	inference := func(context.Context) (photointelligence.SemanticEmbedding, error) {
		calls++
		return vector, nil
	}
	read := func(context.Context) (photointelligence.SemanticAnalyzerInfo, error) {
		reads++
		return info, nil
	}
	if !runPhotoHostSemanticImageInference(context.Background(), check, gate, inference, read) || calls != 1 || reads != 1 {
		t.Fatalf("real fixed image inference or post-generation recheck failed: calls=%d reads=%d", calls, reads)
	}
	public, err := json.Marshal(adminPhotoHostPreflightDTO{SemanticImageTaskState: "verified"})
	if err != nil || strings.Contains(string(public), info.RuntimeInstanceID) ||
		strings.Contains(string(public), gate.RequestID) ||
		strings.Contains(string(public), "embedding") {
		t.Fatal("private image vector, model process or host request escaped")
	}
	for name, bad := range map[string]struct {
		check    photoHostModelInfoCheck
		gate     meta.AdminPhotoHostApply
		info     photointelligence.SemanticAnalyzerInfo
		vector   photointelligence.SemanticEmbedding
		inferErr error
		infoErr  error
	}{
		"changed model generation": {check, gate, func() photointelligence.SemanticAnalyzerInfo {
			x := info
			x.RuntimeInstanceID = strings.Repeat("c", 32)
			return x
		}(), vector, nil, nil},
		"wrong host receipt": {check, gate, func() photointelligence.SemanticAnalyzerInfo {
			x := info
			x.HostApplyReceipt = &photointelligence.HostApplyReceipt{Revision: 8, RequestID: gate.RequestID}
			return x
		}(), vector, nil, nil},
		"missing receipt":    {check, gate, func() photointelligence.SemanticAnalyzerInfo { x := info; x.HostApplyReceipt = nil; return x }(), vector, nil, nil},
		"zero vector":        {check, gate, info, photointelligence.SemanticEmbedding{Embedding: make([]byte, info.EmbeddingDimensions), Format: info.EmbeddingFormat, Dimensions: info.EmbeddingDimensions}, nil, nil},
		"bad dimensions":     {check, gate, info, photointelligence.SemanticEmbedding{Embedding: bytes, Format: info.EmbeddingFormat, Dimensions: 127}, nil, nil},
		"upstream error":     {check, gate, info, vector, errors.New("private-socket"), nil},
		"Info recheck error": {check, gate, info, vector, nil, errors.New("private-info")},
		"no model ACK":       {func() photoHostModelInfoCheck { x := check; x.hostReceipt = nil; return x }(), gate, info, vector, nil, nil},
		"unverified gate":    {check, meta.AdminPhotoHostApply{State: "queued", Revision: 7, RequestID: gate.RequestID}, info, vector, nil, nil},
	} {
		t.Run(name, func(t *testing.T) {
			if runPhotoHostSemanticImageInference(context.Background(), bad.check, bad.gate,
				func(context.Context) (photointelligence.SemanticEmbedding, error) { return bad.vector, bad.inferErr },
				func(context.Context) (photointelligence.SemanticAnalyzerInfo, error) { return bad.info, bad.infoErr },
			) {
				t.Fatal("unproven image task was accepted")
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	if runPhotoHostSemanticImageInference(ctx, check, gate,
		func(context.Context) (photointelligence.SemanticEmbedding, error) { called = true; return vector, nil },
		read,
	) || called {
		t.Fatal("cancelled image probe executed model task")
	}
}
