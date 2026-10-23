//go:build linux || windows

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/client"
	"github.com/lazyxu/xdrive/internal/localpush"
	"github.com/lazyxu/xdrive/internal/localpushcommon"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

const commonNativeCrashChildEnv = "XDRIVE_TEST_LOCAL_COMMON_CRASH_CHILD"

type commonNativeCrashInput struct {
	ServerURL    string
	Account      string
	RootID       string
	ConfigDir    string
	OwnerJWT     string
	DeviceToken  string
	SourceRev    uint64
	SnapshotSHA  string
	RelativePath string
	TargetID     uint64
}

// The helper runs in a real, separately killable Agent-shaped OS process.
// Test credentials enter through one-shot stdin rather than argv or a
// persistent journal, and no real account or production endpoint is used.
func TestLocalPushCommonNativeCrashChild(t *testing.T) {
	if os.Getenv(commonNativeCrashChildEnv) != "1" {
		t.Skip("native child helper is deliberately unrouted")
	}
	var in commonNativeCrashInput
	if err := json.NewDecoder(os.Stdin).Decode(&in); err != nil {
		t.Fatal(err)
	}
	grant, err := localpush.LoadRootGrant(in.ConfigDir, in.ServerURL, in.Account, in.RootID)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	plan, err := localpush.PrepareVerifiedCommonUploadPlan(
		ctx, in.ConfigDir, grant, in.OwnerJWT, in.SourceRev,
		in.SnapshotSHA, in.RelativePath,
		localpushcommon.Target{ParentID: in.TargetID, Name: in.RelativePath})
	if err != nil {
		t.Fatal(err)
	}
	proof := client.LocalBoundSourceProof{
		DeviceID: grant.DeviceID, DeviceToken: in.DeviceToken,
		RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
	}
	receipt, err := localpush.UploadVerifiedCommonNativeOne(
		ctx, in.ConfigDir, grant, in.SnapshotSHA, plan,
		client.New(in.ServerURL, in.OwnerJWT), proof, nil)
	if err != nil || !receipt.Committed || receipt.OperationID != plan.OperationID ||
		receipt.NodeID == 0 || receipt.ContentSHA256 != plan.ContentSHA256 {
		t.Fatalf("original child Operation was not replayed: committed=%t err=%v", receipt.Committed, err)
	}
	fmt.Printf("LOCAL_COMMON_CRASH_REPLAY_COMMITTED=%s\n", receipt.OperationID)
}

// A genuine SQL/CAS COMMIT without its HTTP ACK must replay only the original
// immutable receipt after the native uploader process is killed.
func TestLocalPushCommonActualProcessKillAfterSQLCommitReplay(t *testing.T) {
	runLocalPushCommonActualProcessKillReplay(t, false)
}

// If the first HTTP admission committed its RESERVED operation but its ACK
// was lost, a new native process must resume that SAME journaled Operation.
// No chunk, binding or Finalize is allowed before the first process dies.
func TestLocalPushCommonActualProcessKillBeforeAdmissionACKReplay(t *testing.T) {
	runLocalPushCommonActualProcessKillReplay(t, true)
}

