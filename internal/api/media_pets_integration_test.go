package api

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMediaPetFacetsAndItems(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	baseSQLDB, err := baseDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer baseSQLDB.Close()

	schema := "media_pets_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()

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
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()

	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{},
		&meta.MediaMetadata{}, &meta.MediaGroup{}, &meta.MediaGroupItem{},
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoAnalysisState{}, &meta.PhotoVisualLabel{},
	); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{
		Username:       "pets-" + uuid.NewString(),
		PasswordHash:   "unused",
		Role:           meta.UserRoleUser,
		SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}

	add := func(name string, labelIndex int, confidence float64) uint64 {
		t.Helper()
		node := meta.Node{
			ParentID: &root.ID, Name: name, Type: meta.NodeTypeFile,
			OwnerID: owner.ID, Revision: 1,
		}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		file := meta.File{
			NodeID: node.ID, Size: 100,
			StorageKey: "pet-" + name,
			SHA256:     fmt.Sprintf("%064x", node.ID),
		}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.MediaMetadata{
			NodeID: node.ID, OwnerID: owner.ID, NodeRevision: 1,
			SHA256: file.SHA256, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", IndexState: meta.MediaIndexStateReady,
		}).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: owner.ID, PrimaryNodeID: node.ID,
			Kind:        meta.PhotoAssetKindImage,
			EvidenceKey: "pet:" + name,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg",
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{
			AssetID: asset.ID, ResourceKind: meta.PhotoResourceKindNode,
			NodeID: node.ID, Role: meta.PhotoResourceRolePrimary,
			Name: name, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Size: file.Size, SHA256: file.SHA256,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoAnalysisState{
			AssetID: asset.ID, Kind: meta.PhotoAnalysisKindVisualLabel,
			AnalyzerVersion: "visual-v2", InputFingerprint: "input:" + name,
			State: meta.PhotoAnalysisStateReady,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoVisualLabel{
			AssetID:    asset.ID,
			Label:      name,
			LabelIndex: labelIndex,
			Confidence: confidence,
		}).Error; err != nil {
			t.Fatal(err)
		}
		return node.ID
	}

	dogID := add("golden-retriever", 207, 0.92)
	catID := add("tabby-cat", 281, 0.88)
	_ = add("low-confidence-dog", 151, 0.05)
	_ = add("non-pet", 0, 0.99)

	facets, err := queryMediaPetFacets(
		context.Background(), db, owner.ID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(facets) != 2 {
		t.Fatalf("pet facets=%+v", facets)
	}
	counts := map[string]int64{}
	for _, facet := range facets {
		counts[facet.ID] = facet.ItemCount
		if facet.CoverNodeID == nil {
			t.Fatalf("pet facet has no cover: %+v", facet)
		}
	}
	if counts[mediaPetKindDog] != 1 || counts[mediaPetKindCat] != 1 {
		t.Fatalf("pet counts=%v facets=%+v", counts, facets)
	}

	server := &Server{DB: db}
	for kind, wantNodeID := range map[string]uint64{
		mediaPetKindDog: dogID,
		mediaPetKindCat: catID,
	} {
		query, err := server.mediaItemsBaseQuery(
			context.Background(), owner.ID, mediaQueryOptions{}, "",
		)
		if err != nil {
			t.Fatal(err)
		}
		query, err = applyMediaPetFilter(query, kind)
		if err != nil {
			t.Fatal(err)
		}
		items, err := server.materializeMediaItems(
			context.Background(), owner.ID, query, 100, 0,
		)
		if err != nil {
			t.Fatal(err)
		}
		if len(items) != 1 || items[0].Node.ID != wantNodeID {
			t.Fatalf("pet %s items=%+v want node=%d", kind, items, wantNodeID)
		}
	}
}

func TestMediaPetLabelRanges(t *testing.T) {
	for _, tc := range []struct {
		kind string
		min  int
		max  int
	}{
		{kind: mediaPetKindDog, min: 151, max: 268},
		{kind: mediaPetKindCat, min: 281, max: 285},
	} {
		min, max, ok := mediaPetLabelRange(tc.kind)
		if !ok || min != tc.min || max != tc.max {
			t.Fatalf("%s range=%d..%d ok=%v", tc.kind, min, max, ok)
		}
	}
	if _, _, ok := mediaPetLabelRange("rabbit"); ok {
		t.Fatal("unsupported pet kind was accepted")
	}
}
