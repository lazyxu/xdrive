package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/auth"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestPostgresPoolObservedSummaryNeverClaimsUnknownFleet(t *testing.T) {
	desired := postgresPoolDesired{
		Revision: 3, Values: postgresPoolValues{MaxOpenConnections: 32, MaxIdleConnections: 8},
	}
	good := meta.PostgresPoolReplicaPresence{
		InstanceID: "private-a", Configured: true, AppliedRevision: 3,
		MaxOpenConnections: 32, MaxIdleConnections: 8,
	}
	good2 := good
	good2.InstanceID = "private-b"
	check := func(name string, rows []meta.PostgresPoolReplicaPresence, truncated bool,
		want string, applied int, consistent bool) {
		t.Helper()
		out := summarizePostgresPoolReplicas(desired, rows, truncated)
		if out.State != want || out.AppliedInstances != applied ||
			out.LimitsConsistent != consistent || out.ObservedInstances != len(rows) ||
			out.PendingInstances != len(rows)-applied {
			t.Fatalf("%s: unexpected observed-only summary: %+v", name, out)
		}
	}
	check("zero live rows", nil, false, "unavailable", 0, false)
	check("two exact applied rows", []meta.PostgresPoolReplicaPresence{good, good2}, false, "applied", 2, true)
	stale := good2
	stale.AppliedRevision = 2
	check("old revision not acknowledged", []meta.PostgresPoolReplicaPresence{good, stale}, false, "pending", 1, false)
	wrongIdle := good2
	wrongIdle.MaxIdleConnections = 4
	check("matching open alone is insufficient", []meta.PostgresPoolReplicaPresence{good, wrongIdle}, false, "pending", 1, false)
	unmanaged := good2
	unmanaged.Configured = false
	unmanaged.AppliedRevision = 0
	check("unmanaged member cannot count as applied", []meta.PostgresPoolReplicaPresence{good, unmanaged}, false, "pending", 1, false)
	check("query cap blocks success", []meta.PostgresPoolReplicaPresence{good, good2}, true, "pending", 2, true)
	defaultDesired := desired
	defaultDesired.Revision = 0
	out := summarizePostgresPoolReplicas(defaultDesired, []meta.PostgresPoolReplicaPresence{good}, false)
	if out.State != "unmanaged" || out.AppliedInstances != 0 {
		t.Fatalf("default values were advertised as globally managed: %+v", out)
	}
	if out := summarizePostgresPoolReplicas(desired, []meta.PostgresPoolReplicaPresence{good2, good}, false); len(out.PolicyGroups) != 1 || out.PolicyGroups[0].Count != 2 {
		t.Fatalf("identical policies were not grouped: %+v", out)
	}
}