func runLocalPushCommonActualProcessKillReplay(t *testing.T, crashBeforeAdmitACK bool) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(
		&meta.ClientDevice{}, &meta.LocalSourceBinding{},
		&meta.UploadSession{}, &meta.UploadPart{}, &meta.FileVersion{},
		&meta.ContentBlob{}, &meta.Share{}, &meta.AuditEvent{},
		&meta.LocalPushStaging{}, &meta.LocalPushOperationIntent{},
		&meta.LocalPushOperationTerminalReceipt{},
		&meta.LocalPushOperationStageBinding{}, &meta.LocalPushFirstLeafOperationCommit{},
		&meta.LocalPushFileTerminal{}, &meta.LocalPushNativeTerminalChallenge{},
		&meta.LocalPushCASPrepareIntent{}, &meta.LocalPushFirstDirectoryChallenge{},
		&meta.LocalPushCommonUploadOperation{},
	); err != nil {
		t.Fatal(err)
	}
	localCAS, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server.Store = localCAS
	server.Auth = auth.New("isolated-native-process-kill-original-replay", time.Hour)
	server.RefreshTTL = 24 * time.Hour
	server.MaxUploadBytes = 64 << 20
	gin.SetMode(gin.TestMode)
	jwt, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	deviceSecret := "test-only-owning-device-credential-long-enough"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "CI crash child",
		Platform: runtime.GOOS, CredentialHash: deviceCredentialDigest(deviceSecret),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	parent := createFilePropertiesDir(t, db, owner.ID, root.ID, "Crash backup")
	source := meta.Source{
		OwnerID: owner.ID, Name: "Native crash",
		Kind: meta.SourceKindLocalFolder, Direction: meta.SourceDirectionPush,
		SyncMode: meta.SourceSyncModeBackup, Status: meta.SourceStatusPaused,
		Revision: 7, TargetNodeID: &parent.ID,
	}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	committed := make(chan struct{}, 1)
	admitted := make(chan struct{}, 1)
	failed := make(chan int, 1)
	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseAll := func() { releaseOnce.Do(func() { close(release) }) }
	var admits atomic.Int32
	var chunks atomic.Int32
	var binds atomic.Int32
	var finalizes atomic.Int32
	router := server.Router()
	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/local-common-upload/admit") {
			if admits.Add(1) == 1 && crashBeforeAdmitACK {
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, r) // REAL SQL RESERVED before withholding the first ACK
				if rec.Code < 200 || rec.Code >= 300 {
					select {
					case failed <- rec.Code:
					default:
					}
					w.WriteHeader(rec.Code)
					_, _ = w.Write(rec.Body.Bytes())
					return
				}
				select {
				case admitted <- struct{}{}:
				default:
				}
				select {
				case <-release:
				case <-r.Context().Done():
				}
				http.Error(w, "simulated lost admission response", http.StatusServiceUnavailable)
				return
			}
		}
		if r.Method == http.MethodPut && strings.Contains(r.URL.Path, "/chunks/") {
			chunks.Add(1)
		}
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/local-common-upload/bind") {
			binds.Add(1)
		}
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/finalize") {
			finalizes.Add(1)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, r) // REAL SQL/physical CAS finalize before ACK
			if rec.Code < 200 || rec.Code >= 300 {
				select {
				case failed <- rec.Code:
				default:
				}
				w.WriteHeader(rec.Code)
				_, _ = w.Write(rec.Body.Bytes())
				return
			}
			select {
			case committed <- struct{}{}:
			default:
			}
			select {
			case <-release:
			case <-r.Context().Done():
			}
			// Always deny this original reply, even after durable COMMIT.
			http.Error(w, "simulated lost post-commit response", http.StatusServiceUnavailable)
			return
		}
		router.ServeHTTP(w, r)
	}))
	defer httpServer.Close()
	defer releaseAll() // release blocked request before server shutdown, even on fatal timeout

	original := filepath.Join(t.TempDir(), "original")
	if err := os.MkdirAll(original, 0o700); err != nil {
		t.Fatal(err)
	}
	bytesOnDisk := bytes.Repeat([]byte("real-native-process-commit-"), 8192)
	if err := os.WriteFile(filepath.Join(original, "file.bin"), bytesOnDisk, 0o600); err != nil {
		t.Fatal(err)
	}
	configDir := filepath.Join(t.TempDir(), "private")
	grant, err := localpush.PrepareRootGrant(
		httpServer.URL, owner.Username, source.ID, device.ID, original)
	if err != nil || !grant.StrongIdentity {
		t.Fatalf("native Root grant failed: %v", err)
	}
	if err := localpush.SaveRootGrant(configDir, grant); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&meta.LocalSourceBinding{
		SourceID: source.ID, OwnerID: owner.ID, DeviceID: device.ID,
		RootID: grant.RootID, RootFingerprint: grant.Fingerprint,
	}).Error; err != nil {
		t.Fatal(err)
	}
	snapshot, summary, err := localpush.ScanInventoryToJournal(
		context.Background(), configDir, grant,
		localpush.InventoryScanner{IncludeNativeIdentity: true, BatchSize: 100})
	if err != nil || !summary.Complete || summary.MissingInferenceSafe {
		t.Fatalf("native CURRENT inventory failed: %v", err)
	}
	in := commonNativeCrashInput{
		ServerURL: httpServer.URL, Account: owner.Username,
		RootID: grant.RootID, ConfigDir: configDir,
		OwnerJWT: jwt, DeviceToken: deviceSecret, SourceRev: source.Revision,
		SnapshotSHA: snapshot.SnapshotSHA256, RelativePath: "file.bin", TargetID: parent.ID,
	}
	inBytes, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	spawn := func() (*exec.Cmd, *bytes.Buffer) {
		t.Helper()
		cmd := exec.Command(os.Args[0], "-test.run=^TestLocalPushCommonNativeCrashChild$", "-test.v")
		cmd.Env = append(os.Environ(), commonNativeCrashChildEnv+"=1")
		cmd.Stdin = bytes.NewReader(inBytes)
		out := new(bytes.Buffer)
		cmd.Stdout, cmd.Stderr = out, out
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		return cmd, out
	}
	first, firstOutput := spawn()
	killed := false
	t.Cleanup(func() {
		if !killed {
			_ = first.Process.Kill()
			_ = first.Wait()
		}
	})
	if crashBeforeAdmitACK {
		select {
		case <-admitted:
		case code := <-failed:
			t.Fatalf("genuine original Admission rejected: HTTP %d", code)
		case <-time.After(50 * time.Second):
			t.Fatal("native child did not persist original RESERVED Admission")
		}
	} else {
		select {
		case <-committed:
		case code := <-failed:
			t.Fatalf("genuine first Finalize rejected original upload: HTTP %d", code)
		case <-time.After(50 * time.Second):
			t.Fatal("native child did not reach physical CAS/SQL commit")
		}
	}
	if err := first.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = first.Wait()
	killed = true
	// The terminated native child must not write test-only Owner JWT or
	// owning Device credentials into its process output.
	if strings.Contains(firstOutput.String(), jwt) ||
		strings.Contains(firstOutput.String(), deviceSecret) {
		t.Fatal("terminated native uploader leaked owning credentials")
	}
	releaseAll()

	var ops []meta.LocalPushCommonUploadOperation
	if err := db.Where("source_id = ?", source.ID).Find(&ops).Error; err != nil || len(ops) != 1 {
		t.Fatalf("original durable Operation missing after process death: rows=%d err=%v", len(ops), err)
	}
	if crashBeforeAdmitACK {
		if ops[0].State != meta.LocalPushCommonUploadReserved ||
			ops[0].ResultNodeID != nil || chunks.Load() != 0 ||
			binds.Load() != 0 || finalizes.Load() != 0 {
			t.Fatalf("pre-byte crash fabricated COMMIT or sent bytes: state=%s chunks=%d binds=%d finalizes=%d",
				ops[0].State, chunks.Load(), binds.Load(), finalizes.Load())
		}
	} else if ops[0].State != meta.LocalPushCommonUploadCommitted ||
		ops[0].ResultNodeID == nil || *ops[0].ResultNodeID == 0 {
		t.Fatal("original remote Operation did not commit before kill")
	}
	assertPhysicalOriginal := func(nodeID uint64) {
		t.Helper()
		var file meta.File
		if err := db.Where("node_id = ?", nodeID).Take(&file).Error; err != nil {
			t.Fatal(err)
		}
		wantSHA := sha256.Sum256(bytesOnDisk)
		if file.SHA256 != hex.EncodeToString(wantSHA[:]) || file.Size != int64(len(bytesOnDisk)) {
			t.Fatal("durable File metadata differs from original native bytes")
		}
		stream, err := localCAS.Open(context.Background(), file.StorageKey)
		if err != nil {
			t.Fatal(err)
		}
		physical, readErr := io.ReadAll(stream)
		closeErr := stream.Close()
		if readErr != nil || closeErr != nil || !bytes.Equal(physical, bytesOnDisk) {
			t.Fatalf("actual original CAS bytes invalid: read=%v close=%v", readErr, closeErr)
		}
	}
	if !crashBeforeAdmitACK {
		assertPhysicalOriginal(*ops[0].ResultNodeID)
	}
	var versionsBefore int64
	if err := db.Model(&meta.FileVersion{}).Count(&versionsBefore).Error; err != nil {
		t.Fatal(err)
	}
	second, result := spawn()
	if err := second.Wait(); err != nil ||
		!strings.Contains(result.String(), "LOCAL_COMMON_CRASH_REPLAY_COMMITTED="+ops[0].OperationID) {
		t.Fatalf("restarted native child failed original durable replay: err=%v output=%s", err, result.String())
	}
	if strings.Contains(result.String(), jwt) || strings.Contains(result.String(), deviceSecret) {
		t.Fatal("restarted native uploader leaked owning credentials")
	}
	// The ordinary uploader deliberately retries a lost Finalize HTTP response.
	// Multiple identical Finalize requests are not multiple SQL/CAS COMMITs;
	// prove uniqueness using the original immutable Operation/Node and FileVersion
	// rows below, rather than requiring a single HTTP attempt.
	if admits.Load() != 2 || chunks.Load() != 1 || binds.Load() != 1 ||
		finalizes.Load() < 1 || finalizes.Load() > 3 {
		t.Fatalf("restarted child repeated original physical write: admits=%d chunks=%d binds=%d finalizes=%d",
			admits.Load(), chunks.Load(), binds.Load(), finalizes.Load())
	}
	if crashBeforeAdmitACK {
		var completed meta.LocalPushCommonUploadOperation
		if err := db.Where("operation_id = ?", ops[0].OperationID).Take(&completed).Error; err != nil ||
			completed.State != meta.LocalPushCommonUploadCommitted ||
			completed.ResultNodeID == nil || *completed.ResultNodeID == 0 {
			t.Fatalf("original RESERVED Operation failed to commit on replay: %v", err)
		}
		assertPhysicalOriginal(*completed.ResultNodeID)
	}
	var operationsAfter, filesAfter, versionsAfter int64
	db.Model(&meta.LocalPushCommonUploadOperation{}).Where("source_id = ?", source.ID).Count(&operationsAfter)
	db.Model(&meta.Node{}).Where("parent_id = ?", parent.ID).Count(&filesAfter)
	db.Model(&meta.FileVersion{}).Count(&versionsAfter)
	if operationsAfter != 1 || filesAfter != 1 || versionsBefore != versionsAfter {
		t.Fatalf("native crash replay duplicated persisted state: operations=%d files=%d versions=%d/%d",
			operationsAfter, filesAfter, versionsBefore, versionsAfter)
	}
}
