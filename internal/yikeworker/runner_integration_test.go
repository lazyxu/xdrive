package yikeworker_test

import (
	"context"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/api"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourcecredential"
	"github.com/lazyxu/xdrive/internal/yike"
	"github.com/lazyxu/xdrive/internal/yikesync"
	"github.com/lazyxu/xdrive/internal/yikeworker"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type integrationRemote struct {
	files      []yike.File
	albums     []yike.Album
	albumFiles map[string][]yike.AlbumFile
}

func (r *integrationRemote) UserInfo(context.Context) (yike.UserInfo, error) {
	return yike.UserInfo{YouaID: "123"}, nil
}

func (r *integrationRemote) ListFilesPage(_ context.Context, cursor string) (yike.FileList, error) {
	if cursor != "" {
		return yike.FileList{}, fmt.Errorf("unexpected root cursor %q", cursor)
	}
	return yike.FileList{Page: yike.Page{HasMore: 0}, List: append([]yike.File(nil), r.files...)}, nil
}

func (r *integrationRemote) ListAlbumsPage(_ context.Context, cursor string) (yike.AlbumList, error) {
	if cursor != "" {
		return yike.AlbumList{}, fmt.Errorf("unexpected album cursor %q", cursor)
	}
	return yike.AlbumList{Page: yike.Page{HasMore: 0}, List: append([]yike.Album(nil), r.albums...)}, nil
}

func (r *integrationRemote) ListAlbumFilesPage(_ context.Context, albumID, cursor string) (yike.AlbumFileList, error) {
	if cursor != "" {
		return yike.AlbumFileList{}, fmt.Errorf("unexpected album-file cursor %q", cursor)
	}
	return yike.AlbumFileList{
		Page: yike.Page{HasMore: 0},
		List: append([]yike.AlbumFile(nil), r.albumFiles[albumID]...),
	}, nil
}

func TestRunnerScansEncryptedYikeCredentialAndMarksMissing(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "yike_worker_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := baseDB.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = baseDB.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error
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
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.Source{}, &meta.SourceItem{},
		&meta.SyncRun{}, &meta.SourceCredential{},
	); err != nil {
		t.Fatal(err)
	}

	owner := meta.User{
		Username: "yike-owner", PasswordHash: "not-used",
		Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Yike Photos", Kind: yikesync.SourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive,
		Revision: 1, TargetNodeID: &root.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	keyring, err := connectorsecret.NewKeyring(1, map[uint32]string{
		1: strings.Repeat("11", 32),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := sourcecredential.Put(context.Background(), db, keyring, source,
		[]byte("{\"cookie\":\"BDUSS=integration-cookie\"}")); err != nil {
		t.Fatal(err)
	}

	jwtSecret := "yike-worker-integration-secret-that-is-long-enough"
	apiServer := &api.Server{
		DB:            db,
		Auth:          auth.New(jwtSecret, time.Hour),
		RefreshTTL:    time.Hour,
		AllowedOrigin: "http://localhost",
	}
	httpServer := httptest.NewServer(apiServer.Router())
	defer httpServer.Close()

	remote := &integrationRemote{
		files: []yike.File{
			{FSID: 1, Path: "/root.jpg", Size: 100, MTime: 1000, MD5: "aaaa"},
		},
		albums: []yike.Album{{AlbumID: "shared", Title: "Shared"}},
		albumFiles: map[string][]yike.AlbumFile{
			"shared": {
				{File: yike.File{FSID: 1, Path: "/root.jpg", Size: 100, MTime: 1000, MD5: "aaaa"}, AlbumID: "shared", UK: 123},
				{File: yike.File{FSID: 2, Path: "/shared.jpg", Size: 200, MTime: 2000}, AlbumID: "shared", UK: 999},
			},
		},
	}
	runner := &yikeworker.Runner{
		DB: db, Keyring: keyring, ServerURL: httpServer.URL, JWTSecret: jwtSecret,
		RemoteFactory: func(cookie string) (yikesync.Remote, error) {
			if cookie != "BDUSS=integration-cookie" {
				return nil, fmt.Errorf("unexpected cookie %q", cookie)
			}
			return remote, nil
		},
	}

	run1, result1, err := runner.RunSource(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}

	var refreshedSource meta.Source
	if err := db.First(&refreshedSource, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshedSource.LastRunAt == nil {
		t.Fatal("source last_run_at was not updated by source run")
	}
	notDue, err := runner.RunDue(context.Background(), refreshedSource.LastRunAt.Add(time.Minute), 6*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if notDue.Eligible != 0 || notDue.Completed != 0 || notDue.Failed != 0 {
		t.Fatalf("recent source was unexpectedly due: %+v", notDue)
	}
	if run1.Status != meta.SyncRunStatusCompleted ||
		run1.ScannedItems != 2 || run1.NewItems != 2 || run1.PlannedTransferBytes != 300 {
		t.Fatalf("unexpected first run: %+v result=%+v", run1, result1)
	}
	if result1.DuplicateMemberships != 1 || result1.SharedItems != 1 {
		t.Fatalf("unexpected first discovery result: %+v", result1)
	}
	var items []meta.SourceItem
	if err := db.Where("source_id = ?", source.ID).Order("external_id ASC").Find(&items).Error; err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("source items=%d want=2: %+v", len(items), items)
	}

	remote.albumFiles["shared"] = []yike.AlbumFile{
		{File: yike.File{FSID: 1, Path: "/root.jpg", Size: 100, MTime: 1000, MD5: "aaaa"}, AlbumID: "shared", UK: 123},
	}
	run2, _, err := runner.RunSource(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if run2.Status != meta.SyncRunStatusCompleted || run2.MissingItems != 1 {
		t.Fatalf("unexpected second run: %+v", run2)
	}
	var missing meta.SourceItem
	if err := db.Where("source_id = ? AND external_id = ?", source.ID, "yike:999:2").First(&missing).Error; err != nil {
		t.Fatal(err)
	}
	if missing.State != meta.SourceItemStateMissing {
		t.Fatalf("shared item state=%q want missing", missing.State)
	}

	if err := sourcecredential.Delete(context.Background(), db, source.ID); err != nil {
		t.Fatal(err)
	}
	report, err := runner.RunAll(context.Background())
	if err == nil {
		t.Fatal("missing credential cycle unexpectedly succeeded")
	}
	if report.Eligible != 1 || report.Failed != 1 || report.Completed != 0 {
		t.Fatalf("missing credential report=%+v", report)
	}
	var latest meta.SyncRun
	if err := db.Where("source_id = ?", source.ID).Order("started_at DESC").First(&latest).Error; err != nil {
		t.Fatal(err)
	}
	if latest.Status != meta.SyncRunStatusFailed || !strings.Contains(latest.Error, "credential is not configured") {
		t.Fatalf("missing credential run=%+v", latest)
	}

	if err := sourcecredential.Put(context.Background(), db, keyring, source,
		[]byte("{\"cookie\":\"BDUSS=integration-cookie\"}")); err != nil {
		t.Fatal(err)
	}
	staleSource := source
	if err := db.Model(&meta.Source{}).Where("id = ?", source.ID).
		Update("run_mode", meta.SourceRunModeSync).Error; err != nil {
		t.Fatal(err)
	}
	run3, _, err := runner.RunSource(context.Background(), staleSource)
	if err == nil {
		t.Fatal("run-mode race unexpectedly succeeded")
	}
	if run3.Status != meta.SyncRunStatusFailed || !strings.Contains(run3.Error, "sync execution is not enabled") {
		t.Fatalf("run-mode race result=%+v err=%v", run3, err)
	}

	if err := db.Model(&meta.Source{}).Where("id = ?", source.ID).
		Update("run_mode", meta.SourceRunModeScan).Error; err != nil {
		t.Fatal(err)
	}
	disabledAt := time.Now().UTC()
	if err := db.Model(&meta.User{}).Where("id = ?", owner.ID).
		Update("disabled_at", disabledAt).Error; err != nil {
		t.Fatal(err)
	}
	attemptStarted := time.Now().UTC()
	report, err = runner.RunAll(context.Background())
	if err == nil {
		t.Fatal("disabled-owner cycle unexpectedly succeeded")
	}
	if report.Eligible != 1 || report.Failed != 1 {
		t.Fatalf("disabled-owner report=%+v", report)
	}
	var throttled meta.Source
	if err := db.First(&throttled, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	if throttled.LastRunAt == nil || throttled.LastRunAt.Before(attemptStarted) ||
		!strings.Contains(throttled.LastError, "owner account is disabled") {
		t.Fatalf("preflight failure was not throttled: %+v", throttled)
	}
}
