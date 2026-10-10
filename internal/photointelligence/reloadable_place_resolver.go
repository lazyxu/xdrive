package photointelligence

import (
	"fmt"
	"sync/atomic"
)

// ReloadablePlaceResolver owns the immutable GeoNames snapshot for a Server.
// Swapping does not mutate or invalidate snapshots held by running PlaceRunner
// batches. A new batch captures the most recent pointer before it queries.
type ReloadablePlaceResolver struct {
	current atomic.Pointer[GeoNamesResolver]
}

func NewReloadablePlaceResolver(initial *GeoNamesResolver) *ReloadablePlaceResolver {
	value := &ReloadablePlaceResolver{}
	value.current.Store(initial)
	return value
}

func (r *ReloadablePlaceResolver) Snapshot() PlaceResolver {
	if r == nil {
		return nil
	}
	current := r.current.Load()
	if current == nil {
		return nil
	}
	return current
}

func (r *ReloadablePlaceResolver) Swap(next *GeoNamesResolver) {
	if r == nil || next == nil || next.Version() == "" {
		panic("GeoNames reload requires a fully loaded resolver")
	}
	r.current.Store(next)
}

func (r *ReloadablePlaceResolver) Name() string {
	return GeoNamesResolverName
}

func (r *ReloadablePlaceResolver) Version() string {
	if snapshot := r.Snapshot(); snapshot != nil {
		return snapshot.Version()
	}
	return ""
}

func (r *ReloadablePlaceResolver) Resolve(lat, lon float64) (PlaceLabel, bool, error) {
	if snapshot := r.Snapshot(); snapshot != nil {
		return snapshot.Resolve(lat, lon)
	}
	return PlaceLabel{}, false, fmt.Errorf("GeoNames resolver is not loaded")
}
