//go:build linux

package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/api"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/localbackupipc"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/secretstore"
	"github.com/lazyxu/xdrive/internal/storage"
	"github.com/lazyxu/xdrive/internal/synologyui"
	"github.com/lazyxu/xdrive/internal/userconfig"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// P0-0: unlike the isolated per-file uploader tests, this starts the ORIGINAL
// owning Agent's whole local Source batch. The test uses a disposable real
// PostgreSQL schema, LocalCAS, real native file descriptors and Server routes.
// No production NAS, remote Server credentials, second Runner or CAS writer.
// The DSM CGI's session/CSRF/Root binding is tested separately in synologyui.
func TestDSMFullOwningAgentSourceBatchRealSQLCASAndIncremental(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL service is required")
	}
	t.Setenv("XD_DISABLE_SECRET_SERVICE", "1")
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(t.TempDir(), "config"))

	adminDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	adminSQL, err := adminDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer adminSQL.Close()
	schema := "dsm_native_backup_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := adminDB.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	defer adminDB.Exec("DROP SCHEMA " + schema + " CASCADE")
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
	dbSQL, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer dbSQL.Close()
	if err := db.AutoMigrate(
		&meta.User{}, &meta.Node{}, &meta.File{}, &meta.Source{}, &meta.SyncRun{},
		&meta.SourceItem{}, &meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.LocalPushQuotaHold{}, &meta.UploadSession{}, &meta.UploadPart{},
		&meta.FileVersion{}, &meta.ContentBlob{}, &meta.Share{},
		&meta.AuditEvent{}, &meta.LocalPushStaging{},
		&meta.LocalPushOperationIntent{}, &meta.LocalPushOperationTerminalReceipt{},
		&meta.LocalPushOperationStageBinding{},
		&meta.LocalPushFirstLeafOperationCommit{}, &meta.LocalPushFileTerminal{},
		&meta.LocalPushNativeTerminalChallenge{},
		&meta.LocalPushCASPrepareIntent{}, &meta.LocalPushFirstDirectoryChallenge{},
		&meta.LocalPushCommonUploadOperation{},
	); err != nil {
		t.Fatal(err)
	}
	owner := meta.User{
		Username:     "dsm-e2e-" + strings.ReplaceAll(uuid.NewString(), "-", ""),
		PasswordHash: "fixture-only", Role: meta.UserRoleUser, SessionVersion: 1,
	}
	if err := db.Create(&owner).Error; err != nil {
		t.Fatal(err)
	}
	root := meta.Node{OwnerID: owner.ID, Name: "", Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&root).Error; err != nil {
		t.Fatal(err)
	}
	target := meta.Node{OwnerID: owner.ID, Name: "NAS backup",
		ParentID: &root.ID, Type: meta.NodeTypeDir, Revision: 1}
	if err := db.Create(&target).Error; err != nil {
		t.Fatal(err)
	}
	deviceID := uuid.NewString()
	deviceToken := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x45}, 32))
	digest := sha256.Sum256([]byte(deviceToken))
	device := meta.ClientDevice{ID: deviceID, OwnerID: owner.ID,
		Name: "DSM original Agent fixture", Platform: "linux",
		CredentialHash: hex.EncodeToString(digest[:])}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	source := meta.Source{
		OwnerID: owner.ID, Name: "NAS camera", Kind: meta.SourceKindLocalFolder,
		Direction: meta.SourceDirectionPush, SyncMode: meta.SourceSyncModeBackup,
		Status: meta.SourceStatusPaused, Revision: 7, TargetNodeID: &target.ID,
		LocalCreatorDeviceID: &deviceID,
	}
	// The manual first Source run arms the already-saved interval policy;
	// only the owning Agent scheduler may later admit incremental work.
	source.ScheduleType, source.ScheduleExpression = "interval", "1m"
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	localCAS, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	srv := &api.Server{DB: db, Store: localCAS,
		Auth:       auth.New("dsm-e2e-independent-local-server", time.Hour),
		RefreshTTL: time.Hour, MaxUploadBytes: 64 << 20}
	token, err := srv.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	var chunks, finalizes atomic.Int64
	// This switch models a genuinely unavailable Server while the original
	// NAS Source scheduler performs its authorized Owner-device discovery.
	// Never replace the Agent, uploader, PostgreSQL or LocalCAS in this test.
	var serverOffline atomic.Bool
	var offlineRequests atomic.Int64
	router := srv.Router()
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if serverOffline.Load() {
			offlineRequests.Add(1)
			http.Error(w, "disposable Server temporarily offline", http.StatusServiceUnavailable)
			return
		}
		if r.Method == http.MethodPut && strings.Contains(r.URL.Path, "/chunks/") {
			chunks.Add(1)
		}
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/finalize") {
			finalizes.Add(1)
		}
		router.ServeHTTP(w, r)
	}))
	defer remote.Close()

	originalDir := filepath.Join(t.TempDir(), "nas-photos")
	if err := os.MkdirAll(originalDir, 0o700); err != nil {
		t.Fatal(err)
	}
	alpha := bytes.Repeat([]byte("original-dsm-A-"), 128)
	bravo := bytes.Repeat([]byte("original-dsm-B-"), 131)
	for name, payload := range map[string][]byte{"alpha.bin": alpha, "bravo.bin": bravo} {
		if err := os.WriteFile(filepath.Join(originalDir, name), payload, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	grant, err := localpush.PrepareRootGrant(remote.URL, owner.Username, source.ID,
		deviceID, originalDir)
	if err != nil || !grant.StrongIdentity {
		t.Fatalf("strong NAS root proof unavailable: %+v %v", grant, err)
	}
	cfg := userconfig.Config{
		Server: remote.URL, Username: owner.Username, SessionID: uuid.NewString(),
	}
	if err := userconfig.Save(cfg); err != nil {
		t.Fatal(err)
	}
	configDir, err := userconfig.Dir()
	if err != nil {
		t.Fatal(err)
	}
	if err := secretstore.Save(configDir, cfg.SessionID, "DSM E2E owner", secretstore.Credentials{
		AccessToken: token, AccessExpiresAt: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	if err := localpush.SaveDeviceRegistration(configDir, cfg.Server, cfg.Username, deviceID); err != nil {
		t.Fatal(err)
	}
	if err := localpush.SaveDeviceToken(configDir, cfg.Server, cfg.Username, deviceID, deviceToken); err != nil {
		t.Fatal(err)
	}
	if err := localpush.SaveRootGrant(configDir, grant); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: owner.ID, DeviceID: deviceID,
		RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
	}).Error; err != nil {
		t.Fatal(err)
	}

	assertOriginal := func(name string, want []byte, revision uint64) {
		t.Helper()
		var node meta.Node
		if err := db.Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
			owner.ID, target.ID, name).Take(&node).Error; err != nil {
			t.Fatalf("cloud node missing for %s: %v", name, err)
		}
		if node.Revision != revision || node.Type != meta.NodeTypeFile {
			t.Fatalf("wrong original Node identity for %s: %+v", name, node)
		}
		var f meta.File
		if err := db.Where("node_id = ?", node.ID).Take(&f).Error; err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(want)
		if f.Size != int64(len(want)) || f.SHA256 != hex.EncodeToString(sum[:]) {
			t.Fatalf("cloud SQL bytes differ for %s: %+v", name, f)
		}
		reader, err := localCAS.Open(context.Background(), f.StorageKey)
		if err != nil {
			t.Fatal(err)
		}
		actual, readErr := io.ReadAll(reader)
		_ = reader.Close()
		if readErr != nil || !bytes.Equal(actual, want) {
			t.Fatalf("physical CAS mismatch for %s: %v", name, readErr)
		}
	}
	var lastChunk, lastFinalize, lastOperation, lastVersion int64
	assertCounters := func() {
		t.Helper()
		var ops, versions int64
		if err := db.Model(&meta.LocalPushCommonUploadOperation{}).
			Where("source_id = ?", source.ID).Count(&ops).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&meta.FileVersion{}).Count(&versions).Error; err != nil {
			t.Fatal(err)
		}
		lastChunk, lastFinalize, lastOperation, lastVersion =
			chunks.Load(), finalizes.Load(), ops, versions
	}
	// The DSM principal and the original Agent retain different authorities.
	// Run each generation through the actual same-origin CGI -> protected
	// loopback Agent IPC -> original Source worker -> Server SQL/CAS.
	if err := synologyui.Authorize(configDir, "dsmadmin"); err != nil {
		t.Fatal(err)
	}
	selector := strconv.FormatUint(source.ID, 10)
	origin := "https://nas.example:5001"
	run := func() localbackupipc.Summary {
		t.Helper()
		controller := &agentController{ctx: context.Background()}
		secret := make([]byte, 32)
		if _, err := rand.Read(secret); err != nil {
			t.Fatal(err)
		}
		bearer := hex.EncodeToString(secret)
		ipc := httptest.NewServer(newDesktopIPCHandler(controller, bearer, func() {}, true))
		defer ipc.Close()
		record, err := json.Marshal(desktopIPCDiscovery{
			Version: desktopIPCAPIVersion, BaseURL: ipc.URL, Token: bearer, PID: os.Getpid(),
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(configDir, desktopIPCDiscoveryName), record, 0600); err != nil {
			t.Fatal(err)
		}
		principal := "dsmadmin"
		bridge := synologyui.CGIHandler(&synologyui.Gateway{
			ConfigDir: configDir, HTTPS: true,
			Authenticate: func(context.Context) (string, error) { return principal, nil },
			Connect: func(ctx context.Context) (synologyui.Agent, error) {
				return localbackupipc.Connect(ctx, configDir)
			},
		})
		send := func(method, query, csrf string) *httptest.ResponseRecorder {
			request := httptest.NewRequest(method, origin+synologyui.DSMCGIPath+query, nil)
			request.Header.Set("Cookie", "id=dsm-session")
			if method == http.MethodPost {
				request.Header.Set("Origin", origin)
			}
			if csrf != "" {
				request.Header.Set("X-CSRF-Token", csrf)
			}
			reply := httptest.NewRecorder()
			bridge.ServeHTTP(reply, request)
			return reply
		}
		boot := send(http.MethodGet, "?op=bootstrap", "")
		var session map[string]string
		if boot.Code != http.StatusOK ||
			json.Unmarshal(boot.Body.Bytes(), &session) != nil ||
			len(session["csrf_token"]) != 64 ||
			strings.Contains(boot.Body.String(), bearer) {
			t.Fatalf("DSM session bootstrap failed: %d", boot.Code)
		}
		csrf := session["csrf_token"]
		beforeChunks, beforeFinalizes := chunks.Load(), finalizes.Load()
		if send(http.MethodPost, "?op=run&source_id="+selector, "").Code != http.StatusForbidden {
			t.Fatal("missing DSM CSRF admitted native CAS backup")
		}
		principal = "other-dsm-user"
		if send(http.MethodPost, "?op=run&source_id="+selector, csrf).Code != http.StatusForbidden {
			t.Fatal("foreign DSM principal admitted native CAS backup")
		}
		principal = "dsmadmin"
		if send(http.MethodPost, "?op=run&source_id="+strconv.FormatUint(source.ID+1, 10), csrf).Code != http.StatusForbidden {
			t.Fatal("unbound local Source admitted by DSM")
		}
		if chunks.Load() != beforeChunks || finalizes.Load() != beforeFinalizes {
			t.Fatal("denied DSM operation mutated original CAS")
		}
		sources := send(http.MethodGet, "?op=sources", "")
		if sources.Code != http.StatusOK ||
			!strings.Contains(sources.Body.String(), "\"source_id\":"+selector) ||
			strings.Contains(sources.Body.String(), originalDir) ||
			strings.Contains(sources.Body.String(), bearer) {
			t.Fatalf("DSM current Agent Source list unavailable or leaked: HTTP %d", sources.Code)
		}
		ack := send(http.MethodPost, "?op=run&source_id="+selector, csrf)
		var accepted localbackupipc.Summary
		if ack.Code != http.StatusOK ||
			json.Unmarshal(ack.Body.Bytes(), &accepted) != nil ||
			!localbackupipc.ValidateSummary(accepted, source.ID) {
			t.Fatalf("real DSM CGI could not start native Source batch: %d %s", ack.Code, ack.Body.String())
		}
		deadline := time.Now().Add(75 * time.Second)
		for time.Now().Before(deadline) {
			reply := send(http.MethodGet, "?op=status&source_id="+selector, "")
			var result localbackupipc.Summary
			if reply.Code != http.StatusOK ||
				json.Unmarshal(reply.Body.Bytes(), &result) != nil ||
				!localbackupipc.ValidateSummary(result, source.ID) {
				t.Fatalf("DSM cannot inspect original Agent progress: %d %s", reply.Code, reply.Body.String())
			}
			if result.Running {
				time.Sleep(25 * time.Millisecond)
				continue
			}
			if result.Revision != source.Revision || result.State != "partial" ||
				result.UncertainFiles != 0 || result.BackupComplete ||
				result.RetirementSafe || result.CurrentCASVerified {
				t.Fatalf("DSM falsely completed or lost Source batch: %+v", result)
			}
			historyReply := send(http.MethodGet, "?op=history&source_id="+selector, "")
			var history localbackupipc.HistoryPage
			if historyReply.Code != http.StatusOK ||
				json.Unmarshal(historyReply.Body.Bytes(), &history) != nil ||
				!localbackupipc.ValidateHistory(history, source.ID) {
				t.Fatalf("DSM original Agent history unavailable: %d %s", historyReply.Code, historyReply.Body.String())
			}
			matched := false
			for _, item := range history.Items {
				if item.Revision == result.Revision && item.State == result.State &&
					item.ConfirmedFiles == result.ConfirmedFiles &&
					item.SkippedFiles == result.SkippedFiles &&
					item.ConfirmedBytes == result.ConfirmedBytes {
					matched = true
					break
				}
			}
			if !matched || strings.Contains(historyReply.Body.String(), originalDir) ||
				strings.Contains(historyReply.Body.String(), bearer) {
				t.Fatal("DSM did not return matching redacted Source receipt")
			}
			return result
		}
		t.Fatal("DSM-authenticated Agent Source batch timed out")
		return localbackupipc.Summary{}
	}

	first := run()
	if first.ConfirmedFiles != 2 || first.InspectedFiles != 2 || first.SkippedFiles != 0 ||
		first.ConfirmedBytes != int64(len(alpha)+len(bravo)) {
		t.Fatalf("original first NAS Source batch did not upload both bytes: %+v", first)
	}
	assertOriginal("alpha.bin", alpha, 1)
	assertOriginal("bravo.bin", bravo, 1)
	assertCounters()
	if lastChunk == 0 || lastFinalize == 0 || lastOperation != 2 {
		t.Fatalf("first NAS Agent batch had no physical transport: chunks=%d finalize=%d ops=%d",
			lastChunk, lastFinalize, lastOperation)
	}
	second := run()
	if second.ConfirmedFiles != 0 || second.SkippedFiles != 2 ||
		second.InspectedFiles != 2 || second.ConfirmedBytes != 0 {
		t.Fatalf("unchanged NAS Source did not skip current SQL/CAS bytes: %+v", second)
	}
	oldChunk, oldFinalize, oldOp, oldVersion := lastChunk, lastFinalize, lastOperation, lastVersion
	assertCounters()
	if lastChunk != oldChunk || lastFinalize != oldFinalize ||
		lastOperation != oldOp || lastVersion != oldVersion {
		t.Fatalf("unchanged Source minted duplicate writes: chunks %d->%d finalize %d->%d ops %d->%d versions %d->%d",
			oldChunk, lastChunk, oldFinalize, lastFinalize,
			oldOp, lastOperation, oldVersion, lastVersion)
	}
	updated := bytes.Repeat([]byte("new-native-A-content-"), 221)
	if err := os.WriteFile(filepath.Join(originalDir, "alpha.bin"), updated, 0o600); err != nil {
		t.Fatal(err)
	}
	third := run()
	if third.ConfirmedFiles != 1 || third.SkippedFiles != 1 ||
		third.InspectedFiles != 2 || third.ConfirmedBytes != int64(len(updated)) {
		t.Fatalf("modified NAS Source did not create one new version: %+v", third)
	}
	assertOriginal("alpha.bin", updated, 2)
	assertOriginal("bravo.bin", bravo, 1)
	assertCounters()
	if lastOperation != oldOp+1 || lastVersion != oldVersion+1 ||
		lastChunk <= oldChunk || lastFinalize <= oldFinalize {
		t.Fatalf("updated NAS original did not advance one SQL/CAS FileVersion")
	}
	// A fresh Agent reads the terminal checkpoint instead of claiming an
	// in-memory 'completed backup' or silently discarding the prior history.
	fresh := &agentController{ctx: context.Background()}
	status, err := fresh.CloudLocalBoundBackupCommonBatchStatus(context.Background(), source.ID)
	if err != nil || status.State != "partial" || status.Running ||
		status.ConfirmedFiles != 1 || status.SkippedFiles != 1 ||
		status.BackupComplete || status.RetirementSafe || status.CurrentCASVerified {
		t.Fatalf("restarted owning Agent misread verified Source snapshot: %+v %v", status, err)
	}
	unchangedAgain := run()
	if unchangedAgain.ConfirmedFiles != 0 || unchangedAgain.SkippedFiles != 2 {
		t.Fatalf("restart re-uploaded already committed originals: %+v", unchangedAgain)
	}
	// P0-0 scheduled incremental verification. The earlier manual CGI run
	// persisted a verified partial checkpoint for this owning Root. A saved
	// one-minute interval must NOT start early, and a due tick must use the
	// SAME original Agent and immutable Server SQL/CAS writer (not a second
	// DSM transfer queue). A fresh controller models Agent restart.
	scheduledB := bytes.Repeat([]byte("scheduled-native-B-revision-"), 181)
	if err := os.WriteFile(filepath.Join(originalDir, "bravo.bin"), scheduledB, 0o600); err != nil {
		t.Fatal(err)
	}
	// The timer (not an explicit DSM GUI/manual POST) must also discover new
	// nested NAS folders and commit their first original in the same batch.
	scheduledNewRoot := filepath.Join(originalDir, "auto-album", "summer")
	if err := os.MkdirAll(scheduledNewRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	scheduledNew := bytes.Repeat([]byte("scheduled-new-nested-original-"), 181)
	if err := os.WriteFile(filepath.Join(scheduledNewRoot, "delta.bin"), scheduledNew, 0o600); err != nil {
		t.Fatal(err)
	}
	assertCounters()
	chunksBeforeSchedule, finalizesBeforeSchedule := lastChunk, lastFinalize
	opsBeforeSchedule, versionsBeforeSchedule := lastOperation, lastVersion
	scheduler := &agentController{ctx: context.Background()}
	attempts := make(map[string]time.Time)
	early := time.Now().UTC()
	if err := scheduler.localPushAutoTick(context.Background(), early, attempts); err != nil {
		t.Fatalf("owning scheduled Source discovery failed before due: %v", err)
	}
	scheduler.localCommonBatchJobMu.Lock()
	earlyJob := scheduler.localCommonBatchJob
	scheduler.localCommonBatchJobMu.Unlock()
	if earlyJob != nil || chunks.Load() != chunksBeforeSchedule ||
		finalizes.Load() != finalizesBeforeSchedule {
		t.Fatal("not-yet-due NAS interval scheduled a physical upload")
	}
	// The due clock is injected only into the scheduler; the real Root
	// inventory, native file bytes and Server SQL/CAS time remain untouched.
	due := early.Add(2 * time.Minute)
	// At the due instant the Server may be offline. The Agent must not
	// consume its scheduled admission, create a job or fabricate a successful
	// original receipt. Reconnect at the same due clock and recover through
	// the existing Agent, with no GUI/CLI manual run or second CAS writer.
	serverOffline.Store(true)
	if err := scheduler.localPushAutoTick(context.Background(), due, attempts); err == nil {
		t.Fatal("offline NAS scheduled discovery incorrectly succeeded")
	}
	serverOffline.Store(false)
	scheduler.localCommonBatchJobMu.Lock()
	offlineJob := scheduler.localCommonBatchJob
	scheduler.localCommonBatchJobMu.Unlock()
	if offlineRequests.Load() == 0 || offlineJob != nil || len(attempts) != 0 {
		t.Fatalf("offline scheduler admitted a job without a verified Server: requests=%d job=%v attempts=%d",
			offlineRequests.Load(), offlineJob != nil, len(attempts))
	}
	assertCounters()
	if lastChunk != chunksBeforeSchedule || lastFinalize != finalizesBeforeSchedule ||
		lastOperation != opsBeforeSchedule || lastVersion != versionsBeforeSchedule {
		t.Fatal("offline discovery wrote CAS chunks, finalized an upload or changed SQL receipts")
	}
	// Existing saved policy remains due after the transient Server failure.
	// Automatic recovery, not a second manual DSM SourceRun, must commit B
	// and the new nested original through the ordinary operation queue.
	if err := scheduler.localPushAutoTick(context.Background(), due, attempts); err != nil {
		t.Fatalf("reconnected due NAS scheduler did not resume: %v", err)
	}
	scheduler.localCommonBatchJobMu.Lock()
	job := scheduler.localCommonBatchJob
	scheduler.localCommonBatchJobMu.Unlock()
	if job == nil {
		t.Fatal("due native Source did not enter the original owning Agent")
	}
	select {
	case <-job.done:
	case <-time.After(75 * time.Second):
		t.Fatal("scheduled native Agent did not finish its SQL/CAS operation")
	}
	scheduled := localCommonBatchObservedResult(job)
	if job.err != nil || scheduled.SourceID != source.ID ||
		scheduled.Revision != source.Revision || scheduled.State != "partial" ||
		scheduled.Running || scheduled.ConfirmedFiles != 2 ||
		scheduled.SkippedFiles != 1 || scheduled.InspectedFiles != 3 ||
		scheduled.ConfirmedBytes != int64(len(scheduledB)+len(scheduledNew)) ||
		scheduled.UncertainFiles != 0 || scheduled.BackupComplete ||
		scheduled.RetirementSafe || scheduled.CurrentCASVerified {
		t.Fatalf("scheduled run misreported original SQL receipts: %+v %v", scheduled, job.err)
	}
	assertOriginal("alpha.bin", updated, 2)
	assertOriginal("bravo.bin", scheduledB, 2)
	// Newly discovered scheduled files must have the exact nested cloud
	// ancestry and physical CAS original, with no invented prior revision.
	scheduledParentID := target.ID
	for _, name := range []string{"auto-album", "summer"} {
		var folder meta.Node
		if err := db.Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
			owner.ID, scheduledParentID, name).Take(&folder).Error; err != nil {
			t.Fatalf("scheduled NAS directory %s missing: %v", name, err)
		}
		if folder.Type != meta.NodeTypeDir {
			t.Fatalf("scheduled NAS directory %s is not a folder: %+v", name, folder)
		}
		scheduledParentID = folder.ID
	}
	var scheduledNewNode meta.Node
	if err := db.Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
		owner.ID, scheduledParentID, "delta.bin").Take(&scheduledNewNode).Error; err != nil {
		t.Fatalf("scheduled NAS nested original missing: %v", err)
	}
	if scheduledNewNode.Type != meta.NodeTypeFile || scheduledNewNode.Revision != 1 {
		t.Fatalf("scheduled NAS nested original has wrong identity: %+v", scheduledNewNode)
	}
	var scheduledNewRecord meta.File
	if err := db.Where("node_id = ?", scheduledNewNode.ID).Take(&scheduledNewRecord).Error; err != nil {
		t.Fatal(err)
	}
	scheduledSHA := sha256.Sum256(scheduledNew)
	if scheduledNewRecord.Size != int64(len(scheduledNew)) ||
		scheduledNewRecord.SHA256 != hex.EncodeToString(scheduledSHA[:]) {
		t.Fatalf("scheduled NAS nested SQL original differs: %+v", scheduledNewRecord)
	}
	scheduledReader, err := localCAS.Open(context.Background(), scheduledNewRecord.StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	scheduledBytes, readErr := io.ReadAll(scheduledReader)
	_ = scheduledReader.Close()
	if readErr != nil || !bytes.Equal(scheduledBytes, scheduledNew) {
		t.Fatalf("scheduled NAS nested CAS bytes differ: %v", readErr)
	}
	var scheduledHistoricalVersions int64
	if err := db.Model(&meta.FileVersion{}).Where("node_id = ?", scheduledNewNode.ID).
		Count(&scheduledHistoricalVersions).Error; err != nil || scheduledHistoricalVersions != 0 {
		t.Fatalf("new scheduled NAS original invented historical versions: count=%d err=%v",
			scheduledHistoricalVersions, err)
	}
	assertCounters()
	if lastOperation != opsBeforeSchedule+2 ||
		lastVersion != versionsBeforeSchedule+1 ||
		lastChunk <= chunksBeforeSchedule ||
		lastFinalize <= finalizesBeforeSchedule {
		t.Fatal("scheduled update and new nested original did not commit two SQL/CAS operations")
	}
	// A repeated wake-up with the same attempt must respect the existing
	// durable cooldown and never fabricate a second physical upload.
	if err := scheduler.localPushAutoTick(context.Background(), due.Add(5*time.Second), attempts); err != nil {
		t.Fatalf("repeated owning scheduler tick failed: %v", err)
	}
	assertCounters()
	if lastOperation != opsBeforeSchedule+2 ||
		lastVersion != versionsBeforeSchedule+1 {
		t.Fatal("repeated scheduler tick wrote duplicate original SQL operations")
	}

	// A later new nested NAS path must enter the SAME original SourceRun,
	// preserve its directory hierarchy and create a new original, not
	// rewrite either existing file or invent a prior FileVersion.
	nestedRoot := filepath.Join(originalDir, "new-album", "winter")
	if err := os.MkdirAll(nestedRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	newOriginal := bytes.Repeat([]byte("new-nested-native-file-"), 181)
	if err := os.WriteFile(filepath.Join(nestedRoot, "charlie.bin"), newOriginal, 0o600); err != nil {
		t.Fatal(err)
	}
	beforeNewOperations, beforeNewVersions := lastOperation, lastVersion
	beforeNewChunks, beforeNewFinalizes := lastChunk, lastFinalize
	added := run()
	if added.InspectedFiles != 4 || added.ConfirmedFiles != 1 ||
		added.SkippedFiles != 3 || added.ConfirmedBytes != int64(len(newOriginal)) {
		t.Fatalf("new nested native file did not enter incremental backup: %+v", added)
	}
	cloudParentID := target.ID
	for _, name := range []string{"new-album", "winter"} {
		var folder meta.Node
		if err := db.Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
			owner.ID, cloudParentID, name).Take(&folder).Error; err != nil {
			t.Fatalf("native directory %s was not preserved in cloud: %v", name, err)
		}
		if folder.Type != meta.NodeTypeDir {
			t.Fatalf("native directory %s has incorrect cloud type: %s", name, folder.Type)
		}
		cloudParentID = folder.ID
	}
	var nestedFile meta.Node
	if err := db.Where("owner_id = ? AND parent_id = ? AND name = ? AND deleted_at IS NULL",
		owner.ID, cloudParentID, "charlie.bin").Take(&nestedFile).Error; err != nil {
		t.Fatalf("incremental nested file missing in cloud: %v", err)
	}
	if nestedFile.Type != meta.NodeTypeFile || nestedFile.Revision != 1 {
		t.Fatalf("new nested file did not preserve its original revision: %+v", nestedFile)
	}
	var nestedRecord meta.File
	if err := db.Where("node_id = ?", nestedFile.ID).Take(&nestedRecord).Error; err != nil {
		t.Fatal(err)
	}
	newSHA := sha256.Sum256(newOriginal)
	if nestedRecord.Size != int64(len(newOriginal)) ||
		nestedRecord.SHA256 != hex.EncodeToString(newSHA[:]) {
		t.Fatalf("nested original SQL digest or size changed: %+v", nestedRecord)
	}
	originalReader, err := localCAS.Open(context.Background(), nestedRecord.StorageKey)
	if err != nil {
		t.Fatal(err)
	}
	casBytes, readErr := io.ReadAll(originalReader)
	_ = originalReader.Close()
	if readErr != nil || !bytes.Equal(casBytes, newOriginal) {
		t.Fatalf("new nested NAS original CAS bytes differ: %v", readErr)
	}
	assertOriginal("alpha.bin", updated, 2)
	assertOriginal("bravo.bin", scheduledB, 2)
	assertCounters()
	if lastOperation != beforeNewOperations+1 || lastVersion != beforeNewVersions ||
		lastChunk <= beforeNewChunks || lastFinalize <= beforeNewFinalizes {
		t.Fatal("new nested Source item was not a single new original SQL/CAS operation")
	}
}
