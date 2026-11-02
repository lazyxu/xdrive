package api

import (
    "encoding/json"
    "fmt"
    "net/http"
    "os"
    "strings"
    "testing"
    "time"

    "github.com/gin-gonic/gin"
    "github.com/lazyxu/xdrive/internal/auth"
    "github.com/lazyxu/xdrive/internal/connectorsecret"
    "github.com/lazyxu/xdrive/internal/meta"
    "github.com/lazyxu/xdrive/internal/storage"
    "gorm.io/driver/postgres"
    "gorm.io/gorm"
)

func TestOwnerShareCenterCopyAndLegacyCompatibility(t *testing.T) {
    dsn := os.Getenv("XD_TEST_DATABASE_URL")
    if dsn == "" { t.Skip("XD_TEST_DATABASE_URL is not set") }
    gin.SetMode(gin.TestMode)
    db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
    if err != nil { t.Fatal(err) }
    if err := db.Migrator().DropTable(
        &meta.AuditEvent{}, &meta.Share{}, &meta.UploadPart{}, &meta.LocalPushQuotaHold{},
        &meta.UploadSession{}, &meta.ContentBlob{}, &meta.FileVersion{}, &meta.File{},
        &meta.Node{}, &meta.RefreshToken{}, &meta.User{},
    ); err != nil { t.Fatal(err) }
    if err := db.AutoMigrate(
        &meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{},
        &meta.ContentBlob{}, &meta.Share{}, &meta.UploadSession{}, &meta.UploadPart{},
        &meta.LocalPushQuotaHold{}, &meta.AuditEvent{},
    ); err != nil { t.Fatal(err) }
    if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil { t.Fatal(err) }
    if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil { t.Fatal(err) }
    store, err := storage.NewLocal(t.TempDir())
    if err != nil { t.Fatal(err) }
    ring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("ab", 32)})
    if err != nil { t.Fatal(err) }
    router := (&Server{
        DB: db, Store: store, Auth: auth.New("share-center-integration-secret", time.Hour),
        ConnectorSecrets: ring, RefreshTTL: 24 * time.Hour,
        AllowedOrigin: "http://localhost", MaxUploadBytes: 10 << 20,
    }).Router()

    ownerToken := createTestUser(t, db, router, "share-center-owner", "owner-password")
    otherToken := createTestUser(t, db, router, "share-center-other", "other-password")
    root := requestNode(t, router, http.MethodGet, "/api/v1/nodes/root", ownerToken, nil, http.StatusOK)
    file := uploadTestFile(t, router, ownerToken, root.ID, "center-demo.txt", "share-content")

    createdRes := request(t, router, http.MethodPost,
        fmt.Sprintf("/api/v1/nodes/%d/shares", file.ID), ownerToken,
        strings.NewReader(`{"access":"read_only"}`), http.StatusCreated)
    var created createdShareDTO
    if err := json.Unmarshal(createdRes.Body.Bytes(), &created); err != nil { t.Fatal(err) }
    if len(created.Token) < 40 { t.Fatal("missing random share capability") }

    pageRes := request(t, router, http.MethodGet, "/api/v1/shares?limit=1", ownerToken, nil, http.StatusOK)
    var page ownerSharesPageDTO
    if err := json.Unmarshal(pageRes.Body.Bytes(), &page); err != nil { t.Fatal(err) }
    if len(page.Items) != 1 || page.Items[0].ID != created.ID ||
        page.Items[0].NodeName != file.Name || page.NextCursor != 0 {
        t.Fatalf("Owner page mismatch: %+v", page)
    }
    if strings.Contains(pageRes.Body.String(), created.Token) ||
        strings.Contains(pageRes.Body.String(), hashShareToken(created.Token)) {
        t.Fatal("Owner list unexpectedly leaked a bearer or hash")
    }
    filterRes := request(t, router, http.MethodGet, "/api/v1/shares?status=active&q=CENTER-demo",
        ownerToken, nil, http.StatusOK)
    if !json.Valid(filterRes.Body.Bytes()) { t.Fatal("share status/name filter returned invalid response") }
    var filtered ownerSharesPageDTO
    if err := json.Unmarshal(filterRes.Body.Bytes(), &filtered); err != nil { t.Fatal(err) }
    if len(filtered.Items) != 1 || filtered.Items[0].ID != created.ID {
        t.Fatalf("unexpected filtered share result: %+v", filtered)
    }
    request(t, router, http.MethodGet, "/api/v1/shares?status=invalid", ownerToken, nil, http.StatusBadRequest)
    request(t, router, http.MethodGet, "/api/v1/shares?cursor=-1", ownerToken, nil, http.StatusBadRequest)
    otherPage := request(t, router, http.MethodGet, "/api/v1/shares", otherToken, nil, http.StatusOK)
    if strings.Contains(otherPage.Body.String(), file.Name) { t.Fatal("other Owner read share") }
    sharePath := fmt.Sprintf("/api/v1/shares/%d/link", created.ID)
    request(t, router, http.MethodPost, sharePath, otherToken, strings.NewReader("{}"), http.StatusNotFound)
    first := request(t, router, http.MethodPost, sharePath, ownerToken, strings.NewReader("{}"), http.StatusOK)
    second := request(t, router, http.MethodPost, sharePath, ownerToken, strings.NewReader("{}"), http.StatusOK)
    var link1, link2 ownerShareLinkDTO
    if err := json.Unmarshal(first.Body.Bytes(), &link1); err != nil { t.Fatal(err) }
    if err := json.Unmarshal(second.Body.Bytes(), &link2); err != nil { t.Fatal(err) }
    if link1.Token != created.Token || link2.Token != created.Token ||
        link1.LegacyAlias || link2.LegacyAlias {
        t.Fatal("newly created share did not copy exactly the same capability")
    }
    if first.Header().Get("Cache-Control") != "private, no-store" ||
        first.Header().Get("Referrer-Policy") != "no-referrer" {
        t.Fatal("sensitive copy response lacks no-store/no-referrer")
    }

    var owner meta.User
    if err := db.Where("username = ?", "share-center-owner").First(&owner).Error; err != nil { t.Fatal(err) }
    legacyToken, legacyHash, err := generateShareToken()
    if err != nil { t.Fatal(err) }
    legacy := meta.Share{
        OwnerID: owner.ID, NodeID: file.ID, TokenHash: legacyHash, Access: shareAccessReadOnly,
    }
    if err := db.Create(&legacy).Error; err != nil { t.Fatal(err) }
    aliasPath := fmt.Sprintf("/api/v1/shares/%d/link", legacy.ID)
    aliasRes1 := request(t, router, http.MethodPost, aliasPath, ownerToken, strings.NewReader("{}"), http.StatusOK)
    aliasRes2 := request(t, router, http.MethodPost, aliasPath, ownerToken, strings.NewReader("{}"), http.StatusOK)
    var alias1, alias2 ownerShareLinkDTO
    if err := json.Unmarshal(aliasRes1.Body.Bytes(), &alias1); err != nil { t.Fatal(err) }
    if err := json.Unmarshal(aliasRes2.Body.Bytes(), &alias2); err != nil { t.Fatal(err) }
    if !alias1.LegacyAlias || !alias2.LegacyAlias || alias1.Token == legacyToken ||
        alias1.Token == "" || alias1.Token != alias2.Token {
        t.Fatalf("legacy copy changed or duplicated the primary URL")
    }
    publicShareRequest(t, router, http.MethodGet, legacyToken, nil, http.StatusOK)
    publicShareRequest(t, router, http.MethodGet, alias1.Token, nil, http.StatusOK)

    var after meta.Share
    if err := db.First(&after, legacy.ID).Error; err != nil { t.Fatal(err) }
    if after.TokenHash != legacyHash || after.LinkAliasHash == nil ||
        *after.LinkAliasHash != hashShareToken(alias1.Token) {
        t.Fatal("legacy original token was overwritten or alias missing")
    }

    // One Share identity controls both tokens. Revocation must invalidate both.
    request(t, router, http.MethodDelete, fmt.Sprintf("/api/v1/shares/%d", legacy.ID),
        ownerToken, nil, http.StatusNoContent)
    publicShareRequest(t, router, http.MethodGet, legacyToken, nil, http.StatusGone)
    publicShareRequest(t, router, http.MethodGet, alias1.Token, nil, http.StatusGone)
    request(t, router, http.MethodPost, aliasPath, ownerToken, strings.NewReader("{}"), http.StatusGone)
}
