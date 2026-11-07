package photoasset

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/lazyxu/xdrive/internal/meta"
)

const (
	OriginalContentKeyPrefix = "sha256:"
	BundleContentKeyPrefix   = "photo-bundle:v1:sha256:"
)

// OriginalResource identifies complete, verified original bytes, not a Node,
// filename, preview, archive parent digest or approximate image fingerprint.
// For container members callers must supply the digest of the complete member.
// Pairing evidence is verified before a group reaches this identity function.
type OriginalResource struct {
	Role    string `json:"role"`
	SHA256  string `json:"sha256"`
	Size    int64  `json:"size"`
	Ordinal int    `json:"ordinal"`
}

type ContentIdentity struct {
	Key      string
	Manifest string
}

// IdentifyOriginals implements the immutable photo identity contract. The
// result is content-only; an Owner-scoped reference is always required for
// authorization. Hash equality never grants access to another Owner's media.
func IdentifyOriginals(kind string, originals []OriginalResource) (ContentIdentity, error) {
	if !meta.ValidPhotoAssetKind(kind) || len(originals) == 0 {
		return ContentIdentity{}, fmt.Errorf("photo originals are incomplete")
	}
	resources := append([]OriginalResource(nil), originals...)
	roles := make(map[string]int)
	ordinals := make(map[int]bool)
	for i := range resources {
		r := &resources[i]
		r.SHA256 = strings.ToLower(strings.TrimSpace(r.SHA256))
		if !validContentSHA256(r.SHA256) || r.Size <= 0 || r.Ordinal < 0 {
			return ContentIdentity{}, fmt.Errorf("photo original is not verified")
		}
		roles[r.Role]++
		if kind == meta.PhotoAssetKindBurst {
			if ordinals[r.Ordinal] {
				return ContentIdentity{}, fmt.Errorf("burst original order is ambiguous")
			}
			ordinals[r.Ordinal] = true
		} else {
			// Role identifies still/motion and RAW/rendered originals. An
			// importer's traversal order is not part of their identity.
			r.Ordinal = 0
		}
	}
	complete := false
	switch kind {
	case meta.PhotoAssetKindImage, meta.PhotoAssetKindVideo:
		complete = len(resources) == 1 && roles[meta.PhotoResourceRolePrimary] == 1
	case meta.PhotoAssetKindLivePhoto:
		complete = len(resources) == 2 && roles[meta.MediaGroupRoleStill] == 1 && roles[meta.MediaGroupRoleMotion] == 1
	case meta.PhotoAssetKindRAWPair:
		complete = roles[meta.MediaGroupRoleRAW] == 1 && roles[meta.MediaGroupRoleRendered] == 1 &&
			roles[meta.MediaGroupRoleSidecar] <= 1 && len(resources) == 2+roles[meta.MediaGroupRoleSidecar]
	case meta.PhotoAssetKindSidecar:
		complete = len(resources) == 2 && roles[meta.MediaGroupRolePrimary] == 1 && roles[meta.MediaGroupRoleSidecar] == 1
	case meta.PhotoAssetKindBurst:
		complete = len(resources) >= 2 && roles[meta.MediaGroupRolePrimary] == 1 &&
			roles[meta.MediaGroupRoleAuxiliary] == len(resources)-1
	}
	if !complete {
		return ContentIdentity{}, fmt.Errorf("photo original roles are incomplete or ambiguous")
	}
	sort.Slice(resources, func(i, j int) bool {
		if resources[i].Ordinal != resources[j].Ordinal {
			return resources[i].Ordinal < resources[j].Ordinal
		}
		return resources[i].Role < resources[j].Role
	})
	manifest, err := json.Marshal(struct {
		Version   int                `json:"version"`
		Kind      string             `json:"kind"`
		Originals []OriginalResource `json:"originals"`
	}{1, kind, resources})
	if err != nil {
		return ContentIdentity{}, err
	}
	key := OriginalContentKeyPrefix + resources[0].SHA256
	if len(resources) > 1 {
		// Domain separation and a versioned canonical manifest distinguish a
		// resource bundle from a single file whose bytes resemble a manifest.
		digest := sha256.Sum256(append([]byte("xdrive-photo-originals-v1\x00"), manifest...))
		key = BundleContentKeyPrefix + hex.EncodeToString(digest[:])
	}
	return ContentIdentity{Key: key, Manifest: string(manifest)}, nil
}

func ValidContentKey(key string) bool {
	for _, prefix := range []string{OriginalContentKeyPrefix, BundleContentKeyPrefix} {
		if strings.HasPrefix(key, prefix) {
			return validContentSHA256(strings.TrimPrefix(key, prefix))
		}
	}
	return false
}

func validContentSHA256(value string) bool {
	if len(value) != sha256.Size*2 || value != strings.ToLower(value) {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
