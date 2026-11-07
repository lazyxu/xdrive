package photointelligence

import (
	"fmt"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/photoasset"
)

// Aliases are fixed by the owning SQL queries, never supplied by an API caller.
// A ready model row alone is insufficient: its pixels must still be the current
// accessible image. Reuse this predicate for clustering and every suggestion read.
func CurrentFaceEvidenceSQL(face, asset string) string {
	fingerprint := fmt.Sprintf(`CASE WHEN COALESCE(trim(cf_file.sha256), '') <> ''
  THEN 'media-analysis-' || lower(trim(cf_file.sha256)) || '-v%d-%d'
  ELSE 'media-analysis-node-' || cf_node.id::text || '-' || cf_node.revision::text || '-v%d-%d' END`,
		mediapkg.AnalysisPreviewVersion, mediapkg.AnalysisPreviewEdge,
		mediapkg.AnalysisPreviewVersion, mediapkg.AnalysisPreviewEdge)
	fingerprint = faceContentFingerprintSQL(asset, fingerprint)
	return photoasset.CurrentContentBindingSQL(asset) + " AND " + fmt.Sprintf(`EXISTS (
  SELECT 1 FROM xd_nodes AS cf_node
  JOIN xd_files AS cf_file ON cf_file.node_id = cf_node.id
  JOIN xd_media_metadata AS cf_media ON cf_media.node_id = cf_node.id
  JOIN xd_photo_analysis_states AS cf_detection ON cf_detection.asset_id = %[2]s.id AND cf_detection.kind = 'face_detection'
  JOIN xd_photo_analysis_states AS cf_embedding ON cf_embedding.asset_id = %[2]s.id AND cf_embedding.kind = 'face_embedding'
  WHERE cf_node.id = %[2]s.primary_node_id AND cf_node.owner_id = %[2]s.owner_id AND cf_node.deleted_at IS NULL
  AND cf_media.owner_id = %[2]s.owner_id AND cf_media.node_revision = cf_node.revision
  AND cf_media.sha256 = cf_file.sha256 AND cf_media.media_kind = 'image' AND cf_media.index_state = 'ready'
  AND cf_detection.state = 'ready' AND cf_detection.analyzer_version = %[1]s.analyzer_version
  AND cf_embedding.state = 'ready' AND cf_embedding.analyzer_version = %[1]s.embedding_version
  AND cf_detection.input_fingerprint = (%[3]s) AND cf_embedding.input_fingerprint = (%[3]s)
 )`, face, asset, fingerprint)
}

// Hide an entire stale automatic suggestion until it has been rebuilt. Saved
// user-confirmed people are independent durable memberships and are not deleted.
func CurrentPersonClusterEvidenceSQL(cluster string) string {
	return fmt.Sprintf(`(
  (SELECT COUNT(DISTINCT cpc_face.asset_id) FROM xd_photo_person_cluster_faces AS cpc_member
   JOIN xd_photo_faces AS cpc_face ON cpc_face.id = cpc_member.face_id WHERE cpc_member.cluster_id = %[1]s.id) >= 2
  AND NOT EXISTS (
   SELECT 1 FROM xd_photo_person_cluster_faces AS cpc_member
   LEFT JOIN xd_photo_faces AS cpc_face ON cpc_face.id = cpc_member.face_id
   LEFT JOIN xd_photo_assets AS cpc_asset ON cpc_asset.id = cpc_face.asset_id
   WHERE cpc_member.cluster_id = %[1]s.id AND (
    cpc_face.id IS NULL OR cpc_asset.id IS NULL OR cpc_asset.owner_id <> %[1]s.owner_id
    OR cpc_face.embedding_version <> %[1]s.embedding_version OR NOT (%[2]s)
   )
  )
 )`, cluster, CurrentFaceEvidenceSQL("cpc_face", "cpc_asset"))
}
