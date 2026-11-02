package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	// This is a separate fixed public canary, NEVER an Owner photo or client GPS.
	// At most one upstream call per 60 minutes across all Server replicas.
	baiduServerAKProbeInterval  = time.Hour
	baiduServerAKProbeTimeout   = 7 * time.Second
	baiduServerAKProbeStuck     = 15 * time.Second
	baiduServerAKProbeSaltSize  = 32
	baiduServerAKProbeLongitude = 116.404
	baiduServerAKProbeLatitude  = 39.915
)

type baiduServerAKProbeView struct {
	State     string
	CheckedAt time.Time
}

func baiduServerAKProbeTag(salt []byte, ak string) string {
	if len(salt) != baiduServerAKProbeSaltSize || !validBaiduMapAK(ak) {
		return ""
	}
	h := sha256.New()
	_, _ = h.Write([]byte("xdrive/baidu-server-ak/automatic-probe/v1\x00"))
	_, _ = h.Write(salt)
	_, _ = h.Write([]byte(ak))
	return hex.EncodeToString(h.Sum(nil))
}

// A fixed provider request; the only input is the current trusted Server AK.
// No photo or Owner coordinate, no redirect, proxy, cookies or response text.
// The optional client is exclusively a controlled in-process test transport.
func checkBaiduServerAKFixedCoordinate(ctx context.Context, ak string, injected *http.Client) string {
	if ctx == nil || ctx.Err() != nil || !validBaiduMapAK(ak) {
		return "unavailable"
	}
	req, err := baidumapjsapi.NewBaiduGeoconvForwardRequest(ctx, ak,
		[]baidumapjsapi.WGS84Coordinate{{Longitude: baiduServerAKProbeLongitude, Latitude: baiduServerAKProbeLatitude}})
	if err != nil {
		return "unavailable"
	}
	client := baidumapjsapi.SafeHTTPClient()
	if injected != nil {
		client = injected // Only injected by isolated Server tests.
	}
	bounded := *client
	bounded.Timeout = 5 * time.Second
	bounded.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := bounded.Do(req)
	if err != nil || res == nil || res.Body == nil {
		return "unavailable"
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
		return "rejected"
	}
	mediaType, _, mimeErr := mime.ParseMediaType(res.Header.Get("Content-Type"))
	if res.StatusCode != http.StatusOK || res.ContentLength > baidumapjsapi.BaiduGeoconvMaxResponseBytes ||
		res.Header.Get("Location") != "" || (res.Header.Get("Content-Encoding") != "" &&
		!strings.EqualFold(res.Header.Get("Content-Encoding"), "identity")) ||
		mimeErr != nil || mediaType != "application/json" {
		return "unavailable"
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, baidumapjsapi.BaiduGeoconvMaxResponseBytes+1))
	if err != nil || len(raw) == 0 || len(raw) > baidumapjsapi.BaiduGeoconvMaxResponseBytes {
		return "unavailable"
	}
	defer clear(raw)
	// A nonzero well-formed provider status means this fixed test was not
	// accepted (quota/entitlement/AK are deliberately NOT conflated).
	var head struct {
		Status *int `json:"status"`
	}
	if err := json.Unmarshal(raw, &head); err != nil || head.Status == nil {
		return "unavailable"
	}
	if *head.Status != 0 {
		return "rejected"
	}
	copyRes := *res
	copyRes.Body = io.NopCloser(bytes.NewReader(raw))
	copyRes.ContentLength = int64(len(raw))
	positions, err := baidumapjsapi.CheckBaiduGeoconvForwardResponse(&copyRes, ak, 1)
	if err != nil || len(positions) != 1 ||
		positions[0].Longitude < baiduServerAKProbeLongitude-1 ||
		positions[0].Longitude > baiduServerAKProbeLongitude+1 ||
		positions[0].Latitude < baiduServerAKProbeLatitude-1 ||
		positions[0].Latitude > baiduServerAKProbeLatitude+1 {
		return "unavailable"
	}
	return "accepted"
}

