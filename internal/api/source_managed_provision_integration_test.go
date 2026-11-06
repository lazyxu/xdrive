package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// The public Synology Pull create endpoint is disabled, but retain database-
// level target provisioner tests to avoid discarding the future connector's
// exclusive target and Source/Node transaction safety rules.
func TestDormantSynologyPullProvisionerPreservesExclusiveTargets(t *testing.T) {
	db, srv, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name
		ON xd_nodes(owner_id, parent_id, lower(name))
		WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_sources_owner_name
		ON xd_sources(owner_id, lower(name))`).Error; err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	srv.Auth = auth.New("dormant-synology-provision", time.Hour)
	router := srv.Router()
	token, err := srv.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	ordinary := createFilePropertiesDir(t, db, owner.ID, root.ID, "用户普通目录")
	// Keep both future connector kinds discoverable only as historical rows.
	for _, kind := range []string{"synology_files", "synology_photos"} {
		body := fmt.Sprintf(`{"name":"new-%s","kind":%q,"direction":"pull"}`, kind, kind)
		request(t, router, http.MethodPost, "/api/v1/sources", token,
			strings.NewReader(body), http.StatusGone)
	}
	createInTx := func(name, kind string) (meta.Source, meta.Node, error) {
		source := meta.Source{
			OwnerID: owner.ID, Name: name, Kind: kind,
			Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
			RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused, Revision: 1,
		}
		var node meta.Node
		err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(&source).Error; err != nil {
				return err
			}
			var err error
			node, err = createSynologyPullManagedTargetTx(context.Background(), tx, source)
			if err != nil {
				return err
			}
			return tx.Model(&meta.Source{}).
				Where("id = ? AND owner_id = ?", source.ID, owner.ID).
				Updates(map[string]any{"target_node_id": node.ID, "target_managed": true}).Error
		})
		return source, node, err
	}
	filesSource, filesTarget, err := createInTx("我的文档", "synology_files")
	if err != nil {
		t.Fatal(err)
	}
	photosSource, photosTarget, err := createInTx("照片备份", "synology_photos")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		source meta.Source
		node meta.Node
		want string
	}{
		{filesSource, filesTarget, "同步文件夹/Pull/Synology Files/我的文档"},
		{photosSource, photosTarget, "同步文件夹/Pull/Synology Photos/照片备份"},
	} {
		var stored meta.Source
		if err := db.First(&stored, entry.source.ID).Error; err != nil {
			t.Fatal(err)
		}
		if !stored.TargetManaged || stored.TargetNodeID == nil ||
			*stored.TargetNodeID != entry.node.ID {
			t.Fatalf("dormant provisioner lost Source-Node identity: %+v", stored)
		}
		if path, err := srv.logicalPath(entry.node); err != nil || path != entry.want {
			t.Fatalf("dormant provisioner target path=%q err=%v want=%q", path, err, entry.want)
		}
	}
	var stillOrdinary meta.Node
	if err := db.First(&stillOrdinary, ordinary.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stillOrdinary.Name != ordinary.Name || stillOrdinary.Revision != ordinary.Revision ||
		stillOrdinary.ParentID == nil || *stillOrdinary.ParentID != root.ID {
		t.Fatalf("future provisioner adopted old user folder: %+v", stillOrdinary)
	}

	occupied := createFilePropertiesDir(t, db, owner.ID, *filesTarget.ParentID, "占用")
	_, _, err = createInTx("占用", "synology_files")
	if !errors.Is(err, errSourceManagedDirectoryOccupied) {
		t.Fatalf("provisioner overwrote occupied directory: %v", err)
	}
	var existing meta.Node
	if err := db.First(&existing, occupied.ID).Error; err != nil {
		t.Fatal(err)
	}
	if existing.ParentID == nil || *existing.ParentID != *filesTarget.ParentID ||
		existing.Revision != occupied.Revision {
		t.Fatal("occupied directory mutated after failed provisioning")
	}
	var rolledBack int64
	if err := db.Model(&meta.Source{}).Where("owner_id = ? AND name = ?",
		owner.ID, "占用").Count(&rolledBack).Error; err != nil {
		t.Fatal(err)
	}
	if rolledBack != 0 {
		t.Fatal("failed dormant provisioner left an orphan Source")
	}

	connectorID := *filesTarget.ParentID
	legacy := meta.Source{
		OwnerID: owner.ID, Name: "旧占用上级", Kind: "test",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusPaused,
		Revision: 1, TargetNodeID: &connectorID,
	}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	_, _, err = createInTx("不能嵌套", "synology_files")
	if !errors.Is(err, errSourceManagedAncestorInUse) {
		t.Fatalf("legacy ancestor Source failed to fence overlapping target: %v", err)
	}
}

func TestDormantSynologyPullTargetCollisionRollsBackEntireTransaction(t *testing.T) {
	db, _, owner, _, root := setupFilePropertiesTestDB(t)
	existing := createFilePropertiesFile(t, db, owner.ID, root.ID, yikeTargetRootName, 1)
	source := meta.Source{
		OwnerID: owner.ID, Name: "拉取1", Kind: "synology_files",
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeSync, Status: meta.SourceStatusPaused, Revision: 1,
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&source).Error; err != nil {
			return err
		}
		_, err := createSynologyPullManagedTargetTx(context.Background(), tx, source)
		return err
	})
	if !errors.Is(err, errSourceManagedDirectoryOccupied) {
		t.Fatalf("occupied canonical parent accepted: %v", err)
	}
	var count int64
	if err := db.Model(&meta.Source{}).Where("owner_id = ?", owner.ID).
		Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("failed provisioner created %d Source rows", count)
	}
	var unchanged meta.Node
	if err := db.First(&unchanged, existing.ID).Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.Type != meta.NodeTypeFile || unchanged.Name != yikeTargetRootName ||
		unchanged.Revision != existing.Revision {
		t.Fatalf("failed provider creation changed occupied Node: %+v", unchanged)
	}
}
