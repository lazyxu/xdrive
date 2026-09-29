package synologyworker_test

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/api"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/connectorsecret"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/sourcecredential"
	"github.com/lazyxu/xdrive/internal/storage"
	"github.com/lazyxu/xdrive/internal/synology"
	"github.com/lazyxu/xdrive/internal/synologysync"
	"github.com/lazyxu/xdrive/internal/synologyworker"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type integrationRemote struct {
	folders       map[synology.Space][]synology.Folder
	items         map[synology.Space][]synology.Item
	albums        map[synology.Space][]synology.Album
	albumItems    map[synology.Space]map[int64][]synology.Item
	payloads      map[string][]byte
	downloadOpens int
	closed        bool
}

func (r *integrationRemote) Available(space synology.Space) bool {
	_, ok := r.items[space]
	return ok
}

func (r *integrationRemote) AlbumsAvailable(space synology.Space) bool {
	_, ok := r.albums[space]
	return ok
}

func (r *integrationRemote) ListAlbumsPage(_ context.Context, space synology.Space, offset, limit int) (synology.AlbumPage, error) {
	list := r.albums[space]
	if offset >= len(list) {
		return synology.AlbumPage{Offset: offset, Total: len(list)}, nil
	}
	end := offset + limit
	if end > len(list) {
		end = len(list)
	}
	page := append([]synology.Album(nil), list[offset:end]...)
	for i := range page {
		page[i].Space = space
	}
	return synology.AlbumPage{Offset: offset, Total: len(list), List: page}, nil
}

func (r *integrationRemote) ListAlbumItemsPage(_ context.Context, space synology.Space, albumID int64, offset, limit int) (synology.ItemPage, error) {
	list := r.albumItems[space][albumID]
	if offset >= len(list) {
		return synology.ItemPage{Offset: offset, Total: len(list)}, nil
	}
	end := offset + limit
	if end > len(list) {
		end = len(list)
	}
	page := append([]synology.Item(nil), list[offset:end]...)
	for i := range page {
		page[i].Space = space
	}
	return synology.ItemPage{Offset: offset, Total: len(list), List: page}, nil
}

func (r *integrationRemote) ListFoldersPage(_ context.Context, space synology.Space, offset, _ int) (synology.FolderPage, error) {
	list := r.folders[space]
	if offset != 0 {
		return synology.FolderPage{Offset: offset, Total: len(list)}, nil
	}
	return synology.FolderPage{Offset: 0, Total: len(list), List: append([]synology.Folder(nil), list...)}, nil
}

func (r *integrationRemote) ListItemsPage(_ context.Context, space synology.Space, offset, _ int) (synology.ItemPage, error) {
	list := append([]synology.Item(nil), r.items[space]...)
	for i := range list {
		list[i].Space = space
	}
	if offset != 0 {
		return synology.ItemPage{Offset: offset, Total: len(list)}, nil
	}
	return synology.ItemPage{Offset: 0, Total: len(list), List: list}, nil
}

func (r *integrationRemote) OpenItem(_ context.Context, item synology.Item, offset int64) (io.ReadCloser, error) {
	key := fmt.Sprintf("%s:%d", item.Space, item.ID)
	data, ok := r.payloads[key]
	if !ok {
		return nil, fmt.Errorf("missing payload for %s", key)
	}
	if offset < 0 || offset > int64(len(data)) {
		return nil, fmt.Errorf("invalid offset %d for %s", offset, key)
	}
	r.downloadOpens++
	return io.NopCloser(bytes.NewReader(data[offset:])), nil
}

func (r *integrationRemote) Close(context.Context) error {
	r.closed = true
	return nil
}