// Quota is charged IN THE SAME transaction as the singleton cross-replica
// lease. It consumes one request + one point in the SAME fleet minute,
// second and UTC-day buckets used by real Owner photo Geoconv. Failed
// reservations roll back all writes and never make an upstream call.
func reserveBaiduServerProbeFleetQuota(ctx context.Context, tx *gorm.DB, now time.Time) (bool, error) {
	if ctx == nil || ctx.Err() != nil || tx == nil || now.IsZero() {
		return false, errors.New("probe quota context unavailable")
	}
	second, minute, day := now.Unix(), now.Unix()/60, now.Unix()/86400
	var result meta.BaiduGeoconvQuotaBucket
	statement := `
INSERT INTO xd_baidu_geoconv_quota_buckets
    (scope_id, window_minute, requests, points, window_second, second_requests,
     window_day, day_requests, created_at, updated_at)
VALUES (0, ?, 1, 1, ?, 1, ?, 1, clock_timestamp(), clock_timestamp())
ON CONFLICT (scope_id) DO UPDATE SET
    window_minute = EXCLUDED.window_minute,
    requests = CASE WHEN xd_baidu_geoconv_quota_buckets.window_minute = EXCLUDED.window_minute
      THEN xd_baidu_geoconv_quota_buckets.requests + 1 ELSE 1 END,
    points = CASE WHEN xd_baidu_geoconv_quota_buckets.window_minute = EXCLUDED.window_minute
      THEN xd_baidu_geoconv_quota_buckets.points + 1 ELSE 1 END,
    window_second = EXCLUDED.window_second,
    second_requests = CASE WHEN xd_baidu_geoconv_quota_buckets.window_second = EXCLUDED.window_second
      THEN xd_baidu_geoconv_quota_buckets.second_requests + 1 ELSE 1 END,
    window_day = EXCLUDED.window_day,
    day_requests = CASE WHEN xd_baidu_geoconv_quota_buckets.window_day = EXCLUDED.window_day
      THEN xd_baidu_geoconv_quota_buckets.day_requests + 1 ELSE 1 END,
    updated_at = clock_timestamp()
WHERE xd_baidu_geoconv_quota_buckets.window_minute <= EXCLUDED.window_minute
  AND xd_baidu_geoconv_quota_buckets.window_second <= EXCLUDED.window_second
  AND xd_baidu_geoconv_quota_buckets.window_day <= EXCLUDED.window_day
  AND (xd_baidu_geoconv_quota_buckets.window_minute < EXCLUDED.window_minute
       OR (xd_baidu_geoconv_quota_buckets.requests < ?
           AND xd_baidu_geoconv_quota_buckets.points < ?))
  AND (xd_baidu_geoconv_quota_buckets.window_second < EXCLUDED.window_second
       OR xd_baidu_geoconv_quota_buckets.second_requests < ?)
  AND (xd_baidu_geoconv_quota_buckets.window_day < EXCLUDED.window_day
       OR xd_baidu_geoconv_quota_buckets.day_requests < ?)
RETURNING scope_id, window_minute, requests, points, window_second,
          second_requests, window_day, day_requests`
	found := tx.WithContext(ctx).Raw(statement, minute, second, day,
		baiduGeoconvFleetRequestsPerMinute, baiduGeoconvFleetPointsPerMinute,
		baiduGeoconvFleetSecondRequests, baiduGeoconvFleetDayRequests).Scan(&result)
	if found.Error != nil {
		return false, found.Error
	}
	if found.RowsAffected == 0 {
		return false, nil
	}
	if result.ScopeID != 0 || result.WindowMinute != minute || result.WindowSecond != second ||
		result.WindowDay != day || result.Requests < 1 || result.Requests > baiduGeoconvFleetRequestsPerMinute ||
		result.Points < 1 || result.Points > baiduGeoconvFleetPointsPerMinute ||
		result.SecondRequests < 1 || result.SecondRequests > baiduGeoconvFleetSecondRequests ||
		result.DayRequests < 1 || result.DayRequests > baiduGeoconvFleetDayRequests {
		return false, errors.New("probe quota witness invalid")
	}
	return true, nil
}

