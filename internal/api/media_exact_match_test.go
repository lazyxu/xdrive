package api

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestExactMediaMatchRejectsInvalidProbes(t *testing.T) {
	server := &Server{}
	for _, payload := range []string{
		`{}`,
		`{"probes":[{"kind":"image","components":[{"role":"primary","sha256":"bad","size":1}]}]}`,
		`{"probes":[{"kind":"live_photo","components":[{"role":"still","sha256":"` + strings.Repeat("a", 64) + `","size":1}]}]}`,
		`{"probes":[` + strings.Repeat(`{},`, 8) + `{}]}`,
	} {
		ctx, recorder := newDurableJobContext(1, http.MethodPost, "/api/v1/media/exact-match", payload)
		server.matchExactMedia(ctx)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("status=%d for invalid probe", recorder.Code)
		}
	}
}

func TestExactMediaMatchCurrentOwnerAndBothLiveParts(t *testing.T) {
	db := newDurableSelectionJobDB(t)
	if err := db.AutoMigrate(&meta.File{}, &meta.MediaMetadata{}, &meta.PhotoResource{}, &meta.MediaDerivedResource{}); err != nil {
		t.Fatal(err)
	}
	put := func(value any) {
		t.Helper()
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	user := meta.User{Username: "exact-photo-owner", PasswordHash: "test", Role: meta.UserRoleUser}
	other := meta.User{Username: "exact-photo-other", PasswordHash: "test", Role: meta.UserRoleUser}
	put(&user)
	put(&other)
	still := strings.Repeat("a", 64)
	motion := strings.Repeat("b", 64)
	image := func(uid uint64, name string, digest string) meta.Node {
		node := meta.Node{OwnerID: uid, Name: name, Type: meta.NodeTypeFile, Revision: 3}
		put(&node)
		put(&meta.File{NodeID: node.ID, Size: 123, SHA256: digest, StorageKey: name})
		put(&meta.MediaMetadata{NodeID: node.ID, OwnerID: uid, MediaKind: meta.MediaKindImage})
		return node
	}
	asset := func(node meta.Node, kind string) uint64 {
		item := meta.PhotoAsset{OwnerID: node.OwnerID, PrimaryNodeID: node.ID, Kind: kind, EvidenceKey: node.Name}
		put(&item)
		put(&meta.PhotoMetadata{AssetID: item.ID, MediaKind: meta.MediaKindImage})
		return item.ID
	}
	add := func(node meta.Node, kind, digest string) {
		put(&meta.PhotoResource{
			AssetID: asset(node, kind), NodeID: node.ID, ResourceKind: meta.PhotoResourceKindNode,
			Role: meta.PhotoResourceRolePrimary, Size: 123, SHA256: digest,
		})
	}
	one := image(user.ID, "web-import.jpg", still)
	add(one, meta.PhotoAssetKindImage, still)
	add(image(other.ID, "other-owner.jpg", still), meta.PhotoAssetKindImage, still)
	add(image(user.ID, "same-name.jpg", motion), meta.PhotoAssetKindImage, motion)
	server := &Server{DB: db}
	probe := exactMediaProbe{Kind: meta.PhotoAssetKindImage, Components: []exactMediaComponent{
		{Role: meta.PhotoResourceRolePrimary, Size: 123, SHA256: still},
	}}
	check := func(input exactMediaProbe, state string, nodeID uint64) {
		t.Helper()
		out, err := server.findExactMediaMatch(context.Background(), user.ID, input)
		if err != nil || out.State != state || out.NodeID != nodeID {
			t.Fatalf("match %+v err=%v, want %s on node %d", out, err, state, nodeID)
		}
	}
	check(probe, "matched", one.ID)
	duplicate := image(user.ID, "nas-import.jpg", still)
	add(duplicate, meta.PhotoAssetKindImage, still)
	check(probe, "ambiguous", 0)
	if err := db.Model(&duplicate).Update("deleted_at", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	check(probe, "matched", one.ID)
	if err := db.Model(&meta.File{}).Where("node_id = ?", one.ID).Update("sha256", motion).Error; err != nil {
		t.Fatal(err)
	}
	check(probe, "unmatched", 0)

	live := image(user.ID, "live-container.livp", strings.Repeat("c", 64))
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", live.ID).
		Update("live_photo_asset_identifier", "verified-pair").Error; err != nil {
		t.Fatal(err)
	}
	liveID := asset(live, meta.PhotoAssetKindLivePhoto)
	probe = exactMediaProbe{Kind: meta.PhotoAssetKindLivePhoto, Components: []exactMediaComponent{
		{Role: meta.MediaGroupRoleStill, Size: 35, SHA256: still},
		{Role: meta.MediaGroupRoleMotion, Size: 44, SHA256: motion},
	}}
	for _, part := range probe.Components {
		put(&meta.PhotoResource{AssetID: liveID, NodeID: live.ID, ResourceKind: meta.PhotoResourceKindDerived,
			Role: part.Role, Size: part.Size, SHA256: part.SHA256})
		put(&meta.MediaDerivedResource{NodeID: live.ID, NodeRevision: live.Revision, OwnerID: user.ID,
			Role: part.Role, ByteSize: part.Size, SHA256: part.SHA256, AssetIdentifier: "verified-pair"})
	}
	check(probe, "matched", live.ID)
	probe.Components[1].SHA256 = still
	check(probe, "unmatched", 0)
	probe.Components[1].SHA256 = motion
	if err := db.Model(&live).Update("revision", live.Revision+1).Error; err != nil {
		t.Fatal(err)
	}
	check(probe, "unmatched", 0)
}
