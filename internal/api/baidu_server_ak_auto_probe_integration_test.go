package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBaiduServerAKAutoProbeSharedLeaseAndFleetQuota(t *testing.T) {
	dsn := os.Getenv("XD_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated PostgreSQL service required")
	}
	root, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	rootSQL, err := root.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer rootSQL.Close()
	schema := "baidu_server_probe_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	makeDB := func() *gorm.DB {
		t.Helper()
		db, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		pool, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		pool.SetMaxOpenConns(8)
		t.Cleanup(func() { _ = pool.Close() })
		return db
	}
	firstDB, secondDB := makeDB(), makeDB()
	if err := firstDB.AutoMigrate(&meta.BaiduServerAKProbe{},
		&meta.BaiduGeoconvQuotaBucket{}, &meta.AdminServiceSecret{}, &meta.AuditEvent{}); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int64
	client := &http.Client{Transport: baiduAutoProbeTestTransport(func(req *http.Request) (*http.Response, error) {
		if req.URL.Host != "api.map.baidu.com" || req.URL.Path != "/geoconv/v2/" ||
			req.URL.Query().Get("coords") != "116.404,39.915" {
			t.Error("unsafe upstream canary route")
		}
		calls.Add(1)
		payload := `{"status":0,"result":[{"x":116.416,"y":39.922}]}`
		return &http.Response{StatusCode: 200,
			Header: http.Header{"Content-Type": []string{"application/json"}},
			Body:   io.NopCloser(strings.NewReader(payload)), ContentLength: int64(len(payload))}, nil
	})}
	s1 := &Server{DB: firstDB, BaiduMapEnabled: true, BaiduMapAK: "test-public-ak-1", BaiduServerAKProbeHTTPClient: client}
	s2 := &Server{DB: secondDB, BaiduMapEnabled: true, BaiduMapAK: "test-public-ak-1", BaiduServerAKProbeHTTPClient: client}
	var wg sync.WaitGroup
	for _, server := range []*Server{s1, s2, s1, s2, s1, s2} {
		wg.Add(1)
		go func(s *Server) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = s.observeBaiduServerAKProbe(ctx, s.baiduMapDeploymentConfig())
		}(server)
	}
	wg.Wait()
	var row meta.BaiduServerAKProbe
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if err := firstDB.Where("id = ?", 1).Take(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.State == "accepted" {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if row.State != "accepted" || row.CheckedAt == nil || len(row.Salt) != baiduServerAKProbeSaltSize ||
		row.SaltedTag == "" || row.SaltedTag == s1.BaiduMapAK || calls.Load() != 1 {
		t.Fatalf("replicas did not coalesce to one accepted public canary; state=%s calls=%d", row.State, calls.Load())
	}
	var quota meta.BaiduGeoconvQuotaBucket
	if err := firstDB.Where("scope_id = ?", 0).Take(&quota).Error; err != nil {
		t.Fatal(err)
	}
	if quota.Requests != 1 || quota.Points != 1 || quota.SecondRequests != 1 || quota.DayRequests != 1 {
		t.Fatalf("canary did not debit exactly one fleet request/point: %+v", quota)
	}
	if state := s2.observeBaiduServerAKProbe(context.Background(), s2.baiduMapDeploymentConfig()); state.State != "accepted" {
		t.Fatalf("cross-replica cached success missing: %+v", state)
	}
	s2.BaiduMapAK = "test-public-ak-rotated"
	if state := s2.observeBaiduServerAKProbe(context.Background(), s2.baiduMapDeploymentConfig()); state.State != "not-checked" || !state.CheckedAt.IsZero() {
		t.Fatalf("prior credential's success reused after AK rotation: %+v", state)
	}
	if calls.Load() != 1 {
		t.Fatal("refresh or rotation bypassed the hourly fleet lease")
	}
	// Exhaust the CURRENT fleet UTC-day window. A new probe must not use
	// an Owner bucket or bypass production minute/second/day admission.
	if err := firstDB.Model(&meta.BaiduGeoconvQuotaBucket{}).
		Where("scope_id = ?", 0).Update("day_requests", baiduGeoconvFleetDayRequests).Error; err != nil {
		t.Fatal(err)
	}
	if err := firstDB.Model(&meta.BaiduServerAKProbe{}).
		Where("id = ?", 1).Update("next_attempt_at", time.Unix(0, 0)).Error; err != nil {
		t.Fatal(err)
	}
	limited := s1.observeBaiduServerAKProbe(context.Background(), s1.baiduMapDeploymentConfig())
	if limited.State != "rate-limited" || calls.Load() != 1 {
		t.Fatalf("quota exhausted but probe attempted paid egress: %+v calls=%d", limited, calls.Load())
	}
	var auditCount int64
	if err := firstDB.Model(&meta.AuditEvent{}).
		Where("action = ?", "admin.service.baidu_map.auto_probe").Count(&auditCount).Error; err != nil || auditCount != 1 {
		t.Fatalf("auto canary egress must have exactly one committed audit: %d %v", auditCount, err)
	}
}
