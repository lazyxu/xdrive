package api

import (
	"reflect"
	"sort"
	"strings"

	"github.com/lazyxu/xdrive/internal/meta"
)

// These are read-only classifications of a primary-SHA duplicate group.
// Neither result authorizes automatic deletion or metadata merging.
const (
	duplicateAssetIdentical      = "identical"
	duplicateAssetDifferent      = "different"
	duplicateAssetUnverified     = "unverified"
	duplicateComparisonMaxAssets = 512
)

type duplicateResourceIdentity struct {
	Kind       string
	Role       string
	Ordinal    int
	MediaKind  string
	MIMEType   string
	Size       int64
	SHA256     string
	ByteOffset int64
}

type duplicateEditIdentity struct {
	SourceSHA256    string
	RotationDegrees int
	FlipHorizontal  bool
	FlipVertical    bool
	CropX           float64
	CropY           float64
	CropWidth       float64
	CropHeight      float64
	ExposureEV      float64
	Contrast        float64
	Saturation      float64
	TrimStartMS     int64
	TrimEndMS       int64
}

type duplicateAssetIdentity struct {
	Kind      string
	Resources []duplicateResourceIdentity
	Edit      *duplicateEditIdentity
}

func duplicateAssetIdentityFor(
	member mediaDuplicateMemberRow,
	resources []meta.PhotoResource,
	edit meta.PhotoEditRecipe,
	hasEdit bool,
) (duplicateAssetIdentity, bool) {
	if member.AssetID == 0 || member.NodeID == 0 || member.AssetKind == "" ||
		len(resources) == 0 {
		return duplicateAssetIdentity{}, false
	}
	identity := duplicateAssetIdentity{
		Kind:      member.AssetKind,
		Resources: make([]duplicateResourceIdentity, 0, len(resources)),
	}
	hasPrimary := false
	roles := make(map[string]int)
	for _, resource := range resources {
		sha := strings.ToLower(strings.TrimSpace(resource.SHA256))
		if !meta.ValidPhotoResourceKind(resource.ResourceKind) || sha == "" ||
			resource.Size < 0 || resource.ByteOffset < 0 ||
			strings.TrimSpace(resource.Role) == "" || resource.MediaKind == "" {
			return duplicateAssetIdentity{}, false
		}
		if resource.ResourceKind == meta.PhotoResourceKindNode &&
			resource.NodeID == member.NodeID &&
			sha == strings.ToLower(strings.TrimSpace(member.SHA256)) {
			hasPrimary = true
		}
		roles[resource.Role]++
		identity.Resources = append(identity.Resources, duplicateResourceIdentity{
			Kind: resource.ResourceKind, Role: resource.Role, Ordinal: resource.Ordinal,
			MediaKind: resource.MediaKind, MIMEType: strings.ToLower(resource.MIMEType),
			Size: resource.Size, SHA256: sha, ByteOffset: resource.ByteOffset,
		})
	}
	if !hasPrimary {
		return duplicateAssetIdentity{}, false
	}
	switch member.AssetKind {
	case meta.PhotoAssetKindImage, meta.PhotoAssetKindVideo:
		if len(resources) != 1 || roles[meta.MediaGroupRolePrimary] != 1 {
			return duplicateAssetIdentity{}, false
		}
	case meta.PhotoAssetKindLivePhoto:
		if roles[meta.MediaGroupRoleStill] != 1 ||
			roles[meta.MediaGroupRoleMotion] != 1 ||
			roles[meta.MediaGroupRoleContainer] > 1 ||
			len(resources) != 2+roles[meta.MediaGroupRoleContainer] {
			return duplicateAssetIdentity{}, false
		}
	case meta.PhotoAssetKindRAWPair:
		if roles[meta.MediaGroupRoleRendered] != 1 ||
			roles[meta.MediaGroupRoleRAW] != 1 ||
			roles[meta.MediaGroupRoleSidecar] > 1 ||
			len(resources) != 2+roles[meta.MediaGroupRoleSidecar] {
			return duplicateAssetIdentity{}, false
		}
	case meta.PhotoAssetKindSidecar:
		if len(resources) != 2 || roles[meta.MediaGroupRolePrimary] != 1 ||
			roles[meta.MediaGroupRoleSidecar] != 1 {
			return duplicateAssetIdentity{}, false
		}
	case meta.PhotoAssetKindBurst:
		if len(resources) < 2 || roles[meta.MediaGroupRolePrimary] != 1 ||
			roles[meta.MediaGroupRoleAuxiliary] != len(resources)-1 {
			return duplicateAssetIdentity{}, false
		}
	default:
		return duplicateAssetIdentity{}, false
	}
	sort.Slice(identity.Resources, func(i, j int) bool {
		left, right := identity.Resources[i], identity.Resources[j]
		if left.Ordinal != right.Ordinal {
			return left.Ordinal < right.Ordinal
		}
		if left.Role != right.Role {
			return left.Role < right.Role
		}
		if left.Kind != right.Kind {
			return left.Kind < right.Kind
		}
		if left.SHA256 != right.SHA256 {
			return left.SHA256 < right.SHA256
		}
		return left.ByteOffset < right.ByteOffset
	})
	if hasEdit {
		if edit.SourceNodeID != member.NodeID ||
			edit.SourceNodeRevision != member.NodeRevision ||
			!strings.EqualFold(edit.SourceSHA256, member.SHA256) {
			return duplicateAssetIdentity{}, false
		}
		identity.Edit = &duplicateEditIdentity{
			SourceSHA256:    strings.ToLower(strings.TrimSpace(edit.SourceSHA256)),
			RotationDegrees: edit.RotationDegrees,
			FlipHorizontal:  edit.FlipHorizontal, FlipVertical: edit.FlipVertical,
			CropX: edit.CropX, CropY: edit.CropY,
			CropWidth: edit.CropWidth, CropHeight: edit.CropHeight,
			ExposureEV: edit.ExposureEV, Contrast: edit.Contrast,
			Saturation: edit.Saturation, TrimStartMS: edit.TrimStartMS,
			TrimEndMS: edit.TrimEndMS,
		}
	}
	return identity, true
}

func classifyDuplicateAssetGroup(
	members []mediaDuplicateMemberRow,
	resources map[uint64][]meta.PhotoResource,
	recipes map[uint64]meta.PhotoEditRecipe,
) (string, string) {
	const unverified = "完整资源或编辑来源尚未验证；仅能确定主文件 SHA-256 相同"
	if len(members) < 2 {
		return duplicateAssetUnverified, unverified
	}
	var first duplicateAssetIdentity
	for index, member := range members {
		recipe, hasRecipe := recipes[member.AssetID]
		current, ok := duplicateAssetIdentityFor(member, resources[member.AssetID], recipe, hasRecipe)
		if !ok {
			return duplicateAssetUnverified, unverified
		}
		if index == 0 {
			first = current
			continue
		}
		if !reflect.DeepEqual(first, current) {
			return duplicateAssetDifferent, "主文件相同，但完整资源或编辑配方存在差异；不能作为完全相同资产合并"
		}
	}
	return duplicateAssetIdentical, "全部原始资源及编辑配方一致；整理前仍需保全相册、标签、人物等用户信息"
}
