package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// S10-S18 remains active for Yike Pull even while Synology remote Pull is
// temporarily unavailable. A private remote account identity must never
// rewrite the user-entered canonical Source name or TargetNodeID.
func TestYikeNewSourceManagedTargetAndPrivateProviderIdentity(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("yike-new-source-managed-test", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	ordinary := createFilePropertiesDir(t, db, owner.ID, root.ID, "用户普通目录")
	request(t, router, http.MethodPost, "/api/v1/sources", token,
		strings.NewReader(fmt.Sprintf(
			`{"name":"不能接管普通目录","kind":"yike_photos","direction":"pull","target_node_id":%d}`,
			ordinary.ID)), http.StatusBadRequest)
	response := request(t, router, http.MethodPost, "/api/v1/sources", token,
		strings.NewReader(`{"name":"我的一刻相册","kind":"yike_photos","direction":"pull","schedule_type":"manual"}`),
		http.StatusCreated)
	var created sourceDTO
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.TargetNodeID == nil || !created.TargetManaged ||
		created.TargetPath != "同步文件夹/Pull/Yike Photos/我的一刻相册" ||
		created.Status != meta.SourceStatusPaused {
		t.Fatalf("new Yike source was not server-provisioned: %+v", created)
	}
	var persisted meta.Source
	if err := db.First(&persisted, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	targetID := *persisted.TargetNodeID
	identity := sourceCredentialTestDTO{AccountExternalID: "12345", AccountName: "远端昵称"}
	if err := db.Transaction(func(tx *gorm.DB) error {
		return bindYikeManagedTargetTx(context.Background(), tx, &persisted, identity)
	}); err != nil {
		t.Fatal(err)
	}
	var bound meta.Source
	if err := db.First(&bound, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if bound.ProviderAccountID != "12345" || bound.TargetNodeID == nil ||
		*bound.TargetNodeID != targetID || bound.Name != "我的一刻相册" ||
		bound.Status != meta.SourceStatusActive {
		t.Fatalf("provider ID changed canonical Source binding: %+v", bound)
	}
	var actualTarget, original meta.Node
	if err := db.First(&actualTarget, targetID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&original, ordinary.ID).Error; err != nil {
		t.Fatal(err)
	}
	if actualTarget.Name != "我的一刻相册" ||
		original.Name != ordinary.Name || original.ParentID == nil ||
		*original.ParentID != root.ID {
		t.Fatal("Yike Source modified an ordinary folder or leaked remote identity")
	}
}