// Only a trusted enabled Server AK may enter this read-only evidence path.
// PostgreSQL atomically admits at most one canary across all replicas; no GET,
// restart, session switch or browser tab can bypass the persisted hourly lease.
func (s *Server) observeBaiduServerAKProbe(ctx context.Context, cfg baiduMapEffectiveConfig) baiduServerAKProbeView {
	empty := baiduServerAKProbeView{State: "not-checked"}
	if s == nil || s.DB == nil || ctx == nil || ctx.Err() != nil ||
		!cfg.Enabled || !cfg.Configured || !validBaiduMapAK(cfg.AK) {
		return empty
	}
	salt := make([]byte, baiduServerAKProbeSaltSize)
	claimBytes := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return empty
	}
	if _, err := rand.Read(claimBytes); err != nil {
		return empty
	}
	var selected meta.BaiduServerAKProbe
	var claimed bool
	var trustedTag string
	var currentSalt []byte
	err := s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		origin := time.Unix(0, 0).UTC()
		seed := meta.BaiduServerAKProbe{
			ID: 1, Salt: salt, State: "not-checked", SaltedTag: "",
			AttemptID: "", AttemptedAt: origin, NextAttemptAt: origin,
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&seed).Error; err != nil {
			return err
		}
		var row meta.BaiduServerAKProbe
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", 1).Take(&row).Error; err != nil {
			return err
		}
		if len(row.Salt) != baiduServerAKProbeSaltSize {
			return errors.New("invalid Server AK probe salt")
		}
		trustedTag = baiduServerAKProbeTag(row.Salt, cfg.AK)
		currentSalt = append([]byte(nil), row.Salt...)
		if trustedTag == "" {
			return errors.New("invalid Server AK probe tag")
		}
		var now time.Time
		if err := tx.Raw("SELECT clock_timestamp()").Row().Scan(&now); err != nil || now.IsZero() {
			return errors.New("probe database clock unavailable")
		}
		if now.Before(row.NextAttemptAt) {
			selected = row
			return nil
		}
		allowed, err := reserveBaiduServerProbeFleetQuota(ctx, tx, now)
		if err != nil {
			return err
		}
		row.AttemptedAt = now
		row.NextAttemptAt = now.Add(baiduServerAKProbeInterval)
		row.CheckedAt = nil
		row.SaltedTag = trustedTag
		row.AttemptID = hex.EncodeToString(claimBytes)
		row.State = "checking"
		if !allowed {
			row.State = "rate-limited"
			row.AttemptID = ""
		}
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		if allowed {
			if err := tx.Create(&meta.AuditEvent{
				ActorRole: "system", Action: "admin.service.baidu_map.auto_probe",
				TargetType: "service", TargetID: "baidu-map",
				TargetLabel: "Baidu Server AK fixed-coordinate canary",
				Result:      "success",
				Metadata:    `{"kind":"fixed_public_coordinate","provider_request":true}`,
				CreatedAt:   now,
			}).Error; err != nil {
				return err
			}
		}
		selected = row
		claimed = allowed
		return nil
	})
	if err != nil {
		return empty // fail closed; do not reflect SQL, AK, paths or URLs.
	}
	evidence := baiduServerAKProbeView{State: "not-checked"}
	if selected.SaltedTag == trustedTag {
		switch selected.State {
		case "accepted", "rejected", "unavailable", "rate-limited", "checking":
			evidence.State = selected.State
		}
		if selected.CheckedAt != nil {
			evidence.CheckedAt = *selected.CheckedAt
		}
		if evidence.State == "checking" && time.Since(selected.AttemptedAt) > baiduServerAKProbeStuck {
			evidence.State = "unavailable" // crashed/stuck probe is never healthy.
		}
	}
	if claimed {
		// The credential never leaves this Server. This call has its own
		// seven-second timeout and completes even if the admin page closes.
		go s.performBaiduServerAKProbe(trustedTag, currentSalt, selected.AttemptID)
	}
	return evidence
}

