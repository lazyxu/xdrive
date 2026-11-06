package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
)

const maxExactMediaProbes = 8

type exactMediaComponent struct {
	Role   string `json:"role"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type exactMediaProbe struct {
	Kind       string                `json:"kind"`
	Components []exactMediaComponent `json:"components"`
}

type exactMediaMatch struct {
	State    string `json:"state"`
	AssetID  uint64 `json:"asset_id,omitempty"`
	NodeID   uint64 `json:"node_id,omitempty"`
	Revision uint64 `json:"revision,omitempty"`
}

func (probe exactMediaProbe) valid() bool {
	switch probe.Kind {
	case meta.PhotoAssetKindImage, meta.PhotoAssetKindVideo:
		if len(probe.Components) != 1 || probe.Components[0].Role != meta.PhotoResourceRolePrimary {
			return false
		}
	case meta.PhotoAssetKindLivePhoto:
		if len(probe.Components) != 2 ||
			probe.Components[0].Role != meta.MediaGroupRoleStill ||
			probe.Components[1].Role != meta.MediaGroupRoleMotion {
			return false
		}
	default:
		return false
	}
	for _, part := range probe.Components {
		if part.Size <= 0 || !validSHA256(part.SHA256) || part.SHA256 != strings.ToLower(part.SHA256) {
			return false
		}
	}
	return true
}

// This is a read-only lookup within the caller's current gallery. It does not
// consult global CAS existence or create a receipt or a PhotoAsset relationship.
func (s *Server) matchExactMedia(c *gin.Context) {
	c.Header("Cache-Control", "private, no-store")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8192)
	var request struct {
		Probes []exactMediaProbe `json:"probes"`
	}
	if err := c.ShouldBindJSON(&request); err != nil ||
		len(request.Probes) == 0 || len(request.Probes) > maxExactMediaProbes {
		fail(c, http.StatusBadRequest, "invalid media match request")
		return
	}
	for _, probe := range request.Probes {
		if !probe.valid() {
			fail(c, http.StatusBadRequest, "invalid media match probe")
			return
		}
	}
	matches := make([]exactMediaMatch, 0, len(request.Probes))
	for _, probe := range request.Probes {
		match, err := s.findExactMediaMatch(c.Request.Context(), userID(c), probe)
		if err != nil {
			fail(c, http.StatusInternalServerError, "media match unavailable")
			return
		}
		matches = append(matches, match)
	}
	c.JSON(http.StatusOK, gin.H{"matches": matches})
}

func (s *Server) findExactMediaMatch(ctx context.Context, uid uint64, probe exactMediaProbe) (exactMediaMatch, error) {
	query, err := s.mediaItemsBaseQuery(ctx, uid, mediaQueryOptions{}, "")
	if err != nil {
		return exactMediaMatch{}, err
	}
	query = query.Where("pa.kind = ? AND n.owner_id = ? AND n.type = ?", probe.Kind, uid, meta.NodeTypeFile)
	for _, part := range probe.Components {
		resources := s.DB.WithContext(ctx).
			Table("xd_photo_resources AS resource").
			Select("1").
			Joins("JOIN xd_nodes AS resource_node ON resource_node.id = resource.node_id").
			Where("resource.asset_id = pa.id AND resource.role = ? AND resource.sha256 = ? AND resource.size = ?",
				part.Role, part.SHA256, part.Size).
			Where("resource_node.owner_id = ? AND resource_node.deleted_at IS NULL AND resource_node.type = ?", uid, meta.NodeTypeFile)

		original := s.DB.WithContext(ctx).Table("xd_files AS resource_file").Select("1").
			Where("resource_file.node_id = resource_node.id AND resource_file.sha256 = resource.sha256 AND resource_file.size = resource.size")
		if part.Role == meta.PhotoResourceRolePrimary {
			resources = resources.Where("resource.node_id = n.id AND resource.resource_kind = ? AND EXISTS (?)",
				meta.PhotoResourceKindNode, original)
		} else {
			// A derived Live part is current only for its exact container
			// revision. A regular pair uses two current, owned file Nodes.
			derived := s.DB.WithContext(ctx).Table("xd_media_derived_resources AS part").Select("1").
				Where("part.node_id = n.id AND resource_node.id = n.id AND part.owner_id = ? AND part.node_revision = n.revision", uid).
				Where("part.asset_identifier <> '' AND part.asset_identifier = xd_media_metadata.live_photo_asset_identifier").
				Where("part.role = resource.role AND part.sha256 = resource.sha256 AND part.byte_size = resource.size")
			resources = resources.Where(
				"((resource.resource_kind = ? AND EXISTS (?)) OR (resource.resource_kind = ? AND EXISTS (?)))",
				meta.PhotoResourceKindNode, original, meta.PhotoResourceKindDerived, derived,
			)
		}
		query = query.Where("EXISTS (?)", resources)
	}
	var matches []exactMediaMatch
	err = query.Distinct("pa.id AS asset_id", "n.id AS node_id", "n.revision AS revision").
		Limit(2).Scan(&matches).Error
	if err != nil {
		return exactMediaMatch{}, err
	}
	switch len(matches) {
	case 0:
		return exactMediaMatch{State: "unmatched"}, nil
	case 1:
		matches[0].State = "matched"
		return matches[0], nil
	default:
		return exactMediaMatch{State: "ambiguous"}, nil
	}
}
