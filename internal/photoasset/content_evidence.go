package photoasset

import "fmt"

// Alias is a compile-time owning query alias, never user input. Check current
// file bindings at read time as well as during reconciliation: async index work
// must not expose a replacement file under the previous photo's content key.
func CurrentContentBindingSQL(asset string) string {
	return fmt.Sprintf(`(%[1]s.content_key = '' OR (
	 EXISTS (SELECT 1 FROM xd_photo_resources cc_r WHERE cc_r.asset_id = %[1]s.id AND cc_r.node_id = %[1]s.primary_node_id)
	 AND NOT EXISTS (
	  SELECT 1 FROM xd_photo_resources cc_r
	  LEFT JOIN xd_nodes cc_n ON cc_n.id = cc_r.node_id
	  LEFT JOIN xd_files cc_f ON cc_f.node_id = cc_n.id
	  WHERE cc_r.asset_id = %[1]s.id AND (
	   cc_n.id IS NULL OR cc_n.owner_id <> %[1]s.owner_id OR cc_n.deleted_at IS NOT NULL
	   OR cc_f.node_id IS NULL OR COALESCE(cc_r.sha256, '') = '' OR cc_f.sha256 IS NULL OR cc_f.sha256 <> cc_r.sha256
	   OR (cc_r.resource_kind = 'node' AND cc_f.size <> cc_r.size)
	   OR (cc_r.resource_kind = 'derived' AND (cc_r.byte_offset < 0 OR cc_r.size <= 0 OR cc_r.byte_offset > cc_f.size - cc_r.size))
	  )
	 )
	))`, asset)
}

func CurrentOccurrenceBindingSQL(occurrence string) string {
	return fmt.Sprintf(`%[1]s.active AND jsonb_array_length(%[1]s.resources_json::jsonb) > 0 AND NOT EXISTS (
	 SELECT 1 FROM jsonb_array_elements(%[1]s.resources_json::jsonb) cc_r
	 LEFT JOIN xd_nodes cc_n ON cc_n.id = (cc_r->>'node_id')::bigint
	 LEFT JOIN xd_files cc_f ON cc_f.node_id = cc_n.id
	 WHERE cc_n.id IS NULL OR cc_n.owner_id <> %[1]s.owner_id OR cc_n.deleted_at IS NOT NULL
	 OR cc_f.node_id IS NULL OR COALESCE(cc_r->>'sha256', '') = '' OR cc_f.sha256 IS NULL OR cc_f.sha256 <> (cc_r->>'sha256')
	 OR COALESCE(cc_r->>'kind', '') NOT IN ('node', 'derived') OR cc_r->>'size' IS NULL
	 OR ((cc_r->>'kind') = 'node' AND cc_f.size <> (cc_r->>'size')::bigint)
	 OR ((cc_r->>'kind') = 'derived' AND ((cc_r->>'offset') IS NULL OR (cc_r->>'offset')::bigint < 0 OR (cc_r->>'size')::bigint <= 0 OR (cc_r->>'offset')::bigint > cc_f.size - (cc_r->>'size')::bigint))
	)`, occurrence)
}