func (s *Server) performBaiduServerAKProbe(tag string, salt []byte, attemptID string) {
	if s == nil || s.DB == nil || tag == "" || attemptID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), baiduServerAKProbeTimeout)
	defer cancel()
	// Recheck current saved/encrypted AK AFTER admission and BEFORE outbound.
	cfg, err := s.effectiveBaiduMapConfig(ctx)
	if err != nil || !cfg.Enabled || !cfg.Configured || baiduServerAKProbeTag(salt, cfg.AK) != tag {
		return
	}
	state := checkBaiduServerAKFixedCoordinate(ctx, cfg.AK, s.BaiduServerAKProbeHTTPClient)
	// A rotation/disable during an in-flight request revokes its result.
	latest, err := s.effectiveBaiduMapConfig(ctx)
	if err != nil || !latest.Enabled || !latest.Configured ||
		baiduServerAKProbeTag(salt, latest.AK) != tag {
		return
	}
	_ = s.DB.WithContext(ctx).Model(&meta.BaiduServerAKProbe{}).
		Where("id = ? AND salted_tag = ? AND attempt_id = ? AND state = ?", 1, tag, attemptID, "checking").
		Updates(map[string]any{"state": state, "checked_at": gorm.Expr("clock_timestamp()")}).Error
}

// A background probe runs on startup and at a bounded interval even when
// the admin page is closed. The same shared PostgreSQL admission also serves
// the first admin inventory read; it never touches a photo or browser AK.
func (s *Server) StartBaiduServerAKAutoProbe(ctx context.Context) {
	if s == nil || s.DB == nil || ctx == nil {
		return
	}
	go func() {
		scan := func() {
			readCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			cfg, err := s.effectiveBaiduMapConfig(readCtx)
			if err == nil {
				_ = s.observeBaiduServerAKProbe(readCtx, cfg)
			}
		}
		scan()
		ticker := time.NewTicker(15 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				scan()
			}
		}
	}()
}

func applyBaiduServerProbeEvidence(item *serviceDependency, probe baiduServerAKProbeView) {
	if item == nil {
		return
	}
	item.BaiduServerProbeState = probe.State
	if !probe.CheckedAt.IsZero() {
		item.BaiduServerProbeCheckedAt = probe.CheckedAt.UTC().Format(time.RFC3339)
	}
	switch probe.State {
	case "accepted":
		item.Status = "ready"
		item.HealthState = "ready"
		item.Detail = "百度 Geoconv v2 已接受固定公开坐标的自动在线测试；仅证明本次 Server AK 请求可用，不证明真实照片索引或 JSAPI4 动态地图健康"
	case "rejected":
		item.Status = "unavailable"
		item.HealthState = "failed"
		item.Detail = "百度上游未接受固定坐标测试；可能与 AK 权限、配额或服务状态有关，不能单凭结果认定密钥错误"
	case "unavailable":
		item.Status = "unknown"
		item.HealthState = "unknown"
		item.Detail = "百度自动在线检测超时、网络不可用或响应校验失败；没有证据证明 AK 已失效"
	case "checking":
		item.Detail = "Server 已自动启动一次受限的百度 Geoconv 在线检测；结果尚未返回"
	case "rate-limited":
		item.Detail = "百度自动检测已受共享配额限制；不会为了健康检查占用超额请求"
	case "not-checked":
		item.Detail = "Server AK 已启用，但还没有当前密钥的在线检测结果；系统自动尝试，最多每小时一次"
	}
}
