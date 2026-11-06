package api

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"net/http"
	"strings"
	"testing"
	"time"

	mediapkg "github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
	"github.com/lazyxu/xdrive/internal/storage"
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
		Updates(map[string]any{"live_photo_asset_identifier": "verified-pair", "container_json": fmt.Sprintf(`{"still":{"sha256":"%s"},"motion":{"sha256":"%s"}}`, still, motion), "sha256": strings.Repeat("c", 64), "node_revision": live.Revision, "container_kind": "livp", "index_state": meta.MediaIndexStateReady, "derived_resource_version": mediapkg.LIVPDerivedResourceVersion}).Error; err != nil {
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
			Role: part.Role, ByteSize: part.Size, SHA256: strings.Repeat("c", 64), AssetIdentifier: "verified-pair"})
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

	// Same-range replacement must not reuse an older PhotoResource digest.
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", live.ID).
		Update("container_json", fmt.Sprintf(`{"still":{"sha256":"%s"},"motion":{"sha256":"%s"}}`, motion, motion)).Error; err != nil {
		t.Fatal(err)
	}
	check(probe, "unmatched", 0)
	if read(liveRef)[0] != nil {
		t.Fatal("current descriptor accepted a stale projected member hash")
	}
	if err := db.Model(&meta.MediaMetadata{}).Where("node_id = ?", live.ID).
		Update("container_json", fmt.Sprintf(`{"still":{"sha256":"%s"},"motion":{"sha256":"%s"}}`, still, motion)).Error; err != nil {
		t.Fatal(err)
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

func TestExactMediaMatchRealIOSLiveArchive(t *testing.T) {
	db := newDurableSelectionJobDB(t)
	if err := db.AutoMigrate(&meta.File{}, &meta.MediaMetadata{}, &meta.MediaDerivedResource{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{}, &meta.PhotoResource{}, &meta.PhotoCollection{},
		&meta.PhotoCollectionAsset{}, &meta.Source{}, &meta.SourceItem{}, &meta.SourceCollection{}, &meta.SourceCollectionItem{}); err != nil {
		t.Fatal(err)
	}
	user := meta.User{Username: "real-live-owner", PasswordHash: "unused", Role: meta.UserRoleUser}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: db, Store: store}
	livp, still, motion := testLIVPResourceArchive(t, "E994E717-E3B4-47BC-B808-A57865FE837C")
	var manifestParts []map[string]any
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	for i, part := range [][]byte{still, motion} {
		role, path := "still", "media/still.jpg"
		if i == 1 {
			role, path = "motion", "media/motion.mov"
		}
		entry, err := writer.CreateHeader(&zip.FileHeader{Name: path, Method: zip.Store})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write(part); err != nil {
			t.Fatal(err)
		}
		manifestParts = append(manifestParts, map[string]any{"role": role, "path": path, "originalFilename": path,
			"bytes": len(part), "crc32": fmt.Sprintf("%08x", crc32.ChecksumIEEE(part))})
	}
	manifest, _ := json.Marshal(map[string]any{"format": "xdrive-live-originals", "version": 1, "resources": manifestParts})
	entry, err := writer.CreateHeader(&zip.FileHeader{Name: "manifest.json", Method: zip.Store})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = entry.Write(manifest); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	probe := exactMediaProbe{Kind: meta.PhotoAssetKindLivePhoto, Components: []exactMediaComponent{
		{Role: "still", Size: int64(len(still)), SHA256: fmt.Sprintf("%x", sha256.Sum256(still))},
		{Role: "motion", Size: int64(len(motion)), SHA256: fmt.Sprintf("%x", sha256.Sum256(motion))},
	}}
	for i, content := range [][]byte{archive.Bytes(), livp} {
		name := "Live-xios-0123456789abcdef01234567-0123456789ab.zip"
		if i == 1 {
			name = "same-originals.livp"
		}
		node := meta.Node{OwnerID: user.ID, Name: name, Type: meta.NodeTypeFile, Revision: 1}
		if err = db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		file := meta.File{NodeID: node.ID, Size: int64(len(content)), SHA256: fmt.Sprintf("%x", sha256.Sum256(content)), StorageKey: name}
		if _, err = store.Put(context.Background(), name, bytes.NewReader(content)); err != nil {
			t.Fatal(err)
		}
		if err = db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		node.File = &file
		if _, err = server.indexMediaNode(context.Background(), node); err != nil {
			t.Fatal(err)
		}
		if _, err = photoasset.ReconcileOwner(context.Background(), db, user.ID); err != nil {
			t.Fatal(err)
		}
		match, err := server.findExactMediaMatch(context.Background(), user.ID, probe)
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			if match.State != "matched" || match.NodeID != node.ID {
				t.Fatalf("real iOS ZIP failed exact match: %+v", match)
			}
			ref := exactMediaReference{AssetID: match.AssetID, NodeID: match.NodeID, Revision: match.Revision}
			actual, err := server.exactMediaFingerprint(context.Background(), user.ID, ref)
			if err != nil || actual == nil || len(actual.Components) != 2 || actual.Components[0] != probe.Components[0] || actual.Components[1] != probe.Components[1] {
				t.Fatalf("reverse real bytes: %+v %v", actual, err)
			}
			bad := probe
			bad.Components = append([]exactMediaComponent(nil), probe.Components...)
			bad.Components[0].SHA256 = file.SHA256
			rejected, err := server.findExactMediaMatch(context.Background(), user.ID, bad)
			if err != nil || rejected.State != "unmatched" {
				t.Fatal("outer archive digest accepted as still digest")
			}
		} else if match.State != "ambiguous" {
			t.Fatalf("two different container formats must remain ambiguous: %+v", match)
		}
	}
}
