package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// A syntactically valid but unknown kind used to fall through to an Owner-
// selected ordinary directory and create an active, unmanaged Source. No new
// Push/Pull connector may use that legacy HTTP fallback.
func TestSourceCreateRejectsUnknownKindAndArbitraryCloudTarget(t *testing.T) {
	db, server, owner, _, root := setupFilePropertiesTestDB(t)
	gin.SetMode(gin.TestMode)
	server.Auth = auth.New("source-kind-canonical-only", time.Hour)
	router := server.Router()
	token, err := server.Auth.Issue(owner.ID, owner.SessionVersion)
	if err != nil {
		t.Fatal(err)
	}
	ordinary := createFilePropertiesDir(t, db, owner.ID, root.ID, "普通云端目录")
	cases := []struct {
		name string
		body string
		want int
	}{
		{"synthetic provider push cannot take over ordinary target",
			fmt.Sprintf(`{"name":"非法推送","kind":"test","direction":"push","target_node_id":%d}`, ordinary.ID),
			http.StatusBadRequest},
		{"synthetic provider pull cannot take over ordinary target",
			fmt.Sprintf(`{"name":"非法拉取","kind":"test","direction":"pull","target_node_id":%d}`, ordinary.ID),
			http.StatusBadRequest},
		{"unknown provider cannot create an unbound source",
			`{"name":"未知来源","kind":"external_custom","direction":"pull"}`,
			http.StatusBadRequest},
		{"wrong-direction Yike is not a managed Push",
			`{"name":"伪造一刻推送","kind":"yike_photos","direction":"push"}`,
			http.StatusBadRequest},
		{"real Yike Pull cannot select an ordinary folder",
			fmt.Sprintf(`{"name":"选择普通目录","kind":"yike_photos","direction":"pull","target_node_id":%d}`, ordinary.ID),
			http.StatusBadRequest},
		{"local folder cannot use Pull and a chosen cloud folder",
			fmt.Sprintf(`{"name":"伪造本机拉取","kind":"local_folder","direction":"pull","target_node_id":%d}`, ordinary.ID),
			http.StatusBadRequest},
		{"dormant Synology Files Pull is not re-enabled",
			`{"name":"禁用的NAS拉取","kind":"synology_files","direction":"pull"}`,
			http.StatusGone},
		{"native iOS Photo Source still requires device proof",
			`{"name":"伪造苹果相册","kind":"ios_photos","direction":"push"}`,
			http.StatusForbidden},
		{"native Android Photo Source still requires device proof",
			`{"name":"伪造安卓相册","kind":"android_photos","direction":"push"}`,
			http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request(t, router, http.MethodPost, "/api/v1/sources",
				token, strings.NewReader(tc.body), tc.want)
			var sourceCount int64
			if err := db.Model(&meta.Source{}).Where("owner_id = ?", owner.ID).
				Count(&sourceCount).Error; err != nil {
				t.Fatal(err)
			}
			if sourceCount != 0 {
				t.Fatalf("rejected Source create persisted %d records", sourceCount)
			}
			var original meta.Node
			if err := db.First(&original, ordinary.ID).Error; err != nil {
				t.Fatal(err)
			}
			if original.Name != ordinary.Name || original.Revision != ordinary.Revision ||
				original.ParentID == nil || *original.ParentID != root.ID {
				t.Fatalf("rejected Source mutated ordinary directory: %+v", original)
			}
		})
	}

	// The supported path remains one atomic Source/Node creation, with no
	// caller-chosen parent or target identity.
	res := request(t, router, http.MethodPost, "/api/v1/sources", token,
		strings.NewReader(`{"name":"合法一刻拉取","kind":"yike_photos","direction":"pull"}`), http.StatusCreated)
	var source sourceDTO
	if err := json.Unmarshal(res.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}
	if !source.TargetManaged || source.TargetNodeID == nil || *source.TargetNodeID == 0 ||
		source.Status != meta.SourceStatusPaused ||
		source.TargetPath != "同步文件夹/Pull/Yike Photos/合法一刻拉取" {
		t.Fatalf("canonical Source provisioning regressed: %+v", source)
	}
}
