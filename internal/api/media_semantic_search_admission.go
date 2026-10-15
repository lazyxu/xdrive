package api

import (
	"context"
	"errors"
	"time"

	"github.com/lazyxu/xdrive/internal/photointelligence"
)

const photoHostForegroundSemanticTimeout = 6 * time.Second

var errPhotoHostForegroundSemanticUnavailable = errors.New("semantic inference temporarily unavailable")

// Only the foreground gallery Rank path receives this narrow adapter. Info and
// cached embeddings retain their existing behavior; a cache miss must acquire
// the SAME shared PostgreSQL session lease as queued Photo/Creative and manual
// Host canaries before invoking model inference. This is NOT a safe-stop permit.
type photoHostAdmissionFencedSemanticAnalyzer struct {
	photointelligence.SemanticAnalyzer
	server *Server
}

func (a photoHostAdmissionFencedSemanticAnalyzer) EmbedText(
	ctx context.Context,
	text string,
) (photointelligence.SemanticEmbedding, error) {
	if a.server == nil || a.SemanticAnalyzer == nil || ctx == nil || ctx.Err() != nil {
		return photointelligence.SemanticEmbedding{}, errPhotoHostForegroundSemanticUnavailable
	}
	inferenceCtx, cancel := context.WithTimeout(ctx, photoHostForegroundSemanticTimeout)
	defer cancel()

	var result photointelligence.SemanticEmbedding
	var modelErr error
	if !a.server.photoHostRunAdmittedSyntheticInference(inferenceCtx, func(leasedCtx context.Context) {
		result, modelErr = a.SemanticAnalyzer.EmbedText(leasedCtx, text)
	}) {
		// In particular, a frozen admission gate, missing migration, lost
		// lease, or canceled request must NOT fill the query-embedding cache.
		return photointelligence.SemanticEmbedding{}, errPhotoHostForegroundSemanticUnavailable
	}
	return result, modelErr
}