func TestRunnerScansAndSyncsEncryptedSynologyCredential(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not set")
	}
	baseDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "synology_worker_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.FileVersion{}, &meta.ContentBlob{}, &meta.ContentDigestAlias{},
		&meta.UploadSession{}, &meta.UploadPart{},
		&meta.Source{}, &meta.SourceItem{}, &meta.SyncRun{}, &meta.SourceRunFailure{}, &meta.SourceCredential{},
		&meta.SourceConnectorConfig{}, &meta.SourceItemMetadata{},
		&meta.SourceCollection{}, &meta.SourceCollectionItem{},
	); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_parent_name ON xd_nodes(owner_id, parent_id, lower(name)) WHERE parent_id IS NOT NULL AND deleted_at IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_nodes_root_owner ON xd_nodes(owner_id) WHERE parent_id IS NULL`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_xd_sources_owner_name ON xd_sources(owner_id, lower(name))`).Error; err != nil {
		t.Fatal(err)
	}

	owner := meta.User{Username: "synology-owner", PasswordHash: "unused", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{Name: "", Type: meta.NodeTypeDir, OwnerID: owner.ID, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "Synology Photos Pull", Kind: synologysync.SourceKind,
		Direction: meta.SourceDirectionPull, SyncMode: meta.SourceSyncModeBackup,
		RunMode: meta.SourceRunModeScan, Status: meta.SourceStatusActive,
		ScheduleType: "interval", ScheduleExpression: "6h",
		Revision: 1, TargetNodeID: &root.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.SourceConnectorConfig{
		SourceID: source.ID, Payload: `{"spaces":["shared","personal","personal"]}`, Revision: 1,
	}).Error; err != nil {
		t.Fatal(err)
	}

	keyring, err := connectorsecret.NewKeyring(1, map[uint32]string{1: strings.Repeat("11", 32)})
	if err != nil {
		t.Fatal(err)
	}
	if err := sourcecredential.Put(context.Background(), db, keyring, source,
		[]byte(`{"base_url":"https://nas.example","username":"alice","password":"secret"}`)); err != nil {
		t.Fatal(err)
	}

	store, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	jwtSecret := "synology-worker-integration-secret-long-enough"
	authManager := auth.New(jwtSecret, time.Hour)
	apiServer := &api.Server{
		DB: db, Store: store,
		Auth: authManager, RefreshTTL: time.Hour,
		AllowedOrigin: "http://localhost", MaxUploadBytes: 32 << 20,
	}
	httpServer := httptest.NewServer(apiServer.Router())
	defer httpServer.Close()

	personalPayload := bytes.Repeat([]byte("p"), 100)
	sharedPayload := bytes.Repeat([]byte("s"), 200)
	remote := &integrationRemote{
		folders: map[synology.Space][]synology.Folder{
			synology.SpacePersonal: {{ID: 10, Name: "Trips", Parent: 0}},
			synology.SpaceShared:   {{ID: 20, Name: "Family", Parent: 0}},
		},
		items: map[synology.Space][]synology.Item{
			synology.SpacePersonal: {{
				ID: 1, Filename: "IMG_0001.jpg", Filesize: int64(len(personalPayload)), FolderID: 10,
				IndexedTime: 1_700_000_000_000, OwnerUserID: 7, Time: 1_600_000_000,
			}},
			synology.SpaceShared: {{
				ID: 2, Filename: "shared.jpg", Filesize: int64(len(sharedPayload)), FolderID: 20,
				IndexedTime: 1_700_000_001_000, OwnerUserID: 8, Time: 1_600_000_001,
			}},
		},
		albums: map[synology.Space][]synology.Album{
			synology.SpacePersonal: {{
				ID: 101, Name: "Trips Album", Type: "normal", ItemCount: 1, CreateTime: 1_600_000_100,
			}},
			synology.SpaceShared: {{
				ID: 202, Name: "Family Album", Type: "normal", ItemCount: 1, CreateTime: 1_600_000_200, Shared: true,
			}},
		},
		albumItems: map[synology.Space]map[int64][]synology.Item{
			synology.SpacePersonal: {101: {{ID: 1}}},
			synology.SpaceShared:   {202: {{ID: 2}}},
		},
		payloads: map[string][]byte{
			"personal:1": personalPayload,
			"shared:2":   sharedPayload,
		},
	}
	runner := &synologyworker.Runner{
		DB: db, Keyring: keyring, ServerURL: httpServer.URL, JWTSecret: jwtSecret,
		RemoteFactory: func(_ context.Context, credential synology.Credential) (synologyworker.RemoteSession, error) {
			if credential.BaseURL != "https://nas.example" || credential.Username != "alice" || credential.Password != "secret" {
				return nil, fmt.Errorf("unexpected credential: %+v", credential)
			}
			return remote, nil
		},
	}

	scanRun, scanResult, err := runner.RunSource(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if scanRun.Status != meta.SyncRunStatusCompleted || scanRun.ScannedItems != 2 || scanRun.NewItems != 2 {
		t.Fatalf("unexpected scan run: %+v result=%+v", scanRun, scanResult)
	}
	if scanResult.PersonalItems != 1 || scanResult.SharedItems != 1 || remote.downloadOpens != 0 ||
		!scanResult.CollectionsComplete || scanResult.Albums != 2 || len(scanResult.Collections) != 2 {
		t.Fatalf("unexpected scan result=%+v download_opens=%d", scanResult, remote.downloadOpens)
	}
	var initialCollections []meta.SourceCollection
	if err := db.Where("source_id = ?", source.ID).Order("external_id ASC").Find(&initialCollections).Error; err != nil {
		t.Fatal(err)
	}
	if len(initialCollections) != 2 ||
		initialCollections[0].ExternalID != "synology:album:personal:101" ||
		initialCollections[1].ExternalID != "synology:album:shared:202" {
		t.Fatalf("initial collections=%+v", initialCollections)
	}
	initialPersonalCollectionID := initialCollections[0].ID
	initialSharedCollectionID := initialCollections[1].ID
	var initialMembershipCount int64
	if err := db.Model(&meta.SourceCollectionItem{}).Count(&initialMembershipCount).Error; err != nil {
		t.Fatal(err)
	}
	if initialMembershipCount != 2 {
		t.Fatalf("initial collection memberships=%d want=2", initialMembershipCount)
	}

	if err := db.Model(&meta.Source{}).Where("id = ?", source.ID).Update("run_mode", meta.SourceRunModeSync).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&source, source.ID).Error; err != nil {
		t.Fatal(err)
	}
	syncRun, syncResult, err := runner.RunSource(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if syncRun.Status != meta.SyncRunStatusCompleted || syncRun.CreatedItems != 2 ||
		syncRun.TransferredItems != 2 || syncRun.TransferredBytes != 300 {
		t.Fatalf("unexpected sync run: %+v result=%+v", syncRun, syncResult)
	}
	if remote.downloadOpens != 2 || !remote.closed {
		t.Fatalf("downloads=%d closed=%v", remote.downloadOpens, remote.closed)
	}

	token, err := authManager.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	cli := client.New(httpServer.URL, token)
	nodes, err := cli.Walk(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	personalNode, ok := nodes["Personal/Trips/IMG_0001.jpg"]
	if !ok {
		t.Fatalf("personal media missing or renamed unexpectedly: %+v", nodes)
	}
	sharedNode, ok := nodes["Shared/Family/shared.jpg"]
	if !ok {
		t.Fatalf("shared media missing or renamed unexpectedly: %+v", nodes)
	}
	if got := downloadNode(t, cli, personalNode.ID); !bytes.Equal(got, personalPayload) {
		t.Fatalf("personal content length=%d", len(got))
	}
	if got := downloadNode(t, cli, sharedNode.ID); !bytes.Equal(got, sharedPayload) {
		t.Fatalf("shared content length=%d", len(got))
	}

	var items []meta.SourceItem
	if err := db.Where("source_id = ?", source.ID).Order("external_id ASC").Find(&items).Error; err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("source items=%d want=2: %+v", len(items), items)
	}
	for _, item := range items {
		if item.State != meta.SourceItemStateSynced || item.NodeID == nil || strings.Contains(item.Path, " [") {
			t.Fatalf("unexpected committed item: %+v", item)
		}
	}

	// Rename the same remote item while keeping its stable Synology item ID and
	// revision, and remove the shared item. The next sync must perform a pure
	// move without reopening media, and mark the disappeared item missing
	// without deleting the already backed-up xDrive node.
	remote.items[synology.SpacePersonal][0].Filename = "IMG_RENAMED.jpg"
	remote.items[synology.SpaceShared] = nil
	remote.albums[synology.SpacePersonal][0].Name = "Trips Renamed"
	remote.albums[synology.SpaceShared] = nil
	downloadsBeforeReconcile := remote.downloadOpens
	reconcileRun, reconcileResult, err := runner.RunSource(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if reconcileRun.Status != meta.SyncRunStatusCompleted || reconcileRun.MovedItems != 1 || reconcileRun.MissingItems != 1 {
		t.Fatalf("unexpected reconcile run: %+v result=%+v", reconcileRun, reconcileResult)
	}
	if remote.downloadOpens != downloadsBeforeReconcile {
		t.Fatalf("pure rename reopened media: before=%d after=%d", downloadsBeforeReconcile, remote.downloadOpens)
	}
	nodes, err = cli.Walk(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := nodes["Personal/Trips/IMG_0001.jpg"]; ok {
		t.Fatalf("old Synology path still exists after move: %+v", nodes)
	}
	if _, ok := nodes["Personal/Trips/IMG_RENAMED.jpg"]; !ok {
		t.Fatalf("renamed Synology media missing: %+v", nodes)
	}
	if _, ok := nodes["Shared/Family/shared.jpg"]; !ok {
		t.Fatalf("missing remote item deleted backed-up xDrive node: %+v", nodes)
	}

	items = nil
	if err := db.Where("source_id = ?", source.ID).Order("external_id ASC").Find(&items).Error; err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("reconciled source items=%d want=2: %+v", len(items), items)
	}
	if items[0].ExternalID != "synology:personal:1" || items[0].State != meta.SourceItemStateSynced ||
		items[0].Path != "Personal/Trips/IMG_RENAMED.jpg" {
		t.Fatalf("renamed source item=%+v", items[0])
	}
	if items[1].ExternalID != "synology:shared:2" || items[1].State != meta.SourceItemStateMissing ||
		items[1].NodeID == nil {
		t.Fatalf("missing source item=%+v", items[1])
	}

	var reconciledCollections []meta.SourceCollection
	if err := db.Where("source_id = ?", source.ID).Order("external_id ASC").Find(&reconciledCollections).Error; err != nil {
		t.Fatal(err)
	}
	if len(reconciledCollections) != 2 {
		t.Fatalf("reconciled collections=%+v", reconciledCollections)
	}
	if reconciledCollections[0].ID != initialPersonalCollectionID ||
		reconciledCollections[0].Name != "Trips Renamed" ||
		reconciledCollections[0].State != meta.SourceCollectionStateActive {
		t.Fatalf("renamed personal collection=%+v", reconciledCollections[0])
	}
	if reconciledCollections[1].ID != initialSharedCollectionID ||
		reconciledCollections[1].State != meta.SourceCollectionStateMissing {
		t.Fatalf("missing shared collection=%+v", reconciledCollections[1])
	}
	var personalMembershipCount, sharedMembershipCount int64
	if err := db.Model(&meta.SourceCollectionItem{}).
		Where("collection_id = ?", initialPersonalCollectionID).
		Count(&personalMembershipCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&meta.SourceCollectionItem{}).
		Where("collection_id = ?", initialSharedCollectionID).
		Count(&sharedMembershipCount).Error; err != nil {
		t.Fatal(err)
	}
	if personalMembershipCount != 1 || sharedMembershipCount != 0 {
		t.Fatalf("reconciled memberships personal=%d shared=%d", personalMembershipCount, sharedMembershipCount)
	}
}

func downloadNode(t *testing.T, cli *client.Client, nodeID uint64) []byte {
	t.Helper()
	var out bytes.Buffer
	if err := cli.DownloadTo(context.Background(), nodeID, &out); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}
