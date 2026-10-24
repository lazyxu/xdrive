package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Runs against real PostgreSQL when XD_TEST_DATABASE_URL is available,
// exercising exactly the transactional consumer invoked by the HTTP handler.
func TestBaiduMapScopeHandoffOneUseAcrossPostgresReplicas(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("PostgreSQL fixture required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	rootSQL, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	rootSQL.SetMaxOpenConns(2)
	rootSQL.SetMaxIdleConns(0)
	defer rootSQL.Close()
	schema := "map_handoff_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf(`CREATE SCHEMA "%s"`, schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf(`DROP SCHEMA "%s" CASCADE`, schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := parsed.Query()
	q.Set("search_path", schema)
	parsed.RawQuery = q.Encode()
	connect := func() *gorm.DB {
		t.Helper()
		db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		raw, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		raw.SetMaxOpenConns(4)
		raw.SetMaxIdleConns(0)
		t.Cleanup(func() { _ = raw.Close() })
		return db
	}
	db := connect()
	otherDB := connect()
	if err := db.AutoMigrate(&meta.User{}, &meta.BaiduJSAPIMapEpoch{},
		&meta.PhotoCollection{}, &meta.BaiduMapScopeHandoff{}); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{Username: "map-handoff-owner", PasswordHash: "test-hash",
		Role: meta.UserRoleUser, SessionVersion: 5}
	foreign := meta.User{Username: "map-handoff-foreign", PasswordHash: "test-hash",
		Role: meta.UserRoleUser, SessionVersion: 5}
	for _, person := range []*meta.User{&owner, &foreign} {
		if err := db.Create(person).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.BaiduJSAPIMapEpoch{OwnerID: person.ID, Epoch: 3}).Error; err != nil {
			t.Fatal(err)
		}
	}
	album := meta.PhotoCollection{OwnerID: owner.ID, ExternalKey: "manual:Family",
		Kind: meta.PhotoCollectionKindManual, Name: "Family",
		State: meta.PhotoCollectionStateActive, Revision: 7}
	if err := db.Create(&album).Error; err != nil {
		t.Fatal(err)
	}
	scope := baiduMapHandoffScope{
		AlbumKey: "manual:Family", Filters: baiduMapHandoffFilters{
			SortBy: "captured", SortDir: "desc",
			Favorite: func() *bool { v := true; return &v }(),
		},
	}
	rawScope, err := json.Marshal(scope)
	if err != nil {
		t.Fatal(err)
	}
	camera := baiduMapHandoffCamera{CoordinateSpace: "bd09ll",
		Latitude: 35.42, Longitude: 119.2, Zoom: 11}
	rawCamera, err := json.Marshal(camera)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	serial := 0
	insert := func(expiration time.Time) string {
		t.Helper()
		serial++
		var nonce [32]byte
		for i := range nonce {
			nonce[i] = byte(i + serial)
		}
		hash := sha256.Sum256(nonce[:])
		row := meta.BaiduMapScopeHandoff{
			Hash: hex.EncodeToString(hash[:]), OwnerID: owner.ID,
			SessionVersion: 5, RevocationEpoch: 3,
			ConfigurationRevision: 13, TargetMode: "isolated",
			ScopeJSON: string(rawScope), CameraJSON: string(rawCamera),
			AlbumRevision: 7, ExpiresAt: expiration,
		}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		return row.Hash
	}
	srv := &Server{DB: db}
	replica := &Server{DB: otherDB}
	consume := func(s *Server, hash string, uid, session, epoch, config uint64,
		mode string) (baiduMapHandoffResult, error) {
		return s.consumeBaiduMapScopeHandoffTx(context.Background(),
			hash, time.Now().UTC(), uid, session, epoch, config, mode)
	}
	hash := insert(now.Add(time.Minute))
	for _, candidate := range []struct {
		uid, session, epoch, config uint64
		mode                        string
	}{
		{foreign.ID, 5, 3, 13, "isolated"},
		{owner.ID, 6, 3, 13, "isolated"},
		{owner.ID, 5, 4, 13, "isolated"},
		{owner.ID, 5, 3, 14, "isolated"},
		{owner.ID, 5, 3, 13, "prototype"},
	} {
		if _, err := consume(srv, hash, candidate.uid, candidate.session,
			candidate.epoch, candidate.config, candidate.mode); err == nil {
			t.Fatal("foreign/stale/incorrect target consumed Owner bridge")
		}
	}
	if err := db.Model(&meta.PhotoCollection{}).Where("id = ?", album.ID).
		Update("revision", 8).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := consume(srv, hash, owner.ID, 5, 3, 13, "isolated"); err == nil {
		t.Fatal("stale album revision passed Owner handoff")
	}
	if err := db.Model(&meta.PhotoCollection{}).Where("id = ?", album.ID).
		Update("revision", 7).Error; err != nil {
		t.Fatal(err)
	}
	var wins int64
	const contenders = 20
	var group sync.WaitGroup
	group.Add(contenders)
	for i := 0; i < contenders; i++ {
		go func(id int) {
			defer group.Done()
			choice := srv
			if id%2 == 0 {
				choice = replica
			}
			got, err := consume(choice, hash, owner.ID, 5, 3, 13, "isolated")
			if err == nil {
				if got.Scope.AlbumKey == "manual:Family" && got.Scope.Filters.Favorite != nil &&
					*got.Scope.Filters.Favorite && got.Camera != nil &&
					got.Camera.CoordinateSpace == "bd09ll" && got.Camera.Zoom == 11 {
					atomic.AddInt64(&wins, 1)
				}
			}
		}(i)
	}
	group.Wait()
	if wins != 1 {
		t.Fatalf("PostgreSQL cross-replica redeem winners=%d; want exactly one", wins)
	}
	if _, err := consume(srv, hash, owner.ID, 5, 3, 13, "isolated"); err == nil {
		t.Fatal("redeemed scope replayed")
	}
	var saved meta.BaiduMapScopeHandoff
	if err := db.Where("hash = ?", hash).Take(&saved).Error; err != nil || saved.ConsumedAt == nil {
		t.Fatal("one-time redemption missing consumed_at")
	}
	expired := insert(now.Add(-time.Second))
	if _, err := consume(srv, expired, owner.ID, 5, 3, 13, "isolated"); err == nil {
		t.Fatal("expired map scope restored")
	}
	revoked := insert(now.Add(time.Minute))
	if err := db.Model(&meta.BaiduJSAPIMapEpoch{}).
		Where("owner_id = ?", owner.ID).Update("epoch", 4).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := consume(srv, revoked, owner.ID, 5, 3, 13, "isolated"); err == nil {
		t.Fatal("revoked map epoch restored scope")
	}
	if err := db.Model(&meta.BaiduJSAPIMapEpoch{}).
		Where("owner_id = ?", owner.ID).Update("epoch", 3).Error; err != nil {
		t.Fatal(err)
	}
	rotated := insert(now.Add(time.Minute))
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("session_version", 6).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := consume(srv, rotated, owner.ID, 5, 3, 13, "isolated"); err == nil {
		t.Fatal("session rotation allowed old scope")
	}
}
