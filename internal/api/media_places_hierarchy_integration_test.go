package api

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type mediaPlaceHierarchyFakeResolver struct{ version string }

func (r mediaPlaceHierarchyFakeResolver) Name() string    { return photointelligence.GeoNamesResolverName }
func (r mediaPlaceHierarchyFakeResolver) Version() string { return r.version }
func (r mediaPlaceHierarchyFakeResolver) Resolve(float64, float64) (photointelligence.PlaceLabel, bool, error) {
	return photointelligence.PlaceLabel{}, false, nil
}

func TestMediaPlaceHierarchyGenuinePostgresOwnerAndCursor(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "media_hierarchy_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = baseDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(u.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.MediaMetadata{},
		&meta.MediaGroup{}, &meta.MediaGroupItem{}, &meta.MediaDerivedResource{},
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoResource{}, &meta.PhotoMetadata{},
		&meta.PhotoAnalysisState{}, &meta.PhotoPlaceLabel{},
		&meta.PhotoCollection{}, &meta.PhotoCollectionAsset{},
	); err != nil {
		t.Fatal(err)
	}

	a := meta.User{Username: "hier-owner-a", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	b := meta.User{Username: "hier-owner-b", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	for _, user := range []*meta.User{&a, &b} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	roots := map[uint64]uint64{}
	for _, owner := range []uint64{a.ID, b.ID} {
		root := meta.Node{Name: "", OwnerID: owner, Type: meta.NodeTypeDir, Revision: 1}
		if err := db.Create(&root).Error; err != nil {
			t.Fatal(err)
		}
		roots[owner] = root.ID
	}
	type fixture struct {
		id   uint64
		node uint64
	}
	var seq uint64
	add := func(owner uint64, country, region, cityName string, cityID int64, favorite bool, special string) fixture {
		t.Helper()
		seq++
		name := fmt.Sprintf("hier-%d.jpg", seq)
		node := meta.Node{ParentID: func() *uint64 { p := roots[owner]; return &p }(), Name: name, Type: meta.NodeTypeFile, OwnerID: owner, Revision: 1}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.File{
			NodeID: node.ID, Size: 3, StorageKey: name, SHA256: fmt.Sprintf("%064x", seq),
		}).Error; err != nil {
			t.Fatal(err)
		}
		lat, lon := float64(35)+float64(seq)/10000, 139.0
		state := meta.MediaIndexStateReady
		if special == "unindexed" {
			state = "pending"
		}
		if err := db.Create(&meta.MediaMetadata{
			NodeID: node.ID, OwnerID: owner, NodeRevision: 1,
			SHA256: fmt.Sprintf("%064x", seq), MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", IndexState: state,
			Latitude: &lat, Longitude: &lon,
		}).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{OwnerID: owner, PrimaryNodeID: node.ID, Kind: meta.PhotoAssetKindImage, EvidenceKey: fmt.Sprintf("node:%d", node.ID)}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		pLat, pLon := lat, lon
		if special == "gps-changed" {
			pLat = 33.0
		}
		if err := db.Create(&meta.PhotoMetadata{AssetID: asset.ID, MediaKind: meta.MediaKindImage, MIMEType: "image/jpeg", Latitude: &pLat, Longitude: &pLon, Favorite: favorite}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoResource{
			AssetID: asset.ID, ResourceKind: meta.PhotoResourceKindNode, NodeID: node.ID,
			Role: meta.PhotoResourceRolePrimary, Name: name, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", Size: 3,
		}).Error; err != nil {
			t.Fatal(err)
		}
		version := "hier-v1"
		if special == "old-version" {
			version = "hier-v0"
		}
		fingerprint := fmt.Sprintf("gps:%016x:%016x", math.Float64bits(lat), math.Float64bits(lon))
		if special == "legacy" {
			fingerprint = ""
		}
		analysisState := meta.PhotoAnalysisStateReady
		if special == "analysis-stale" {
			analysisState = meta.PhotoAnalysisStateStale
		}
		if err := db.Create(&meta.PhotoAnalysisState{
			AssetID: asset.ID, Kind: meta.PhotoAnalysisKindPlaceLabel,
			AnalyzerVersion:  photointelligence.GeoNamesResolverName + "@" + version,
			InputFingerprint: fingerprint, State: analysisState,
		}).Error; err != nil {
			t.Fatal(err)
		}
		dist := 1.25
		regionLabel := region
		if err := db.Create(&meta.PhotoPlaceLabel{
			AssetID: asset.ID, Resolver: photointelligence.GeoNamesResolverName,
			ResolverVersion: version, InputFingerprint: fingerprint,
			Latitude: lat, Longitude: lon,
			CountryCode: country, Country: country, RegionCode: region, Region: regionLabel,
			CityGeoNameID: cityID, City: cityName, Formatted: cityName, DistanceKM: &dist,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if special == "deleted" {
			if err := db.Model(&node).Update("deleted_at", time.Now().UTC()).Error; err != nil {
				t.Fatal(err)
			}
		}
		return fixture{id: asset.ID, node: node.ID}
	}
	one := add(a.ID, "JP", "13", "Springfield", 101, true, "")
	_ = add(a.ID, "JP", "13", "Springfield", 101, false, "")
	_ = add(a.ID, "JP", "13", "Springfield", 102, false, "")
	osaka := add(a.ID, "JP", "27", "Osaka", 103, false, "")
	_ = add(a.ID, "US", "CA", "Springfield", 104, false, "")
	_ = add(a.ID, "JP", "13", "Invisible", 105, false, "legacy")
	_ = add(a.ID, "JP", "13", "Invisible", 105, false, "old-version")
	_ = add(a.ID, "JP", "13", "Invisible", 105, false, "gps-changed")
	_ = add(a.ID, "JP", "13", "Invisible", 105, false, "analysis-stale")
	_ = add(a.ID, "JP", "13", "Invisible", 105, false, "deleted")
	_ = add(a.ID, "JP", "13", "Invisible", 105, false, "unindexed")
	_ = add(b.ID, "JP", "13", "Secret", 106, false, "")
	server := &Server{DB: db, PhotoPlaceResolver: mediaPlaceHierarchyFakeResolver{version: "hier-v1"}}
	read := func(owner uint64, parent mediaPlaceHierarchyKey, options mediaQueryOptions, album, search, cursor string, limit int) mediaPlaceHierarchyPageDTO {
		t.Helper()
		page, err := server.queryMediaPlaceHierarchy(context.Background(), owner, options, album, parent, search, cursor, limit)
		if err != nil {
			t.Fatal(err)
		}
		return page
	}
	country := mediaPlaceHierarchyKey{Level: "country"}
	page := read(a.ID, country, mediaQueryOptions{}, "", "", "", 1)
	if !page.Available || page.DatasetVersion != "hier-v1" || !page.HasMore || page.NextCursor != "country:JP" ||
		len(page.Items) != 1 || page.Items[0].PhotoCount != 4 || page.Items[0].ID != "country:JP" {
		t.Fatalf("first country facet=%+v", page)
	}
	next := read(a.ID, country, mediaQueryOptions{}, "", "", page.NextCursor, 1)
	if next.HasMore || len(next.Items) != 1 || next.Items[0].ID != "country:US" || next.Items[0].PhotoCount != 1 {
		t.Fatalf("next country facet=%+v", next)
	}
	region := mediaPlaceHierarchyKey{Level: "region", Country: "JP"}
	regions := read(a.ID, region, mediaQueryOptions{}, "", "", "", 1)
	if len(regions.Items) != 1 || regions.Items[0].ID != "region:JP:13" ||
		regions.Items[0].PhotoCount != 3 || !regions.HasMore {
		t.Fatalf("region facet=%+v", regions)
	}
	regions2 := read(a.ID, region, mediaQueryOptions{}, "", "", regions.NextCursor, 1)
	if len(regions2.Items) != 1 || regions2.Items[0].ID != "region:JP:27" ||
		regions2.Items[0].PhotoCount != 1 || regions2.HasMore {
		t.Fatalf("region followup=%+v", regions2)
	}
	city := mediaPlaceHierarchyKey{Level: "city", Country: "JP", Region: "13"}
	cities := read(a.ID, city, mediaQueryOptions{}, "", "", "", 1)
	if len(cities.Items) != 1 || cities.Items[0].ID != "city:JP:13:101" || cities.Items[0].PhotoCount != 2 ||
		cities.Items[0].CoverNodeID == nil || !cities.HasMore {
		t.Fatalf("city facet=%+v", cities)
	}
	cities2 := read(a.ID, city, mediaQueryOptions{}, "", "", cities.NextCursor, 1)
	if len(cities2.Items) != 1 || cities2.Items[0].ID != "city:JP:13:102" || cities2.Items[0].PhotoCount != 1 || cities2.HasMore {
		t.Fatalf("city same-name distinct IDs=%+v", cities2)
	}
	search := read(a.ID, city, mediaQueryOptions{}, "", "springFIELD", "", 10)
	if len(search.Items) != 2 {
		t.Fatalf("literal substring search=%+v", search)
	}
	searchMeta := read(a.ID, city, mediaQueryOptions{}, "", "%", "", 10)
	if len(searchMeta.Items) != 0 {
		t.Fatalf("search %q interpreted as LIKE wildcard: %+v", "%", searchMeta)
	}
	favorite := true
	favorites := read(a.ID, country, mediaQueryOptions{Favorite: &favorite}, "", "", "", 10)
	if len(favorites.Items) != 1 || favorites.Items[0].ID != "country:JP" || favorites.Items[0].PhotoCount != 1 {
		t.Fatalf("favorite scope=%+v", favorites)
	}
	forOwnerB := read(b.ID, country, mediaQueryOptions{}, "", "", "", 10)
	if len(forOwnerB.Items) != 1 || forOwnerB.Items[0].PhotoCount != 1 {
		t.Fatalf("foreign owner=%+v", forOwnerB)
	}
	if page.Items[0].CoverNodeID == nil || *page.Items[0].CoverNodeID == 0 {
		t.Fatalf("real Owner cover absent: %+v", page)
	}
	albumKey := "manual:" + uuid.NewString()
	collection := meta.PhotoCollection{OwnerID: a.ID, ExternalKey: albumKey, Kind: meta.PhotoCollectionKindManual, Name: "Selected", State: meta.PhotoCollectionStateActive, Revision: 1}
	if err := db.Create(&collection).Error; err != nil {
		t.Fatal(err)
	}
	for index, id := range []uint64{one.id, osaka.id} {
		if err := db.Create(&meta.PhotoCollectionAsset{CollectionID: collection.ID, AssetID: id, Position: int64(index + 1)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	selected := read(a.ID, country, mediaQueryOptions{}, albumKey, "", "", 10)
	if len(selected.Items) != 1 || selected.Items[0].ID != "country:JP" || selected.Items[0].PhotoCount != 2 {
		t.Fatalf("album-scoped facet=%+v", selected)
	}
	// B1-C: all media results, sparse count, anchor and selected page are built
	// on exactly the identity predicate used for B1-B grouped counts.
	cityKey, ok := parseMediaPlaceHierarchyKey("city:JP:13:101")
	if !ok {
		t.Fatal("expected known stable city")
	}
	opts := mediaQueryOptions{PlaceHierarchy: &cityKey}
	cityRange, err := server.queryMediaItemRange(context.Background(), a.ID, opts, "", 1, 0)
	if err != nil || cityRange.TotalCount != 2 || len(cityRange.Items) != 1 {
		t.Fatalf("same city sparse range=%+v err=%v", cityRange, err)
	}
	secondRange, err := server.queryMediaItemRange(context.Background(), a.ID, opts, "", 1, 1)
	if err != nil || secondRange.TotalCount != 2 || len(secondRange.Items) != 1 ||
		secondRange.Items[0].Node.ID == cityRange.Items[0].Node.ID {
		t.Fatalf("same city page 2=%+v err=%v", secondRange, err)
	}
	opts.AnchorNodeID = one.node
	anchored, err := server.queryMediaItemRange(context.Background(), a.ID, opts, "", 1, 0)
	if err != nil || anchored.AnchorIndex == nil || *anchored.AnchorIndex < 0 || *anchored.AnchorIndex >= 2 {
		t.Fatalf("same city Viewer anchor=%+v err=%v", anchored, err)
	}
	opts.Favorite = &favorite
	favoriteRange, err := server.queryMediaItemRange(context.Background(), a.ID, opts, "", 3, 0)
	if err != nil || favoriteRange.TotalCount != 1 || len(favoriteRange.Items) != 1 ||
		favoriteRange.Items[0].Node.ID != one.node {
		t.Fatalf("city favorite range=%+v err=%v", favoriteRange, err)
	}
	opts.Favorite = nil
	albumRange, err := server.queryMediaItemRange(context.Background(), a.ID, opts, albumKey, 3, 0)
	if err != nil || albumRange.TotalCount != 1 || len(albumRange.Items) != 1 ||
		albumRange.Items[0].Node.ID != one.node {
		t.Fatalf("city album range=%+v err=%v", albumRange, err)
	}
	foreignRange, err := server.queryMediaItemRange(context.Background(), b.ID, opts, "", 3, 0)
	if err != nil || foreignRange.TotalCount != 0 || len(foreignRange.Items) != 0 {
		t.Fatalf("city cannot resolve foreign owner's photos=%+v err=%v", foreignRange, err)
	}
	// Keep existing grid deep-link parser unchanged by the new hierarchy key.
	if _, ok := parseMediaPlaceKey("place:3500:13900"); !ok {
		t.Fatal("legacy grid key rejected")
	}
	if _, ok := parseMediaPlaceKey(cityKey.String()); ok {
		t.Fatal("city key aliased to old cell")
	}
	server.PhotoPlaceResolver = mediaPlaceHierarchyFakeResolver{version: "hier-v2"}
	stale := read(a.ID, country, mediaQueryOptions{}, "", "", "", 10)
	if !stale.Available || len(stale.Items) != 0 {
		t.Fatalf("updated resolver leaked old label=%+v", stale)
	}
	server.PhotoPlaceResolver = nil
	unavailable := read(a.ID, country, mediaQueryOptions{}, "", "", "", 10)
	if unavailable.Available || unavailable.DatasetVersion != "" || len(unavailable.Items) != 0 {
		t.Fatalf("unavailable resolver leaked labels=%+v", unavailable)
	}
}
