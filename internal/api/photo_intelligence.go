package api

import (
	"context"
	"log/slog"
	"time"

	"github.com/lazyxu/xdrive/internal/photointelligence"
)

const photoPlaceBatchSize = 32
const photoPlaceBusyInterval = 250 * time.Millisecond
const photoPlaceIdleInterval = 30 * time.Second
const photoPlaceErrorInterval = time.Minute

func (s *Server) StartPhotoIntelligence(ctx context.Context) {
	if s == nil || s.DB == nil || s.PhotoPlaceResolver == nil {
		return
	}
	runner := &photointelligence.PlaceRunner{
		DB:       s.DB,
		Resolver: s.PhotoPlaceResolver,
	}
	slog.Info(
		"photo_place_intelligence_started",
		"resolver", s.PhotoPlaceResolver.Name(),
		"resolver_version", s.PhotoPlaceResolver.Version(),
	)
	go func() {
		delay := time.Duration(0)
		for {
			if delay > 0 {
				select {
				case <-ctx.Done():
					return
				case <-time.After(delay):
				}
			}
			if ctx.Err() != nil {
				return
			}
			count, err := runner.RunBatch(ctx, photoPlaceBatchSize)
			switch {
			case err != nil:
				slog.Warn("photo_place_batch_failed", "error", err, "processed", count)
				delay = photoPlaceErrorInterval
			case count > 0:
				delay = photoPlaceBusyInterval
			default:
				delay = photoPlaceIdleInterval
			}
		}
	}()
}
