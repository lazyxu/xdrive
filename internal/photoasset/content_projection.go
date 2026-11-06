package photoasset

import (
	"fmt"
	"sort"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
)

// Identity is established only from the exact indexed originals. A persisted
// container range's SHA256 binds its parent archive; it is not the member hash.
func desiredContentIdentity(asset desiredAsset, nodes map[uint64]meta.Node, metadata map[uint64]meta.MediaMetadata) (ContentIdentity, error) {
	if asset.primaryID == 0 {
		return ContentIdentity{}, fmt.Errorf("photo has no verified source")
	}
	var originals []OriginalResource
	for _, resource := range asset.resources {
		node, ok := nodes[resource.nodeID]
		if !ok || node.File == nil || node.DeletedAt != nil ||
			!validContentSHA256(node.File.SHA256) || node.File.Size <= 0 {
			return ContentIdentity{}, fmt.Errorf("photo source changed")
		}
		if resource.mediaKind == meta.MediaKindImage || resource.mediaKind == meta.MediaKindVideo || resource.kind == meta.PhotoResourceKindDerived {
			row, ok := metadata[node.ID]
			if !ok || row.OwnerID != node.OwnerID || row.NodeRevision != node.Revision ||
				row.SHA256 != node.File.SHA256 || row.IndexState != meta.MediaIndexStateReady {
				return ContentIdentity{}, fmt.Errorf("photo index is not current")
			}
		}
		if resource.role == meta.PhotoResourceRoleContainer {
			if resource.kind != meta.PhotoResourceKindNode || resource.sha256 != node.File.SHA256 || resource.size != node.File.Size {
				return ContentIdentity{}, fmt.Errorf("photo container changed")
			}
			continue // Packaging is a source location, not a third Live original.
		}
		sha := resource.sha256
		if resource.kind == meta.PhotoResourceKindDerived {
			row := metadata[node.ID]
			if asset.kind != meta.PhotoAssetKindLivePhoto || row.ContainerKind != mediapkg.ContainerKindLIVP ||
				row.DerivedResourceVersion < mediapkg.LIVPDerivedResourceVersion {
				return ContentIdentity{}, fmt.Errorf("container original digests need reindexing")
			}
			sha = mediapkg.LiveContainerMemberSHA256(row.ContainerJSON, resource.role, resource.byteOffset, resource.size)
			if sha == "" || sha != resource.sha256 {
				return ContentIdentity{}, fmt.Errorf("container member digest is not current")
			}
		} else if resource.kind != meta.PhotoResourceKindNode || resource.size != node.File.Size || resource.sha256 != node.File.SHA256 {
			return ContentIdentity{}, fmt.Errorf("photo original size is not current")
		}
		originals = append(originals, OriginalResource{Role: resource.role, SHA256: sha, Size: resource.size, Ordinal: resource.ordinal})
	}
	return IdentifyOriginals(asset.kind, originals)
}

// Source occurrences are retained separately even when their content becomes
// one Gallery item. The caller scopes nodes/metadata to one authenticated Owner.
// Unverified legacy entries remain separate until their index supplies evidence.
func groupDesiredContent(desired []desiredAsset, nodes map[uint64]meta.Node, metadata map[uint64]meta.MediaMetadata) ([]desiredAsset, error) {
	out := make([]desiredAsset, 0, len(desired))
	byKey := make(map[string]int)
	for _, value := range desired {
		identity, err := desiredContentIdentity(value, nodes, metadata)
		origin := desiredOrigin{primaryID: value.primaryID, resources: value.resources}
		if err == nil {
			if index, found := byKey[identity.Key]; found {
				if identity.Manifest != out[index].identity.Manifest {
					return nil, fmt.Errorf("conflicting metadata for identical photo content")
				}
				out[index].origins = append(out[index].origins, origin)
				continue
			}
			value.identity = identity
			byKey[identity.Key] = len(out)
		}
		value.origins = []desiredOrigin{origin}
		out = append(out, value)
	}
	// Stable order for bounded database writes; identity itself never includes ID.
	sort.Slice(out, func(i, j int) bool { return out[i].primaryID < out[j].primaryID })
	return out, nil
}
