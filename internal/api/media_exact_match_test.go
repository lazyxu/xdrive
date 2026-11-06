package api

import (
	"context"
	"encoding/json"
	"fmt"
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
		`{"references":[{"asset_id":1,"node_id":2,"revision":0}]}`,
		`{"probes":[{}],"references":[{"asset_id":1,"node_id":2,"revision":3}]}`,
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
	add := func(node meta.Node, kind, digest string) uint64 {
		id := asset(node, kind)
		put(&meta.PhotoResource{
			AssetID: id, NodeID: node.ID, ResourceKind: meta.PhotoResourceKindNode,
			Role: meta.PhotoResourceRolePrimary, Size: 123, SHA256: digest,
		})
		return id
	}
	one := image(user.ID, "web-import.jpg", still)
	oneID := add(one, meta.PhotoAssetKindImage, still)
	foreign := image(other.ID, "other-owner.jpg", still)
	foreignID := add(foreign, meta.PhotoAssetKindImage, still)
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
	read := func(refs string) []*exactMediaProbe {
		t.Helper()
		ctx, recorder := newDurableJobContext(user.ID, http.MethodPost, "/api/v1/media/exact-match", `{"references":[`+refs+`]}`)
		server.matchExactMedia(ctx)
		var reply struct{ Fingerprints []*exactMediaProbe }
		if recorder.Code != http.StatusOK || json.Unmarshal(recorder.Body.Bytes(), &reply) != nil || len(reply.Fingerprints) == 0 {
			t.Fatalf("fingerprint status %d body %s", recorder.Code, recorder.Body.String())
		}
		return reply.Fingerprints
	}
	ref := func(assetID, nodeID, revision uint64) string {
		return fmt.Sprintf(`{"asset_id":%d,"node_id":%d,"revision":%d}`, assetID, nodeID, revision)
	}
	oneRef := ref(oneID, one.ID, one.Revision)
	fingerprints := read(strings.Join([]string{
		oneRef, ref(foreignID, foreign.ID, foreign.Revision),
		ref(oneID, one.ID, one.Revision+1), ref(foreignID, one.ID, one.Revision),
	}, ","))
	if len(fingerprints) != 4 || fingerprints[0] == nil || fingerprints[0].Kind != probe.Kind ||
		fingerprints[0].Components[0] != probe.Components[0] ||
		fingerprints[1] != nil || fingerprints[2] != nil || fingerprints[3] != nil {
		t.Fatalf("incorrect fingerprint projection: %+v", fingerprints)
	}
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
	if read(oneRef)[0] != nil {
		t.Fatal("stale file hash was exposed")
	}

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
	liveRef := ref(liveID, live.ID, live.Revision)
	liveFingerprint := read(liveRef)[0]
	if liveFingerprint == nil || liveFingerprint.Kind != probe.Kind ||
		len(liveFingerprint.Components) != 2 ||
		liveFingerprint.Components[0] != probe.Components[0] ||
		liveFingerprint.Components[1] != probe.Components[1] {
		t.Fatalf("incorrect Live fingerprint %+v", liveFingerprint)
	}
	probe.Components[1].SHA256 = still
	check(probe, "unmatched", 0)
	probe.Components[1].SHA256 = motion
	if err := db.Model(&live).Update("revision", live.Revision+1).Error; err != nil {
		t.Fatal(err)
	}
	check(probe, "unmatched", 0)
	if read(ref(liveID, live.ID, live.Revision+1))[0] != nil {
		t.Fatal("stale Live derivative was exposed at new Node revision")
	}
}
