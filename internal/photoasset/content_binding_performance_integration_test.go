package photoasset

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

// Same data / same PostgreSQL runner, three alternating legacy/current pairs.
// Measures the integrity predicate cost, not model or end-to-end UI performance.
func TestPhotoContentBindingPerformance100K(t *testing.T) {
	if os.Getenv("XD_PHOTO_CONTENT_PERF") != "1" {
		t.Skip("XD_PHOTO_CONTENT_PERF is not enabled")
	}
	db := contentIdentityTestDB(t)
	owner := meta.User{Username: "content-perf", PasswordHash: "unused", Role: meta.UserRoleUser}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	statements := []string{
		`INSERT INTO xd_nodes(name,type,owner_id,revision,created_at,updated_at) SELECT 'p-'||gs::text||'.jpg','file',%d,1,NOW(),NOW() FROM generate_series(1,100000) gs`,
		`INSERT INTO xd_files(node_id,size,storage_key,sha256) SELECT id,100,'fixture/'||id::text,lpad(to_hex(id),64,'0') FROM xd_nodes WHERE owner_id=%d`,
		`INSERT INTO xd_photo_assets(owner_id,primary_node_id,kind,evidence_key,content_key,content_manifest,created_at,updated_at)
   SELECT n.owner_id,n.id,'image','sha256:'||f.sha256,'sha256:'||f.sha256,
   jsonb_build_object('version',1,'kind','image','originals',jsonb_build_array(jsonb_build_object('role','primary','sha256',f.sha256,'size',100,'ordinal',0)))::text,NOW(),NOW()
   FROM xd_nodes n JOIN xd_files f ON f.node_id=n.id WHERE n.owner_id=%d`,
		`INSERT INTO xd_photo_resources(asset_id,resource_kind,node_id,role,name,media_kind,size,sha256)
   SELECT pa.id,'node',n.id,'primary',n.name,'image',f.size,f.sha256 FROM xd_photo_assets pa JOIN xd_nodes n ON n.id=pa.primary_node_id JOIN xd_files f ON f.node_id=n.id WHERE pa.owner_id=%d`,
	}
	for _, sql := range statements {
		if err := db.Exec(fmt.Sprintf(sql, owner.ID)).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, table := range []string{"xd_nodes", "xd_files", "xd_photo_assets", "xd_photo_resources"} {
		if err := db.Exec("ANALYZE " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	base := ` FROM xd_photo_assets pa JOIN xd_nodes n ON n.id=pa.primary_node_id AND n.owner_id=pa.owner_id AND n.deleted_at IS NULL WHERE pa.owner_id=?`
	for i := 0; i < 3; i++ {
		for _, variant := range []string{"legacy", "content-before-case", "content"} {
			where := base
			if variant != "legacy" {
				predicate := CurrentContentBindingSQL("pa")
				if variant == "content-before-case" {
					predicate = strings.Replace(predicate, "(CASE WHEN pa.content_key = '' THEN TRUE ELSE (", "(pa.content_key = '' OR (", 1)
					predicate = strings.Replace(predicate, ") END)", "))", 1)
				}
				where += " AND " + predicate
			}
			start := time.Now()
			var count int64
			if err := db.Raw("SELECT COUNT(*)"+where, owner.ID).Scan(&count).Error; err != nil {
				t.Fatal(err)
			}
			countMS := float64(time.Since(start).Microseconds()) / 1000
			if count != 100000 {
				t.Fatalf("unexpected count %d", count)
			}
			start = time.Now()
			var ids []uint64
			if err := db.Raw("SELECT pa.id"+where+" ORDER BY pa.id LIMIT 50", owner.ID).Scan(&ids).Error; err != nil {
				t.Fatal(err)
			}
			if len(ids) != 50 {
				t.Fatalf("unbounded/wrong page %d", len(ids))
			}
			t.Logf("sample=%d variant=%s count_ms=%.3f page50_ms=%.3f", i+1, variant, countMS, float64(time.Since(start).Microseconds())/1000)
		}
	}
	rows, err := db.Raw("EXPLAIN (ANALYZE, BUFFERS) SELECT pa.id"+base+" AND "+CurrentContentBindingSQL("pa")+" ORDER BY pa.id LIMIT 50", owner.ID).Rows()
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		t.Log(line)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
}
