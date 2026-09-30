package api

import (
	"context"
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
	"github.com/lazyxu/xdrive/internal/sourcecredential"
	"github.com/lazyxu/xdrive/internal/synology"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestSourceFileStationBrowseUsesStoredCredentialAndReturnsDirectoriesOnly(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(
		&meta.SourceCredential{}, &meta.Source{}, &meta.Node{}, &meta.RefreshToken{}, &meta.User{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&meta.User{}, &meta.RefreshToken{}, &meta.Node{}, &meta.Source{}, &meta.SourceCredential{},
	); err != nil {
		t.Fatal(err)
	}

	keyring, err := connectorsecret.NewKeyring(1, map[uint32]string{
		1: strings.Repeat("11", 32),
	})
	if err != nil {
		t.Fatal(err)
	}

	var browseCalls []struct {
		path   string
		offset int
		limit  int
	}
	server := &Server{
		DB:               db,
		Auth:             auth.New("source-browse-test-secret", time.Hour),
		RefreshTTL:       24 * time.Hour,
		AllowedOrigin:    "http://localhost",
		ConnectorSecrets: keyring,
		fileStationBrowse: func(
			_ context.Context,
			credential synology.Credential,
			remotePath string,
			offset int,
			limit int,
		) (synology.FileStationPage, error) {
			if credential.BaseURL != "https://nas.example.test:5001" ||
				credential.Username != "browse-user" || credential.Password != "browse-secret" {
				return synology.FileStationPage{}, fmt.Errorf("unexpected decrypted credential: %+v", credential)
			}
			browseCalls = append(browseCalls, struct {
				path   string
				offset int
				limit  int
			}{remotePath, offset, limit})
			switch remotePath {
			case "":
				return synology.FileStationPage{
					Offset: 0,
					Total:  5,
					Entries: []synology.FileStationEntry{
						{Name: "documents", Path: "/documents", IsDir: true},
						{Name: "root.txt", Path: "/root.txt", IsDir: false},
						{Name: "video", Path: "/video", IsDir: true},
					},
				}, nil
			case "/documents":
				return synology.FileStationPage{
					Offset: 3,
					Total:  5,
					Entries: []synology.FileStationEntry{
						{Name: "Projects", Path: "/documents/Projects", IsDir: true},
						{Name: "notes.txt", Path: "/documents/notes.txt", IsDir: false},
					},
				}, nil
			default:
				return synology.FileStationPage{}, fmt.Errorf("unexpected path %q", remotePath)
			}
		},
	}
	router := server.Router()

	tokenA := createTestUser(t, db, router, "browse-alice", "password-a")
	tokenB := createTestUser(t, db, router, "browse-bob", "password-b")
	var alice meta.User
	if err := db.Where("username = ?", "browse-alice").First(&alice).Error; err != nil {
		t.Fatal(err)
	}

	source := meta.Source{
		OwnerID:   alice.ID,
		Name:      "Synology Files",
		Kind:      synologyFilesSourceKind,
		Direction: meta.SourceDirectionPull,
		SyncMode:  meta.SourceSyncModeBackup,
		RunMode:   meta.SourceRunModeSync,
		Status:    meta.SourceStatusPaused,
		Revision:  1,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	credentialBytes, err := json.Marshal(synology.Credential{
		BaseURL:  "https://nas.example.test:5001",
		Username: "browse-user",
		Password: "browse-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := sourcecredential.Put(context.Background(), db, keyring, source, credentialBytes); err != nil {
		t.Fatal(err)
	}
	clear(credentialBytes)

	first := request(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/sources/%d/browse?limit=3", source.ID),
		tokenA, nil, http.StatusOK,
	)
	if strings.Contains(first.Body.String(), "browse-secret") {
		t.Fatal("browse response exposed source credential")
	}
	var page1 sourceBrowsePageDTO
	if err := json.Unmarshal(first.Body.Bytes(), &page1); err != nil {
		t.Fatal(err)
	}
	if page1.Path != "" || page1.Total != 5 || page1.NextOffset == nil || *page1.NextOffset != 3 {
		t.Fatalf("unexpected first browse page: %+v", page1)
	}
	if len(page1.Items) != 2 ||
		page1.Items[0].Path != "/documents" ||
		page1.Items[1].Path != "/video" {
		t.Fatalf("first browse page must contain directories only: %+v", page1.Items)
	}

	second := request(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/sources/%d/browse?path=%%2Fdocuments&offset=3&limit=2", source.ID),
		tokenA, nil, http.StatusOK,
	)
	var page2 sourceBrowsePageDTO
	if err := json.Unmarshal(second.Body.Bytes(), &page2); err != nil {
		t.Fatal(err)
	}
	if page2.Path != "/documents" || page2.Total != 5 || page2.NextOffset != nil {
		t.Fatalf("unexpected second browse page: %+v", page2)
	}
	if len(page2.Items) != 1 || page2.Items[0].Path != "/documents/Projects" {
		t.Fatalf("second browse page must contain directories only: %+v", page2.Items)
	}
	if len(browseCalls) != 2 ||
		browseCalls[0].path != "" || browseCalls[0].offset != 0 || browseCalls[0].limit != 3 ||
		browseCalls[1].path != "/documents" || browseCalls[1].offset != 3 || browseCalls[1].limit != 2 {
		t.Fatalf("unexpected browse calls: %+v", browseCalls)
	}

	request(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/sources/%d/browse", source.ID),
		tokenB, nil, http.StatusNotFound,
	)
	request(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/sources/%d/browse?path=%%2F", source.ID),
		tokenA, nil, http.StatusBadRequest,
	)
	request(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/sources/%d/browse?limit=1001", source.ID),
		tokenA, nil, http.StatusBadRequest,
	)

	missingCredential := meta.Source{
		OwnerID:   alice.ID,
		Name:      "Missing credential",
		Kind:      synologyFilesSourceKind,
		Direction: meta.SourceDirectionPull,
		SyncMode:  meta.SourceSyncModeBackup,
		RunMode:   meta.SourceRunModeSync,
		Status:    meta.SourceStatusPaused,
		Revision:  1,
	}
	if err := db.Create(&missingCredential).Error; err != nil {
		t.Fatal(err)
	}
	request(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/sources/%d/browse", missingCredential.ID),
		tokenA, nil, http.StatusConflict,
	)

	photos := meta.Source{
		OwnerID:   alice.ID,
		Name:      "Photos",
		Kind:      synologySourceKind,
		Direction: meta.SourceDirectionPull,
		SyncMode:  meta.SourceSyncModeBackup,
		RunMode:   meta.SourceRunModeSync,
		Status:    meta.SourceStatusPaused,
		Revision:  1,
	}
	if err := db.Create(&photos).Error; err != nil {
		t.Fatal(err)
	}
	request(
		t, router, http.MethodGet,
		fmt.Sprintf("/api/v1/sources/%d/browse", photos.ID),
		tokenA, nil, http.StatusBadRequest,
	)
}
