package api

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestMediaExactTripOwnerGPSMembersExcludeSameDayHomeAndUnlocatedMedia(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	rootDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	rootSQL, err := rootDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer rootSQL.Close()

	schema := "media_exact_trip_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := rootDB.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = rootDB.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error
	}()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	params := parsed.Query()
	params.Set("search_path", schema)
	parsed.RawQuery = params.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
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
		&meta.PhotoAsset{}, &meta.PhotoEditRecipe{}, &meta.PhotoMetadata{},
		&meta.PhotoResource{}, &meta.PhotoPlaceLabel{},
	); err != nil {
		t.Fatal(err)
	}

	createOwner := func(label string) (meta.User, meta.Node) {
		t.Helper()
		owner := meta.User{
			Username: label + uuid.NewString(), PasswordHash: "unused",
			Role: meta.UserRoleUser, SessionVersion: 1,
		}
		if err := db.Create(&owner).Error; err != nil {
			t.Fatal(err)
		}
		node := meta.Node{
			Name: "", Type: meta.NodeTypeDir,
			OwnerID: owner.ID, Revision: 1,
		}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		return owner, node
	}
	owner, root := createOwner("trip-owner-")
	other, otherRoot := createOwner("trip-foreign-")
	add := func(uid uint64, parent uint64, name string, day int,
		latitude, longitude *float64) uint64 {
		t.Helper()
		node := meta.Node{
			ParentID: &parent, Name: name, Type: meta.NodeTypeFile,
			OwnerID: uid, Revision: 1,
		}
		if err := db.Create(&node).Error; err != nil {
			t.Fatal(err)
		}
		file := meta.File{
			NodeID: node.ID, Size: 100,
			StorageKey: "exact-trip-" + name,
			SHA256:     fmt.Sprintf("%064x", node.ID),
		}
		if err := db.Create(&file).Error; err != nil {
			t.Fatal(err)
		}
		captured := time.Date(2026, time.January, day, 12, 0, 0, 0, time.UTC)
		if err := db.Create(&meta.MediaMetadata{
			NodeID: node.ID, OwnerID: uid, NodeRevision: node.Revision,
			SHA256: file.SHA256, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", CapturedAt: &captured,
			Latitude: latitude, Longitude: longitude,
			IndexState: meta.MediaIndexStateReady,
		}).Error; err != nil {
			t.Fatal(err)
		}
		asset := meta.PhotoAsset{
			OwnerID: uid, PrimaryNodeID: node.ID,
			Kind: meta.PhotoAssetKindImage, EvidenceKey: "trip:" + name,
		}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.PhotoMetadata{
			AssetID: asset.ID, MediaKind: meta.MediaKindImage,
			MIMEType: "image/jpeg", CapturedAt: &captured,
			Latitude: latitude, Longitude: longitude,
		}).Error; err != nil {
			t.Fatal(err)
		}
		return node.ID
	}
	ptr := func(n float64) *float64 { return &n }
	homeLat, homeLon := ptr(1.2), ptr(1.2)
	awayLat, awayLon := ptr(10.1), ptr(10.1)
	for day := 1; day <= 3; day++ {
		add(owner.ID, root.ID, fmt.Sprintf("home-%d-a.jpg", day), day, homeLat, homeLon)
		add(owner.ID, root.ID, fmt.Sprintf("home-%d-b.jpg", day), day, homeLat, homeLon)
	}
	included := map[uint64]bool{}
	awayNearbyLatitude := ptr(10.125)
	excluded := map[uint64]bool{}
	var firstAway uint64
	for day := 4; day <= 5; day++ {
		first := add(owner.ID, root.ID, fmt.Sprintf("trip-%d-a.jpg", day), day, awayLat, awayLon)
		if day == 5 {
			// Mutate a photo on the high-cardinality travel day so both
			// independently identified away days remain after the GPS edit.
			// This exercises stale ID revocation without erasing the trip.
			firstAway = first
		}
		included[first] = true
		latitudeForSecond := awayLat
		if day == 5 {
			// Same 0.2-degree trip day, separate real 0.01-degree map place.
			latitudeForSecond = awayNearbyLatitude
		}
		included[add(owner.ID, root.ID, fmt.Sprintf("trip-%d-b.jpg", day), day, latitudeForSecond, awayLon)] = true
		excluded[add(owner.ID, root.ID, fmt.Sprintf("same-day-home-%d.jpg", day), day, homeLat, homeLon)] = true
		excluded[add(owner.ID, root.ID, fmt.Sprintf("unlocated-%d.jpg", day), day, nil, nil)] = true
	}
	included[add(owner.ID, root.ID, "same-day-second-city.jpg", 4, ptr(20.2), ptr(20.2))] = true
	add(other.ID, otherRoot.ID, "foreign-away.jpg", 4, awayLat, awayLon)

	ctx := context.Background()
	segments, err := queryMediaExactTripSegments(ctx, db, owner.ID, "UTC")
	if err != nil {
		t.Fatal(err)
	}
	if len(segments) != 1 {
		t.Fatalf("exact trip segments=%+v, expected one", segments)
	}
	segment := segments[0]
	id := mediaExactTripID(segment, "UTC")
	if id == "" {
		t.Fatal("missing exact trip id")
	}
	query, err := (&Server{DB: db}).mediaExactTripQuery(ctx, owner.ID, segment, "UTC")
	if err != nil {
		t.Fatal(err)
	}
	var total int64
	if err := query.Session(&gorm.Session{}).
		Distinct("xd_media_metadata.node_id").Count(&total).Error; err != nil {
		t.Fatal(err)
	}
	if total != 5 {
		t.Fatalf("exact multi-city member count=%d, expected 5", total)
	}
	server := &Server{DB: db}
	for _, window := range []struct{ offset, limit, expected int }{
		{0, 2, 2}, {2, 2, 2}, {4, 2, 1},
	} {
		q, err := server.mediaExactTripQuery(ctx, owner.ID, segment, "UTC")
		if err != nil {
			t.Fatal(err)
		}
		page, err := server.materializeMediaItems(
			ctx, owner.ID, q, window.limit, window.offset)
		if err != nil {
			t.Fatal(err)
		}
		if len(page) != window.expected {
			t.Fatalf("window %+v has %d items", window, len(page))
		}
		for _, item := range page {
			if !included[item.Node.ID] || excluded[item.Node.ID] {
				t.Fatalf("non-trip item leaked: node=%d", item.Node.ID)
			}
			delete(included, item.Node.ID)
		}
	}
	if len(included) != 0 {
		t.Fatalf("missing expected trip members: %+v", included)
	}

	// The map and its tapped place read must intersect the SAME trip GPS
	// members: no same-day home, foreign Owner, unlocated or other-city photo.
	overview, err := server.queryMediaExactTripMap(ctx, owner.ID, segment, "UTC")
	if err != nil {
		t.Fatal(err)
	}
	if overview.Aggregated || overview.TotalPhotoCount != 5 ||
		overview.TripPhotoCount != 5 || len(overview.Items) != 3 {
		t.Fatalf("trip GPS map=%+v, expected three true place cells totaling 5", overview)
	}
	placeCounts := map[string]int64{
		"place:1010:1010": 3,
		"place:1012:1010": 1,
		"place:2020:2020": 1,
	}
	for _, facet := range overview.Items {
		want, exists := placeCounts[facet.ID]
		if !exists || facet.ItemCount != want ||
			facet.CoordinateKind != "grid_cell_center" {
			t.Fatalf("wrong trip GPS map facet: %+v", facet)
		}
		cell, ok := parseMediaPlaceKey(facet.ID)
		if !ok {
			t.Fatalf("invalid map cell key=%q", facet.ID)
		}
		q, err := server.mediaExactTripQuery(ctx, owner.ID, segment, "UTC")
		if err != nil {
			t.Fatal(err)
		}
		q = mediaExactTripPlaceCellQuery(q, cell)
		var count int64
		if err := q.Session(&gorm.Session{}).
			Distinct("xd_media_metadata.node_id").Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != facet.ItemCount {
			t.Fatalf("place %s count=%d, map count=%d", facet.ID, count, facet.ItemCount)
		}
		placePage, err := server.materializeMediaItems(ctx, owner.ID, q, 48, 0)
		if err != nil {
			t.Fatal(err)
		}
		if int64(len(placePage)) != count {
			t.Fatalf("map place %s Range returned %d want %d", facet.ID, len(placePage), count)
		}
		for _, item := range placePage {
			if excluded[item.Node.ID] {
				t.Fatalf("unauthorized trip GPS member in facet %s: %+v", facet.ID, item)
			}
		}
	}
	// Home places exist in the same date interval, but cannot be selected
	// through trip-specific map place=... even when the caller knows the ID.
	homeQuery, err := server.mediaExactTripQuery(ctx, owner.ID, segment, "UTC")
	if err != nil {
		t.Fatal(err)
	}
	homeQuery = mediaExactTripPlaceCellQuery(homeQuery, mediaPlaceCell{
		Latitude: 120, Longitude: 120,
	})
	var homeCount int64
	if err := homeQuery.Distinct("xd_media_metadata.node_id").Count(&homeCount).Error; err != nil {
		t.Fatal(err)
	}
	if homeCount != 0 {
		t.Fatalf("home photos leaked into exact trip place: %d", homeCount)
	}

	foreignSegments, err := queryMediaExactTripSegments(ctx, db, other.ID, "UTC")
	if err != nil {
		t.Fatal(err)
	}
	for _, current := range foreignSegments {
		if mediaExactTripID(current, "UTC") == id {
			t.Fatal("foreign Owner resolved another Owner trip")
		}
	}
	// A very large same-trip location set may not be silently truncated
	// to a plausible-looking top-64 MapKit result with a wrong total.
	var firstMany, secondMany uint64
	for i := 0; i < 70; i++ {
		lat := 10.025 + float64(i%10)*0.0125
		lon := 10.025 + float64(i/10)*0.0125
		member := add(owner.ID, root.ID, fmt.Sprintf("trip-map-many-%d.jpg", i), 5, &lat, &lon)
		if i == 0 {
			firstMany = member
		} else if i == 1 {
			secondMany = member
		}
	}
	// A 65+ place trip now has a bounded display aggregate, not a 409 or
	// false top-64 subset. Each aggregate is inert until it is zoomed.
	overflow, err := server.queryMediaExactTripMap(ctx, owner.ID, segment, "UTC")
	if err != nil || !overflow.Aggregated ||
		len(overflow.Items) == 0 || len(overflow.Items) > 64 ||
		overflow.TripPhotoCount != 75 || overflow.TotalPhotoCount != 75 {
		t.Fatalf("large trip aggregation failed: %+v, err=%v", overflow, err)
	}
	for _, facet := range overflow.Items {
		if facet.CoordinateKind != "map_region_sample" ||
			strings.HasPrefix(facet.ID, "place:") {
			t.Fatalf("aggregate promoted to exact place scope: %+v", facet)
		}
	}
	// A GPS edit that makes home dominant on a former trip day must revoke
	// the old exact segment rather than silently falling back to date range.
	if err := db.Model(&meta.MediaMetadata{}).
		Where("owner_id = ? AND node_id = ?", owner.ID, firstAway).
		Updates(map[string]any{"latitude": 1.2, "longitude": 1.2}).Error; err != nil {
		t.Fatal(err)
	}
	// Recheck that old members are never selected after changing location.
	after, err := queryMediaExactTripSegments(ctx, db, owner.ID, "UTC")
	if err != nil {
		t.Fatal(err)
	}
	for _, current := range after {
		if mediaExactTripID(current, "UTC") == id {
			t.Fatal("geography-changed trip retained stale route")
		}
	}
	// M10: The old travel ID is not a reusable date-range credential. A
	// previously signed trip URL must fail to resolve after a GPS edit.
	if _, found, err := server.resolveMediaExactTrip(ctx, owner.ID, "UTC", id); err != nil || found {
		t.Fatalf("old GPS-edited trip route still resolved: found=%v err=%v", found, err)
	}

	// Reclassify one genuine away image as unsupported. The exact member
	// count and fingerprint must change even when the original node remains.
	if err := db.Model(&meta.MediaMetadata{}).
		Where("owner_id = ? AND node_id = ?", owner.ID, firstMany).
		Update("index_state", meta.MediaIndexStateUnsupported).Error; err != nil {
		t.Fatal(err)
	}
	beforeReclassification := ""
	for _, current := range after {
		if current.ItemCount == 74 {
			beforeReclassification = mediaExactTripID(current, "UTC")
		}
	}
	if beforeReclassification == "" {
		t.Fatalf("GPS edit did not produce a current 74-member trip: %+v", after)
	}
	reclassified, err := queryMediaExactTripSegments(ctx, db, owner.ID, "UTC")
	if err != nil {
		t.Fatal(err)
	}
	var reclassifiedID string
	for _, current := range reclassified {
		if current.ItemCount == 73 {
			reclassifiedID = mediaExactTripID(current, "UTC")
		}
	}
	if reclassifiedID == "" || reclassifiedID == beforeReclassification {
		t.Fatalf("reclassified GPS member retained stale trip identity: %+v", reclassified)
	}
	if _, found, err := server.resolveMediaExactTrip(ctx, owner.ID, "UTC", beforeReclassification); err != nil || found {
		t.Fatalf("reclassified trip old URL still resolved: %v %v", found, err)
	}

	// Soft-delete another still-indexed member. Both the signed Range and
	// the map overview must exclude deleted nodes; no stale place is readable.
	if err := db.Model(&meta.Node{}).
		Where("id = ? AND owner_id = ?", secondMany, owner.ID).
		Update("deleted_at", time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	deleted, err := queryMediaExactTripSegments(ctx, db, owner.ID, "UTC")
	if err != nil {
		t.Fatal(err)
	}
	for _, current := range deleted {
		if current.ItemCount == 72 {
			newID := mediaExactTripID(current, "UTC")
			if newID == "" || newID == reclassifiedID {
				t.Fatalf("delete reused stale trip URL: %q", newID)
			}
			if _, found, err := server.resolveMediaExactTrip(ctx, owner.ID, "UTC", reclassifiedID); err != nil || found {
				t.Fatalf("deleted member remained authorized by old trip: %v %v", found, err)
			}
			query, err := server.mediaExactTripQuery(ctx, owner.ID, current, "UTC")
			if err != nil {
				t.Fatal(err)
			}
			var count int64
			if err := query.Distinct("xd_media_metadata.node_id").Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count != 72 {
				t.Fatalf("deleted/reclassified trip Range has %d instead of 72 members", count)
			}
			return
		}
	}
	t.Fatalf("deleting one indexed GPS trip member lost or retained wrong trip set: %+v", deleted)
}
