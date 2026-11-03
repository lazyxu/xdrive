package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
)

// This test uses the same isolated Postgres schema as Source Mirror tests.
// It proves real Node creation and Server-side rename, not a mocked path.
func TestSourceAutoTargetAndActualDirectoryRename(t *testing.T) {
	db := openMirrorTestDB(t)
	server := &Server{
		DB: db, Auth: auth.New("managed-source-target-test", time.Hour),
		RefreshTTL: 24 * time.Hour, AllowedOrigin: "http://localhost",
	}
	router := server.Router()
	ownerJWT := createTestUser(t, db, router, "auto-target-owner", "password-a")

	body := `{"name":"NAS Documents","kind":"synology_files","direction":"pull","sync_mode":"backup","run_mode":"sync","schedule_type":"manual","target_node_id":0,"auto_target":true}`
	create := request(t, router, http.MethodPost, "/api/v1/sources", ownerJWT,
		strings.NewReader(body), http.StatusCreated)
	var source sourceDTO
	if err := json.Unmarshal(create.Body.Bytes(), &source); err != nil {
		t.Fatal(err)
	}
	if source.ID == 0 || source.TargetNodeID == nil ||
		source.Status != meta.SourceStatusPaused || source.Revision != 1 {
		t.Fatalf("missing new managed target: %+v", source)
	}
	var leaf meta.Node
	if err := db.Where("id = ?", *source.TargetNodeID).First(&leaf).Error; err != nil {
		t.Fatal(err)
	}
	expectedLeaf := fmt.Sprintf("NAS Documents [s%d]", source.ID)
	if leaf.Name != expectedLeaf || leaf.Type != meta.NodeTypeDir || leaf.ParentID == nil {
		t.Fatalf("managed Source leaf = %+v, expected %q", leaf, expectedLeaf)
	}
	var connector meta.Node
	if err := db.First(&connector, *leaf.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	var pullParent meta.Node
	if connector.ParentID == nil {
		t.Fatal("connector parent missing")
	}
	if err := db.First(&pullParent, *connector.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	var syncParent meta.Node
	if pullParent.ParentID == nil {
		t.Fatal("Pull parent missing")
	}
	if err := db.First(&syncParent, *pullParent.ParentID).Error; err != nil {
		t.Fatal(err)
	}
	if connector.Name != "Synology Files" ||
		pullParent.Name != managedSourcePullDirectory ||
		syncParent.Name != managedSourceTopDirectory {
		t.Fatalf("unexpected managed hierarchy: %q / %q / %q",
			syncParent.Name, pullParent.Name, connector.Name)
	}

	patch := `{"name":"Renamed backup"}`
	rename := requestWithHeaders(t, router, http.MethodPatch,
		fmt.Sprintf("/api/v1/sources/%d", source.ID), ownerJWT,
		strings.NewReader(patch), http.StatusOK,
		map[string]string{"If-Match": `"1"`})
	var renamed sourceDTO
	if err := json.Unmarshal(rename.Body.Bytes(), &renamed); err != nil {
		t.Fatal(err)
	}
	if renamed.Revision != 2 || renamed.TargetNodeID == nil ||
		*renamed.TargetNodeID != *source.TargetNodeID {
		t.Fatalf("Source rename damaged stable target identity: %+v", renamed)
	}
	if err := db.First(&leaf, *source.TargetNodeID).Error; err != nil {
		t.Fatal(err)
	}
	if leaf.Name != fmt.Sprintf("Renamed backup [s%d]", source.ID) || leaf.Revision != 2 {
		t.Fatalf("real Node rename did not commit: %+v", leaf)
	}

	// A canonical Source target cannot be retargeted to an arbitrary normal
	// Owner folder through the old settings endpoint.
	var owner meta.User
	if err := db.Where("username = ?", "auto-target-owner").First(&owner).Error; err != nil {
		t.Fatal(err)
	}
	var root meta.Node
	if err := db.Where("owner_id = ? AND parent_id IS NULL", owner.ID).First(&root).Error; err != nil {
		t.Fatal(err)
	}
	retarget := fmt.Sprintf(`{"target_node_id":%d}`, root.ID)
	requestWithHeaders(t, router, http.MethodPatch,
		fmt.Sprintf("/api/v1/sources/%d", source.ID), ownerJWT,
		strings.NewReader(retarget), http.StatusBadRequest,
		map[string]string{"If-Match": `"2"`})
}