func TestPostgresPoolObservedLeaseAdminAndFreshness(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("XD_TEST_DATABASE_URL is not configured")
	}
	gin.SetMode(gin.TestMode)
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	schema := "postgres_pool_presence_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := root.Exec(fmt.Sprintf("CREATE SCHEMA %q", schema)).Error; err != nil {
		t.Fatal(err)
	}
	defer func() { _ = root.Exec(fmt.Sprintf("DROP SCHEMA %q CASCADE", schema)).Error }()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&meta.User{}, &meta.AdminPostgresPoolSetting{}, &meta.PostgresPoolReplicaPresence{}); err != nil {
		t.Fatal(err)
	}
	server := &Server{DB: db, Auth: auth.New("test-pg-pool-observed-secret", time.Hour)}
	admin := meta.User{Username: "pg-observed-admin", PasswordHash: "test", Role: meta.UserRoleAdmin, SessionVersion: 1}
	member := meta.User{Username: "pg-observed-member", PasswordHash: "test", Role: meta.UserRoleUser, SessionVersion: 1}
	if err := db.Create(&admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&member).Error; err != nil {
		t.Fatal(err)
	}
	adminToken, err := server.Auth.Issue(admin.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	memberToken, err := server.Auth.Issue(member.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	router := server.Router()
	request := func(token string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/services/postgresql/pool", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		return out
	}
	if got := request(""); got.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous observed-status read accepted: %d", got.Code)
	}
	if got := request(memberToken); got.Code != http.StatusForbidden {
		t.Fatalf("ordinary user observed-status read accepted: %d", got.Code)
	}
	read := func(want string, instances, applied int) adminPostgresPoolConfigDTO {
		t.Helper()
		rec := request(adminToken)
		var out adminPostgresPoolConfigDTO
		if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &out) != nil ||
			out.Replicas.State != want || out.Replicas.ObservedInstances != instances ||
			out.Replicas.AppliedInstances != applied ||
			strings.Contains(rec.Body.String(), "private-a") ||
			strings.Contains(rec.Body.String(), "private-b") {
			t.Fatalf("admin aggregate failed/redaction violated: HTTP %d %+v body=%s",
				rec.Code, out, rec.Body.String())
		}
		return out
	}
	read("unavailable", 0, 0)
	now := time.Now().UTC()
	initial := server.postgresPoolPresenceSnapshot("private-a", now)
	if initial.Configured || initial.AppliedRevision != 0 {
		t.Fatalf("unmanaged Server claimed applied revision: %+v", initial)
	}
	if err := publishPostgresPoolReplicaPresence(context.Background(), db, initial); err != nil {
		t.Fatal(err)
	}
	read("unmanaged", 1, 0)
	if err := db.Create(&meta.AdminPostgresPoolSetting{
		Name: postgresPoolSettingName, Revision: 5,
		MaxOpenConnections: 32, MaxIdleConnections: 8,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := server.reconcilePostgresPool(context.Background()); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB.Stats().MaxOpenConnections != 32 {
		t.Fatal("actual pool max-open was not changed")
	}
	replicaDB, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	replicaSQL, err := replicaDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer replicaSQL.Close()
	replica := &Server{DB: replicaDB}
	replicaInitial := replica.postgresPoolPresenceSnapshot("private-b", now)
	if replicaInitial.Configured {
		t.Fatal("second Server claimed revision before applying it")
	}
	if err := publishPostgresPoolReplicaPresence(context.Background(), db,
		server.postgresPoolPresenceSnapshot("private-a", now)); err != nil {
		t.Fatal(err)
	}
	if err := publishPostgresPoolReplicaPresence(context.Background(), db, replicaInitial); err != nil {
		t.Fatal(err)
	}
	read("pending", 2, 1)
	if err := replica.reconcilePostgresPool(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := publishPostgresPoolReplicaPresence(context.Background(), db,
		replica.postgresPoolPresenceSnapshot("private-b", time.Now().UTC())); err != nil {
		t.Fatal(err)
	}
	all := read("applied", 2, 2)
	if !all.Replicas.LimitsConsistent || len(all.Replicas.PolicyGroups) != 1 {
		t.Fatalf("exact observed policy groups were not stable: %+v", all.Replicas)
	}
	stale := replica.postgresPoolPresenceSnapshot("private-b", time.Now().UTC().Add(-2*postgresPoolPresenceTTL))
	stale.ExpiresAt = time.Now().Add(time.Hour)
	if err := publishPostgresPoolReplicaPresence(context.Background(), db, stale); err != nil {
		t.Fatal(err)
	}
	onlyOne := read("applied", 1, 1)
	if onlyOne.Replicas.ObservedInstances == all.Replicas.ObservedInstances {
		t.Fatal("expired heartbeat incorrectly included as a live Server")
	}
	// Missing table must never turn observation errors into applied.
	if err := db.Migrator().DropTable(&meta.PostgresPoolReplicaPresence{}); err != nil {
		t.Fatal(err)
	}
	unknown := read("unknown", 0, 0)
	if unknown.ApplyState != "applied" {
		t.Fatalf("lost the independently valid local setting when fleet read failed: %+v", unknown)
	}
}
