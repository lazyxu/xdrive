package api

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photoasset"
)

func TestMediaContentMapRangeRechecksOriginalAndOwner(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL required")
	}
	db := openPhotoIntelligenceAPITestDB(t, dsn)
	if err := db.AutoMigrate(&meta.File{}, &meta.MediaMetadata{}, &meta.PhotoResource{}, &meta.PhotoMetadata{}, &meta.BaiduPhotoMapPosition{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "content-map-owner", PasswordHash: "unused", Role: meta.UserRoleUser}
	foreign := meta.User{Username: "content-map-foreign", PasswordHash: "unused", Role: meta.UserRoleUser}
	for _, user := range []*meta.User{&owner, &foreign} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	sha := strings.Repeat("a", 64)
	identity, err := photoasset.IdentifyOriginals(meta.PhotoAssetKindImage, []photoasset.OriginalResource{{Role: "primary", SHA256: sha, Size: 123}})
	if err != nil {
		t.Fatal(err)
	}
	var ownNode meta.Node
	for _, user := range []meta.User{owner, foreign} {
		node := meta.Node{OwnerID: user.ID, Name: "original.jpg", Type: meta.NodeTypeFile, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{NodeID: node.ID, SHA256: sha, Size: 123}).Error; err != nil {
			t.Fatal(err)
		}
		lat, lng := 30.0, 120.0
		metadata := meta.MediaMetadata{NodeID: node.ID, OwnerID: user.ID, NodeRevision: 1, MediaKind: meta.MediaKindImage, IndexState: meta.MediaIndexStateReady, Latitude: &lat, Longitude: &lng}
		if err := db.Create(&metadata).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{OwnerID: user.ID, PrimaryNodeID: node.ID, Kind: meta.PhotoAssetKindImage, ContentKey: identity.Key, ContentManifest: identity.Manifest, EvidenceKey: "content-map"}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{AssetID: asset.ID, NodeID: node.ID, Role: "primary", ResourceKind: "node", SHA256: sha, Size: 123}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{AssetID: asset.ID, MediaKind: meta.MediaKindImage}).Error; err != nil {
			t.Fatal(err)
		}
		position := meta.BaiduPhotoMapPosition{AssetID: asset.ID, OwnerID: user.ID, PrimaryNodeID: node.ID, NodeRevision: 1, MediaUpdatedAt: metadata.UpdatedAt, SourceLatitude: lat, SourceLongitude: lng, Latitude: 30.01, Longitude: 120.01, CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL, ProjectionVersion: meta.BaiduPhotoMapProjectionGeoconvV2}
		if err := db.Create(&position).Error; err != nil {
			t.Fatal(err)
		}
		if user.ID == owner.ID {
			ownNode = node
		}
	}
	bounds := baiduPhotoMapBounds{West: 119, East: 121, South: 29, North: 31, CoordinateSpace: meta.BaiduPhotoMapSpaceBD09LL}
	check := func(want int) {
		t.Helper()
		query, err := (&Server{DB: db}).mediaItemsBaseQuery(context.Background(), owner.ID, mediaQueryOptions{BaiduViewport: &bounds}, "")
		if err != nil {
			t.Fatal(err)
		}
		var ids []uint64
		if err := query.Order("n.id").Limit(48).Pluck("n.id", &ids).Error; err != nil {
			t.Fatal(err)
		}
		if len(ids) != want || (want == 1 && ids[0] != ownNode.ID) {
			t.Fatalf("current Owner content membership: %v, want %d", ids, want)
		}
	}
	check(1)
	// Even before a Node revision/index update, replacing bytes must hide the
	// old content identity. Another Owner's identical original cannot rescue it.
	if err := db.Model(&meta.File{}).Where("node_id = ?", ownNode.ID).Update("sha256", strings.Repeat("b", 64)).Error; err != nil {
		t.Fatal(err)
	}
	check(0)
	if err := db.Model(&meta.File{}).Where("node_id = ?", ownNode.ID).Update("sha256", sha).Error; err != nil {
		t.Fatal(err)
	}
	check(1)
	if err := db.Model(&meta.Node{}).Where("id = ?", ownNode.ID).Update("revision", 2).Error; err != nil {
		t.Fatal(err)
	}
	check(0)
	if err := db.Model(&meta.Node{}).Where("id = ?", ownNode.ID).Update("revision", 1).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).Update("must_change_password", true).Error; err != nil {
		t.Fatal(err)
	}
	check(0)
}
