package sourceagent

import (
	"time"

	"github.com/lazyxu/xdrive/internal/source"
)

type FilesystemIdentity struct {
	LegacyExternalID string
	StrongKey        string
	WeakKey          string
}

type IdentityObservation struct {
	Filesystem FilesystemIdentity
	Kind       string
	Path       string
	Size       int64
	ModifiedAt *time.Time
}

type IdentityStore interface {
	Resolve(IdentityObservation) (string, error)
	Flush() error
	Complete() error
}

func resolveExternalID(store IdentityStore, observation IdentityObservation) (string, error) {
	if store == nil {
		return observation.Filesystem.LegacyExternalID, nil
	}
	return store.Resolve(observation)
}

func identityObservation(item source.DiscoveredItem, filesystem FilesystemIdentity) IdentityObservation {
	return IdentityObservation{
		Filesystem: filesystem,
		Kind:       item.Kind,
		Path:       item.Path,
		Size:       item.Size,
		ModifiedAt: item.ModifiedAt,
	}
}
