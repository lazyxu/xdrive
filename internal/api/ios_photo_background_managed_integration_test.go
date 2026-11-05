package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// The real HTTP/DB boundary: a grant cannot be issued for Owner root,
// a renamed/moved Source cannot be replaced by an arbitrary directory,
// and an old grant can still be revoked without new upload rights.
func TestIOSPhotoBackgroundGrantBindsCurrentManagedDestination(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.IOSPhotoBackgroundGrant{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("ios-managed-bg-grant", time.Hour)
	server.PWAOfflineInstanceID = uuid.NewString()
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	secret := "ios-photo-bg-device-credential-0123456789abcdef"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "iPhone 17", Platform: "ios",
		CredentialHash: deviceCredentialDigest(secret),
		CreatedAt:      time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{
		"X-XDrive-Device-ID":    device.ID,
		"X-XDrive-Device-Token": secret,
	}
	grantPath := "/api/v1/ios/photos/background-grants"
	grantBody, err := json.Marshal(map[string]string{"device_id": device.ID})
	if err != nil {
		t.Fatal(err)
	}
	// The Owner+device pair is insufficient until a real server-created
	// ios_photos Source and target Node have been committed.
	requestWithHeaders(t, router, http.MethodPost, grantPath, token,
		strings.NewReader(string(grantBody)), http.StatusForbidden, headers)

	type destination struct {
		SourceID     uint64 `json:"source_id"`
		TargetNodeID uint64 `json:"target_node_id"`
	}
	created := requestWithHeaders(t, router, http.MethodPut,
		"/api/v1/ios/photos/backup-destination", token,
		strings.NewReader(`{"name":"iPhone 相册"}`), http.StatusCreated, headers)
	var target destination
	if err := json.Unmarshal(created.Body.Bytes(), &target); err != nil {
		t.Fatal(err)
	}
	if target.SourceID == 0 || target.TargetNodeID == 0 ||
		target.TargetNodeID == root.ID {
		t.Fatalf("missing exclusive iPhone Source/Node: %+v", target)
	}
	res := requestWithHeaders(t, router, http.MethodPost, grantPath, token,
		strings.NewReader(string(grantBody)), http.StatusCreated, headers)
	var grant struct {
		ID           string  `json:"id"`
		DeviceID     string  `json:"device_id"`
		RootNodeID   uint64  `json:"root_node_id"`
		SourceID     *uint64 `json:"source_id"`
		TargetNodeID *uint64 `json:"target_node_id"`
		Secret       string  `json:"grant_secret"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &grant); err != nil {
		t.Fatal(err)
	}
	if grant.SourceID == nil || *grant.SourceID != target.SourceID ||
		grant.TargetNodeID == nil || *grant.TargetNodeID != target.TargetNodeID ||
		grant.RootNodeID != root.ID || grant.DeviceID != device.ID ||
		!validIOSPhotoGrantSecret(grant.Secret) {
		t.Fatalf("background grant bound wrong Source/Target: %+v", grant)
	}
	var persisted meta.IOSPhotoBackgroundGrant
	if err := db.First(&persisted, "id = ?", grant.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !iosPhotoGrantHasManagedTarget(persisted) ||
		*persisted.SourceID != target.SourceID ||
		*persisted.TargetNodeID != target.TargetNodeID {
		t.Fatalf("durable grant missing exact managed authority: %+v", persisted)
	}
	bound := map[string]string{
		"X-XDrive-Device-ID":       device.ID,
		"X-XDrive-Device-Token":    secret,
		"X-XDrive-IOS-Photo-Grant": grant.Secret,
	}
	proof := requestWithHeaders(t, router, http.MethodGet,
		grantPath+"/proof", "", nil, http.StatusOK, bound)
	var status struct {
		Authorized   bool    `json:"upload_authorized"`
		SourceID     *uint64 `json:"source_id"`
		TargetNodeID *uint64 `json:"target_node_id"`
	}
	if err := json.Unmarshal(proof.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if !status.Authorized || status.SourceID == nil || *status.SourceID != target.SourceID ||
		status.TargetNodeID == nil || *status.TargetNodeID != target.TargetNodeID {
		t.Fatalf("proof did not match managed target: %+v", status)
	}

	// Legacy root-only create/PUT/Finalize routes cannot write any new
	// bytes, regardless of whether the grant now has managed rights.
	requestWithHeaders(t, router, http.MethodPost,
		"/api/v1/ios/photos/background/uploads", "", nil, http.StatusForbidden, bound)
	upload := `{"parent_id":` + strconv.FormatUint(root.ID, 10) +
		`,"name":"IMG-xios-0123456789abcdef01234567-0123456789ab.heic","size":42,"chunk_size":8388608,"sha256":"` +
		strings.Repeat("a", 64) + `","resume_key":"ios_` + strings.Repeat("b", 64) +
		`","conflict_policy":"fail"}`
	requestWithHeaders(t, router, http.MethodPost,
		"/api/v1/ios/photos/background-managed/uploads", "", strings.NewReader(upload),
		http.StatusForbidden, bound)

	// The Source was renamed with 5B without changing its Node ID. The
	// grant is still valid for the same Node, never for an arbitrary path.
	renamed := requestWithHeaders(t, router, http.MethodPut,
		"/api/v1/ios/photos/backup-destination", token,
		strings.NewReader(`{"name":"升级版相册"}`), http.StatusOK, headers)
	var after destination
	if err := json.Unmarshal(renamed.Body.Bytes(), &after); err != nil {
		t.Fatal(err)
	}
	if after.SourceID != target.SourceID || after.TargetNodeID != target.TargetNodeID {
		t.Fatal("Source or Node identity changed on rename")
	}
	requestWithHeaders(t, router, http.MethodGet,
		grantPath+"/proof", "", nil, http.StatusOK, bound)
	// Revoking only the iPhone credential stops all BG proof and writes.
	now := time.Now().UTC()
	if err := db.Model(&meta.ClientDevice{}).Where("id = ?", device.ID).
		Update("revoked_at", now).Error; err != nil {
		t.Fatal(err)
	}
	requestWithHeaders(t, router, http.MethodGet,
		grantPath+"/proof", "", nil, http.StatusUnauthorized, bound)
}

// Historical grants remain listable/revocable, but no Owner-root-only
// token can authorize a fresh managed Source or root upload.
func TestIOSPhotoBackgroundLegacyGrantIsReadOnly(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.IOSPhotoBackgroundGrant{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("legacy-ios-bg-recovery", time.Hour)
	server.PWAOfflineInstanceID = uuid.NewString()
	router := server.Router()
	jwt, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	secret := "ios-photo-legacy-device-credential-0123456789"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "Old iPhone", Platform: "ios",
		CredentialHash: deviceCredentialDigest(secret),
		CreatedAt:      time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	grantSecret, grantDigest, err := newIOSPhotoGrantSecret()
	if err != nil {
		t.Fatal(err)
	}
	grant := meta.IOSPhotoBackgroundGrant{
		ID: uuid.NewString(), OwnerID: owner.ID, DeviceID: device.ID,
		RootNodeID: root.ID, ServerInstance: server.PWAOfflineInstanceID,
		SessionVersion: owner.SessionVersion, CredentialHash: grantDigest,
		CreatedAt:      time.Now().UTC(), UpdatedAt: time.Now().UTC(),
		ExpiresAt: time.Now().UTC().Add(time.Hour),
	}
	if err := db.Create(&grant).Error; err != nil {
		t.Fatal(err)
	}
	bound := map[string]string{
		"X-XDrive-Device-ID":       device.ID,
		"X-XDrive-Device-Token":    secret,
		"X-XDrive-IOS-Photo-Grant": grantSecret,
	}
	proof := requestWithHeaders(t, router, http.MethodGet,
		"/api/v1/ios/photos/background-grants/proof", "", nil, http.StatusOK, bound)
	var data struct {
		Authorized bool `json:"upload_authorized"`
	}
	if err := json.Unmarshal(proof.Body.Bytes(), &data); err != nil {
		t.Fatal(err)
	}
	if data.Authorized {
		t.Fatal("legacy Owner-root grant was advertised as write-authorized")
	}
	requestWithHeaders(t, router, http.MethodPost,
		"/api/v1/ios/photos/background/uploads", "", nil, http.StatusForbidden, bound)
	requestWithHeaders(t, router, http.MethodPost,
		"/api/v1/ios/photos/background-managed/uploads", "", nil, http.StatusForbidden, bound)
	requestWithHeaders(t, router, http.MethodPost,
		"/api/v1/ios/photos/background-grants/"+grant.ID+"/revoke", jwt,
		strings.NewReader("{}"), http.StatusOK, nil)
}

func TestIOSPhotoBackgroundScopedTransactionCannotOutliveGrant(t *testing.T) {
	db, server, owner, _, _ := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(&meta.ClientDevice{}, &meta.IOSPhotoBackgroundGrant{}, &meta.SyncRun{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("ios-photo-bg-finalize-fence", time.Hour)
	server.PWAOfflineInstanceID = uuid.NewString()
	router := server.Router()
	jwt, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	raw := "ios-photo-bg-tx-verified-device-credential-001"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "iPhone", Platform: "ios",
		CredentialHash: deviceCredentialDigest(raw),
		CreatedAt:      time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{
		"X-XDrive-Device-ID":    device.ID, "X-XDrive-Device-Token": raw,
	}
	creation := requestWithHeaders(t, router, http.MethodPut,
		"/api/v1/ios/photos/backup-destination", jwt,
		strings.NewReader(`{"name":"相册备份"}`), http.StatusCreated, headers)
	var dest struct {
		SourceID     uint64 `json:"source_id"`
		TargetNodeID uint64 `json:"target_node_id"`
	}
	if err := json.Unmarshal(creation.Body.Bytes(), &dest); err != nil {
		t.Fatal(err)
	}
	request, _ := json.Marshal(map[string]string{"device_id": device.ID})
	approved := requestWithHeaders(t, router, http.MethodPost,
		"/api/v1/ios/photos/background-grants", jwt,
		strings.NewReader(string(request)), http.StatusCreated, headers)
	var response struct {
		ID     string `json:"id"`
		Secret string `json:"grant_secret"`
	}
	if err := json.Unmarshal(approved.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	var grant meta.IOSPhotoBackgroundGrant
	if err := db.First(&grant, "id = ?", response.ID).Error; err != nil {
		t.Fatal(err)
	}
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest(http.MethodPost,
		"/api/v1/ios/photos/background-managed/uploads", nil)
	ctx.Request.Header.Set("X-XDrive-Device-ID", device.ID)
	ctx.Request.Header.Set("X-XDrive-Device-Token", raw)
	ctx.Request.Header.Set("X-XDrive-IOS-Photo-Grant", response.Secret)
	ctx.Set("iosPhotoBackgroundGrant", grant)
	scoped, ok := server.iosPhotoManagedAuthorizedScope(ctx)
	if !ok || scoped.sourceID != dest.SourceID || scoped.targetID != dest.TargetNodeID {
		t.Fatal("bound background grant was not admitted to its exact Source/Node")
	}
	hash := strings.Repeat("a", 64)
	name := "Live-xios-0123456789abcdef01234567-0123456789ab.zip"
	key := "ios_" + strings.Repeat("b", 64)
	input := uploadInitRequest{
		ParentID: &dest.TargetNodeID, Name: name,
		Size: 44, ChunkSize: defaultUploadChunkSize,
		SHA256: hash, ResumeKey: key,
		ConflictPolicy: meta.UploadConflictPolicyFail,
	}
	if err := requireSourceRunOrLocalPushTargetTx(context.Background(),
		db, ctx, owner.ID, dest.TargetNodeID, input); err != nil {
		t.Fatalf("current BG grant couldn't create a managed original: %v", err)
	}
	session := meta.UploadSession{
		ID: uuid.NewString(), OwnerID: owner.ID,
		ParentID: &dest.TargetNodeID, Name: name, RequestedName: name,
		ConflictPolicy: meta.UploadConflictPolicyFail,
		TotalSize:      input.Size, ChunkSize: input.ChunkSize,
		SHA256: input.SHA256, ResumeKey: input.ResumeKey,
		Status: meta.UploadStatusActive,
	}
	if err := requireSourceRunOrLocalPushFinalizeTx(context.Background(),
		db, ctx, session, dest.TargetNodeID); err != nil {
		t.Fatalf("current BG grant couldn't finalize managed original: %v", err)
	}
	// The HTTP middleware could have admitted the request before a
	// simultaneous remote revoke. The SQL mutation must reject the old
	// Gin context, independently of transport/proof caching.
	if err := db.Model(&meta.IOSPhotoBackgroundGrant{}).Where("id = ?", grant.ID).
		Update("revoked_at", time.Now().UTC()).Error; err != nil {
		t.Fatal(err)
	}
	if err := requireSourceRunOrLocalPushTargetTx(
		context.Background(), db, ctx, owner.ID, dest.TargetNodeID, input,
	); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("revoked grant created a new original: %v", err)
	}
	if err := requireSourceRunOrLocalPushFinalizeTx(
		context.Background(), db, ctx, session, dest.TargetNodeID,
	); !errors.Is(err, errManagedSourceWriteDenied) {
		t.Fatalf("revoked grant finalized a previously admitted session: %v", err)
	}
}

func TestIOSPhotoBackgroundGrantCanReportSharedSourceRunHistory(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	if err := db.AutoMigrate(
		&meta.ClientDevice{}, &meta.IOSPhotoBackgroundGrant{}, &meta.SyncRun{},
		&meta.SourceItem{}, &meta.SourceCollection{}, &meta.SourceRunFailure{},
	); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("ios-photo-bg-source-run-history", time.Hour)
	server.PWAOfflineInstanceID = uuid.NewString()
	router := server.Router()
	// Revoke the grant after middleware admission but before the SourceRun
	// write transaction. The transaction-bound proof must still reject it.
	router.POST("/__test/ios-photo-source-run/:id/:runID/progress",
		server.requireIOSPhotoBackgroundGrant(),
		server.requireIOSPhotoBackgroundSourceRunExecutor(),
		func(c *gin.Context) {
			grant, ok := iosPhotoBackgroundGrantFromContext(c)
			if !ok {
				fail(c, http.StatusForbidden, "background grant missing from context")
				return
			}
			if err := db.Model(&meta.IOSPhotoBackgroundGrant{}).
				Where("id = ?", grant.ID).
				Update("revoked_at", time.Now().UTC()).Error; err != nil {
				fail(c, http.StatusInternalServerError, "revoke test grant failed")
				return
			}
			server.progressSourceRun(c)
		})
	ownerToken, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	deviceSecret := "ios-photo-bg-source-run-device-credential-0123456789"
	device := meta.ClientDevice{
		ID: uuid.NewString(), OwnerID: owner.ID, Name: "iPhone 17", Platform: "ios",
		CredentialHash: deviceCredentialDigest(deviceSecret),
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if err := db.Create(&device).Error; err != nil {
		t.Fatal(err)
	}
	deviceHeaders := map[string]string{
		"X-XDrive-Device-ID":       device.ID,
		"X-XDrive-Device-Token":    deviceSecret,
	}
	destination := requestWithHeaders(t, router, http.MethodPut,
		"/api/v1/ios/photos/backup-destination", ownerToken,
		strings.NewReader(`{"name":"iPhone 后台相册备份"}`),
		http.StatusCreated, deviceHeaders)
	var target struct {
		SourceID     uint64 `json:"source_id"`
		TargetNodeID uint64 `json:"target_node_id"`
	}
	if err := json.Unmarshal(destination.Body.Bytes(), &target); err != nil {
		t.Fatal(err)
	}
	if target.SourceID == 0 || target.TargetNodeID == 0 || target.TargetNodeID == root.ID {
		t.Fatalf("server did not provision managed iPhone destination: %+v", target)
	}

	grantPath := "/api/v1/ios/photos/background-grants"
	grantBody := `{"device_id":"` + device.ID + `"}`
	grantResponse := requestWithHeaders(t, router, http.MethodPost,
		grantPath, ownerToken, strings.NewReader(grantBody),
		http.StatusCreated, deviceHeaders)
	var grant struct {
		ID           string  `json:"id"`
		Secret       string  `json:"grant_secret"`
		SourceID     *uint64 `json:"source_id"`
		TargetNodeID *uint64 `json:"target_node_id"`
	}
	if err := json.Unmarshal(grantResponse.Body.Bytes(), &grant); err != nil {
		t.Fatal(err)
	}
	if grant.ID == "" || !validIOSPhotoGrantSecret(grant.Secret) ||
		grant.SourceID == nil || *grant.SourceID != target.SourceID ||
		grant.TargetNodeID == nil || *grant.TargetNodeID != target.TargetNodeID {
		t.Fatalf("background grant did not bind the managed Source/Target: %+v", grant)
	}
	backgroundHeaders := map[string]string{
		"X-XDrive-Device-ID": device.ID,
		"X-XDrive-Device-Token": deviceSecret,
		"X-XDrive-IOS-Photo-Grant": grant.Secret,
	}

	runID := uuid.NewString()
	sourcePath := "/api/v1/ios/photos/background-managed/sources/" +
		strconv.FormatUint(target.SourceID, 10) + "/runs"
	beginBody := `{"run_id":"` + runID + `","trigger":"scheduled"}`
	// Neither an Owner bearer nor a registered Device alone can impersonate
	// the OS task. Only the separately revocable BG grant may create this run.
	requestWithHeaders(t, router, http.MethodPost, sourcePath, ownerToken,
		strings.NewReader(beginBody), http.StatusUnauthorized, nil)
	requestWithHeaders(t, router, http.MethodPost, sourcePath, "",
		strings.NewReader(beginBody), http.StatusUnauthorized, deviceHeaders)
	requestWithHeaders(t, router, http.MethodPost, sourcePath, "",
		strings.NewReader(beginBody), http.StatusCreated, backgroundHeaders)

	summary := `{
		"scanned_items":3,"scanned_bytes":0,
		"new_items":1,"new_bytes":0,
		"unchanged_items":2,"unchanged_bytes":0,
		"failed_items":0
	}`
	progressPath := sourcePath + "/" + runID + "/progress"
	requestWithHeaders(t, router, http.MethodPost, progressPath, "",
		strings.NewReader(`{"summary":`+summary+`}`),
		http.StatusNoContent, backgroundHeaders)

	finishPath := sourcePath + "/" + runID + "/finish"
	finishBody := `{"status":"completed","complete_inventory":false,"summary":`+summary+`}`
	requestWithHeaders(t, router, http.MethodPost, finishPath, "",
		strings.NewReader(finishBody), http.StatusOK, backgroundHeaders)

	read := requestWithHeaders(t, router, http.MethodGet,
		"/api/v1/sources/"+strconv.FormatUint(target.SourceID, 10)+"/runs/"+runID,
		ownerToken, nil, http.StatusOK, nil)
	var run struct {
		Status           string `json:"status"`
		Trigger          string `json:"trigger"`
		CompleteInventory bool   `json:"complete_inventory"`
		ScannedItems     int64  `json:"scanned_items"`
		NewItems         int64  `json:"new_items"`
		UnchangedItems   int64  `json:"unchanged_items"`
		SyncedFileItems  int64  `json:"synced_file_items"`
		TransferredItems int64  `json:"transferred_items"`
	}
	if err := json.Unmarshal(read.Body.Bytes(), &run); err != nil {
		t.Fatal(err)
	}
	if run.Status != meta.SyncRunStatusCompleted ||
		run.Trigger != meta.SyncRunTriggerScheduled || run.CompleteInventory ||
		run.ScannedItems != 3 || run.NewItems != 1 || run.UnchangedItems != 2 ||
		run.SyncedFileItems != 3 || run.TransferredItems != 1 {
		t.Fatalf("background SourceRun history mismatch: %+v", run)
	}
	var source meta.Source
	if err := db.First(&source, target.SourceID).Error; err != nil {
		t.Fatal(err)
	}
	if source.Status != meta.SourceStatusPaused || source.LastSuccessAt == nil {
		t.Fatalf("background run must update success history without activating Server scheduling: %+v", source)
	}
	var items int64
	if err := db.Model(&meta.SourceItem{}).Where("source_id = ?", target.SourceID).Count(&items).Error; err != nil {
		t.Fatal(err)
	}
	if items != 0 {
		t.Fatalf("background PhotoKit IDs must not become shared SourceItems: %d", items)
	}

	// The middleware admitted a valid grant, but revocation before the
	// SourceRun transaction must still fence the write.
	racedProgressPath := "/__test/ios-photo-source-run/" +
		strconv.FormatUint(target.SourceID, 10) + "/" + runID + "/progress"
	requestWithHeaders(t, router, http.MethodPost, racedProgressPath, "",
		strings.NewReader(`{"summary":`+summary+`}`),
		http.StatusForbidden, backgroundHeaders)
	// A subsequent request is rejected at the grant middleware itself.
	requestWithHeaders(t, router, http.MethodPost, progressPath, "",
		strings.NewReader(`{"summary":`+summary+`}`),
		http.StatusUnauthorized, backgroundHeaders)
}
