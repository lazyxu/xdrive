package mediagroup

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestReconcileLocalEvidenceGroupsIsIdempotentAndFailClosed(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "local_media_relations_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.MediaMetadata{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username: "relation-owner", PasswordHash: "unused",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	nodes := []meta.Node{
		{ParentID: &root.ID, Name: "capture.dng", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &root.ID, Name: "rendered.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &root.ID, Name: "edit.xmp", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &root.ID, Name: "burst-a.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
		{ParentID: &root.ID, Name: "burst-b.jpg", Type: meta.NodeTypeFile, OwnerID: owner.ID, Revision: 1},
	}
	if err := db.Create(&nodes).Error; err != nil {
		t.Fatal(err)
	}
	rows := []meta.MediaMetadata{
		{
			NodeID: nodes[0].ID, OwnerID: owner.ID, NodeRevision: 1,
			MediaKind: meta.MediaKindImage, MIMEType: "image/x-adobe-dng",
			IndexState:              meta.MediaIndexStateReady,
			RelationEvidenceVersion: media.RelationEvidenceVersion,
			RelationJSON:            `{"image_unique_id":"capture-1"}`,
		},
		{
			NodeID: nodes[1].ID, OwnerID: owner.ID, NodeRevision: 1,
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			IndexState:              meta.MediaIndexStateReady,
			RelationEvidenceVersion: media.RelationEvidenceVersion,
			RelationJSON:            `{"image_unique_id":"capture-1","xmp_document_id":"xmp.did:rendered"}`,
		},
		{
			NodeID: nodes[2].ID, OwnerID: owner.ID, NodeRevision: 1,
			MediaKind:               meta.MediaKindOther,
			IndexState:              meta.MediaIndexStateUnsupported,
			RelationEvidenceVersion: media.RelationEvidenceVersion,
			RelationJSON:            `{"xmp_derived_from_document_id":"xmp.did:rendered"}`,
		},
		{
			NodeID: nodes[3].ID, OwnerID: owner.ID, NodeRevision: 1,
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			IndexState:              meta.MediaIndexStateReady,
			RelationEvidenceVersion: media.RelationEvidenceVersion,
			RelationJSON:            `{"apple_burst_uuid":"burst-1"}`,
		},
		{
			NodeID: nodes[4].ID, OwnerID: owner.ID, NodeRevision: 1,
			MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
			IndexState:              meta.MediaIndexStateReady,
			RelationEvidenceVersion: media.RelationEvidenceVersion,
			RelationJSON:            `{"apple_burst_uuid":"burst-1"}`,
		},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}

	if err := ReconcileLocalEvidenceGroups(context.Background(), db, owner.ID); err != nil {
		t.Fatal(err)
	}
	var groups []meta.MediaGroup
	if err := db.Where("owner_id = ?", owner.ID).Order("kind ASC").Find(&groups).Error; err != nil {
		t.Fatal(err)
	}
	if len(groups) != 2 {
		t.Fatalf("groups=%+v", groups)
	}
	ids := make(map[string]uint64, len(groups))
	for _, group := range groups {
		ids[group.Kind] = group.ID
	}
	if ids[meta.MediaGroupKindRAWPair] == 0 || ids[meta.MediaGroupKindBurst] == 0 {
		t.Fatalf("group ids=%+v", ids)
	}
	var rawMembers []meta.MediaGroupItem
	if err := db.Where("group_id = ?", ids[meta.MediaGroupKindRAWPair]).
		Order("ordinal ASC").Find(&rawMembers).Error; err != nil {
		t.Fatal(err)
	}
	if len(rawMembers) != 3 ||
		rawMembers[0].NodeID != nodes[1].ID || rawMembers[0].Role != meta.MediaGroupRoleRendered ||
		rawMembers[1].NodeID != nodes[0].ID || rawMembers[1].Role != meta.MediaGroupRoleRAW ||
		rawMembers[2].NodeID != nodes[2].ID || rawMembers[2].Role != meta.MediaGroupRoleSidecar {
		t.Fatalf("raw members=%+v", rawMembers)
	}

	if err := ReconcileLocalEvidenceGroups(context.Background(), db, owner.ID); err != nil {
		t.Fatal(err)
	}
	var again []meta.MediaGroup
	if err := db.Where("owner_id = ?", owner.ID).Find(&again).Error; err != nil {
		t.Fatal(err)
	}
	for _, group := range again {
		if ids[group.Kind] != group.ID {
			t.Fatalf("group id changed for %s: %d -> %d", group.Kind, ids[group.Kind], group.ID)
		}
	}

	duplicate := meta.MediaMetadata{
		NodeID: nodes[3].ID, OwnerID: owner.ID, NodeRevision: 1,
		MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
		IndexState:              meta.MediaIndexStateReady,
		RelationEvidenceVersion: media.RelationEvidenceVersion,
		RelationJSON:            `{"image_unique_id":"capture-1","apple_burst_uuid":"burst-1"}`,
	}
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", nodes[3].ID).
		Updates(map[string]any{
			"relation_json": duplicate.RelationJSON,
		}).Error; err != nil {
		t.Fatal(err)
	}
	if err := ReconcileLocalEvidenceGroups(context.Background(), db, owner.ID); err != nil {
		t.Fatal(err)
	}
	var rawCount int64
	if err := db.Model(&meta.MediaGroup{}).
		Where("owner_id = ? AND kind = ?", owner.ID, meta.MediaGroupKindRAWPair).
		Count(&rawCount).Error; err != nil {
		t.Fatal(err)
	}
	if rawCount != 0 {
		t.Fatalf("ambiguous ImageUniqueID retained %d raw-pair group(s)", rawCount)
	}
}
