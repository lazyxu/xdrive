package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/version"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// P0-4: real Gin routing, bearer Owner validation, currently signed Server
// release and PostgreSQL single-use issue/redeem. This does NOT mount a
// browser SDK, contact Baidu or validate media bytes/Viewer: #2531 tracks
// that remaining real end-to-end browser integration separately.
func TestPlacesP04RealGinOwnerHandoffPostgres(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("real PostgreSQL test fixture required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "places_p04_http_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	uri, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := uri.Query()
	query.Set("search_path", schema)
	uri.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(uri.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(6)
	defer sqlDB.Close()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.AdminServiceSecret{}, &meta.InternalServiceKeyAnchor{},
		&meta.BaiduJSAPIMapEpoch{}, &meta.PhotoCollection{}, &meta.BaiduMapScopeHandoff{},
	); err != nil {
		t.Fatal(err)
	}
	keys, err := connectorsecret.NewKeyring(1, map[uint32]string{
		1: strings.Repeat("cd", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{
		DB: db, ConnectorSecrets: keys, Auth: auth.New("p04-real-gin-owner-map", time.Hour),
		AllowedOrigin: "https://gallery.example.net",
		// The INLINE Host has no independent Child DNS requirement. This does
		// not relax separate Child ticket admission for isolated map SDK.
	}
	owner := meta.User{Username: "p04-real-owner", PasswordHash: "test-only",
		Role: meta.UserRoleUser, SessionVersion: 1}
	foreign := meta.User{Username: "p04-foreign", PasswordHash: "test-only",
		Role: meta.UserRoleUser, SessionVersion: 1}
	for _, person := range []*meta.User{&owner, &foreign} {
		if err := db.Create(person).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&meta.BaiduJSAPIMapEpoch{
			OwnerID: person.ID, Epoch: 3,
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	album := meta.PhotoCollection{OwnerID: owner.ID, ExternalKey: "manual:Family",
		Kind: meta.PhotoCollectionKindManual, Name: "Family",
		State: meta.PhotoCollectionStateActive, Revision: 7}
	if err := db.Create(&album).Error; err != nil {
		t.Fatal(err)
	}
	akVersion, akCipher, err := keys.Seal(
		baiduJSAPISecretAADID, baiduJSAPISecretKind, []byte("SYNTHETIC_BROWSER_AK_NO_PROVIDER"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.AdminServiceSecret{Name: baiduJSAPISecretName,
		Enabled: true, Revision: 1, KeyVersion: akVersion, Ciphertext: akCipher}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureBaiduJSAPI4InternalKeys(context.Background()); err != nil {
		t.Fatal(err)
	}
	priorCommit := version.Commit
	version.Commit = strings.Repeat("a", 40)
	defer func() { version.Commit = priorCommit }()
	if err := s.RefreshBaiduJSAPI4ManagedRelease(context.Background()); err != nil {
		t.Fatalf("could not establish genuine protected test-only signed release: %v", err)
	}
	defer s.ClearBaiduJSAPI4OperatorRelease()
	token, err := s.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.Auth.Issue(foreign.ID, foreign.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	router := s.Router()
	visit := func(route, bearer, payload, origin string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "https://gallery.example.net"+route,
			strings.NewReader(payload))
		req.Header.Set("Authorization", "Bearer "+bearer)
		req.Header.Set("Origin", origin)
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		req.Header.Set("Content-Type", "application/json")
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	// Genuine Gin response: signed release is available without Child DNS.
	status := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet,
		"https://gallery.example.net/api/v1/media/places/baidu-jsapi/status", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	router.ServeHTTP(status, req)
	if status.Code != http.StatusOK ||
		!strings.Contains(status.Body.String(), "\"activation_state\":\"authorized_signed_release\"") ||
		!strings.Contains(status.Body.String(), "\"isolated_child_origin\":\"\"") {
		t.Fatalf("independent inline signed status unavailable: %d", status.Code)
	}
	issue := func(target string) string {
		t.Helper()
		payload := fmt.Sprintf(
			`{"target_mode":%q,"scope":{"albumKey":"manual:Family","filters":{"sort_by":"captured","sort_dir":"desc","favorite":true}},"camera":{"coordinate_space":"bd09ll","latitude":35.42,"longitude":119.2,"zoom":11}}`,
			target)
		out := visit(baiduMapScopeHandoffPath, token, payload,
			"https://gallery.example.net")
		if out.Code != http.StatusOK {
			t.Fatalf("authenticated Gin issue rejected %s: status %d", target, out.Code)
		}
		var reply struct {
			Ticket     string `json:"ticket"`
			TargetMode string `json:"target_mode"`
		}
		if err := json.Unmarshal(out.Body.Bytes(), &reply); err != nil ||
			len(reply.Ticket) != 64 || reply.TargetMode != target {
			t.Fatal("invalid one-use Gin handoff issue response")
		}
		if strings.Contains(out.Body.String(), "manual:Family") ||
			strings.Contains(out.Body.String(), "35.42") {
			t.Fatal("private album/camera leaked in one-use URL ticket response")
		}
		return reply.Ticket
	}
	consume := func(target, ticket, bearer, origin string) *httptest.ResponseRecorder {
		t.Helper()
		payload := fmt.Sprintf(`{"target_mode":%q,"ticket":%q}`, target, ticket)
		return visit(baiduMapScopeConsumePath, bearer, payload, origin)
	}
	for _, target := range []string{"isolated", "prototype"} {
		ticket := issue(target)
		if got := consume(target, ticket, other, "https://gallery.example.net"); got.Code == http.StatusOK {
			t.Fatal("foreign Owner consumed one-use bridge")
		}
		wrongMode := "isolated"
		if target == "isolated" {
			wrongMode = "prototype"
		}
		if got := consume(wrongMode, ticket, token, "https://gallery.example.net"); got.Code == http.StatusOK {
			t.Fatal("wrong SDK Host consumed one-use bridge")
		}
		if got := consume(target, ticket, token, "https://attacker.example.org"); got.Code == http.StatusOK {
			t.Fatal("cross-Origin request consumed bridge")
		}
		good := consume(target, ticket, token, "https://gallery.example.net")
		if good.Code != http.StatusOK {
			t.Fatalf("real Gin/PG handoff %s consume failed with %d", target, good.Code)
		}
		var reply struct {
			TargetMode string                `json:"target_mode"`
			Scope      baiduMapHandoffScope  `json:"scope"`
			Camera     baiduMapHandoffCamera `json:"camera"`
		}
		if err := json.Unmarshal(good.Body.Bytes(), &reply); err != nil ||
			reply.TargetMode != target || reply.Scope.AlbumKey != "manual:Family" ||
			reply.Scope.Filters.Favorite == nil || !*reply.Scope.Filters.Favorite ||
			reply.Camera.CoordinateSpace != "bd09ll" || reply.Camera.Zoom != 11 {
			t.Fatal("Gin/PG scope or camera changed between map SDK Hosts")
		}
		if replay := consume(target, ticket, token, "https://gallery.example.net"); replay.Code == http.StatusOK {
			t.Fatal("one-use Owner PhotoScope replayed")
		}
	}
	// Album revision must be re-read when consuming a still-valid ticket.
	staleAlbum := issue("isolated")
	if err := db.Model(&meta.PhotoCollection{}).Where("id = ?", album.ID).
		Update("revision", 8).Error; err != nil {
		t.Fatal(err)
	}
	if out := consume("isolated", staleAlbum, token, "https://gallery.example.net"); out.Code == http.StatusOK {
		t.Fatal("modified Album was silently restored")
	}
	// Existing Owner map revocation fence must invalidate pending tickets too.
	if err := db.Model(&meta.PhotoCollection{}).Where("id = ?", album.ID).
		Update("revision", 7).Error; err != nil {
		t.Fatal(err)
	}
	staleEpoch := issue("isolated")
	if err := db.Model(&meta.BaiduJSAPIMapEpoch{}).Where("owner_id = ?", owner.ID).
		Update("epoch", 4).Error; err != nil {
		t.Fatal(err)
	}
	if out := consume("isolated", staleEpoch, token, "https://gallery.example.net"); out.Code == http.StatusOK {
		t.Fatal("revoked Owner map restored")
	}
}
