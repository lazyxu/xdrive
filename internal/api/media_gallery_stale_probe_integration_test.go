package api

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
)

// The first-screen existence query must return the SAME decision as the
// canonical ordered worker query. The only optimization is no sort/Node DTO.
func TestGalleryStaleExistenceProbeMatchesOrderedOwnerQuery(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	db := fileExplorerMediaPerfDatabase(t, dsn)
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.MediaMetadata{},
	); err != nil {
		t.Fatal(err)
	}
	owners := []meta.User{
		{Username: "gallery-probe-a", PasswordHash: "unused", Role: meta.UserRoleUser},
		{Username: "gallery-probe-b", PasswordHash: "unused", Role: meta.UserRoleUser},
	}
	if err := db.Create(&owners).Error; err != nil {
		t.Fatal(err)
	}
	const shaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	const shaB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	create := func(ownerID uint64, name string, withMetadata bool) uint64 {
		t.Helper()
		node := meta.Node{OwnerID: ownerID, Type: meta.NodeTypeFile, Name: name, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		file := meta.File{NodeID: node.ID, SHA256: shaA, Size: 12, StorageKey: "fixture"}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		if withMetadata {
			md := meta.MediaMetadata{
				NodeID: node.ID, OwnerID: ownerID, NodeRevision: 1, SHA256: shaA,
				MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg",
				IndexState: meta.MediaIndexStateReady,
				RelationEvidenceVersion: mediapkg.RelationEvidenceVersion,
				DerivedResourceVersion: mediapkg.LIVPDerivedResourceVersion,
				ContainerKind: "ready",
			}
			if err := db.Create(&md).Error; err != nil {
				t.Fatal(err)
			}
		}
		return node.ID
	}
	server := &Server{DB: db}
	ctx := context.Background()
	check := func(ownerID uint64, want bool) {
		t.Helper()
		got, err := server.galleryHasStaleMedia(ctx, ownerID)
		if err != nil {
			t.Fatal(err)
		}
		before, err := server.staleMediaNodes(ctx, &ownerID, 1)
		if err != nil {
			t.Fatal(err)
		}
		old := len(before) != 0
		if got != old || got != want {
			t.Fatalf("owner %d: new=%t old=%t want=%t", ownerID, got, old, want)
		}
	}
	a := owners[0].ID
	b := owners[1].ID
	aNode := create(a, "a.jpg", true)
	bNode := create(b, "b.jpg", true)
	check(a, false)
	check(b, false)

	// A changed or missing B record must never mark A's clean library stale.
	if err := db.Delete(&meta.MediaMetadata{}, "node_id = ?", bNode).Error; err != nil {
		t.Fatal(err)
	}
	check(a, false)
	check(b, true)
	if err := db.Model(&meta.Node{}).Where("id = ?", bNode).
		Update("deleted_at", time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	check(b, false) // deleted nodes are not eligible stale media

	missing := create(a, "missing.jpg", false)
	check(a, true)
	if err := db.Model(&meta.Node{}).Where("id = ?", missing).
		Update("deleted_at", time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	check(a, false)

	if err := db.Model(&meta.Node{}).Where("id = ?", aNode).
		Update("revision", 2).Error; err != nil {
		t.Fatal(err)
	}
	check(a, true)
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", aNode).
		Update("node_revision", 2).Error; err != nil {
		t.Fatal(err)
	}
	check(a, false)

	if err := db.Model(&meta.File{}).Where("node_id = ?", aNode).
		Update("sha256", shaB).Error; err != nil {
		t.Fatal(err)
	}
	check(a, true)
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", aNode).
		Update("sha256", shaB).Error; err != nil {
		t.Fatal(err)
	}
	check(a, false)

	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", aNode).
		Update("relation_evidence_version", 0).Error; err != nil {
		t.Fatal(err)
	}
	check(a, true)
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", aNode).
		Update("relation_evidence_version", mediapkg.RelationEvidenceVersion).Error; err != nil {
		t.Fatal(err)
	}
	check(a, false)

	// Keep both the .livp suffix and native iOS Live ZIP recognition intact.
	for _, name := range []string{
		"original.livp",
		"live-xios-" + strings.Repeat("a", 24) + "-" + strings.Repeat("b", 12) + ".zip",
	} {
		if err := db.Model(&meta.Node{}).Where("id = ?", aNode).
			Update("name", name).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", aNode).
			Updates(map[string]interface{}{"container_kind": "", "derived_resource_version": 0}).Error; err != nil {
			t.Fatal(err)
		}
		check(a, true)
		if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", aNode).
			Updates(map[string]interface{}{
				"container_kind": "verified", "derived_resource_version": mediapkg.LIVPDerivedResourceVersion,
			}).Error; err != nil {
			t.Fatal(err)
		}
		check(a, false)
	}

	// Do not turn an interrupted SQL probe into a falsely clean Owner result.
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	_, err := server.galleryHasStaleMedia(cancelled, a)
	if err == nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled probe must propagate cancellation, got %v", err)
	}

	// The optimized existence path does not introduce a TTL; a new file must
	// become visible to the next authoritative first read without a restart.
	unindexed := create(a, "just-imported.jpg", false)
	check(a, true)
	deleted := time.Now().UTC()
	if err := db.Model(&meta.Node{}).Where("id = ?", unindexed).
		Update("deleted_at", deleted).Error; err != nil {
		t.Fatal(err)
	}
	check(a, false)
}
