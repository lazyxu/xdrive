package api

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

// Only the independent Pull Worker emits these leases. No per-user Source
// records, worker hostnames, paths or credentials are read or exposed.
func (s *Server) sourceWorkerServiceStatus(ctx context.Context, now time.Time) (string, string) {
	if s == nil || s.DB == nil {
		return "unknown", "无法从数据库确认独立 Pull Worker 心跳"
	}
	var latest meta.SourceWorkerPresence
	err := s.DB.WithContext(ctx).Order("expires_at DESC").Take(&latest).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return workerHeartbeatState(now, nil, 0)
	}
	if err != nil {
		return "unknown", "独立 Pull Worker 心跳读取失败，无法确认运行状态"
	}
	if !latest.ExpiresAt.After(now) {
		return workerHeartbeatState(now, &latest, 0)
	}
	var live int64
	if err := s.DB.WithContext(ctx).Model(&meta.SourceWorkerPresence{}).
		Where("expires_at > ?", now).Count(&live).Error; err != nil {
		return "unknown", "独立 Pull Worker 心跳读取失败，无法确认运行状态"
	}
	return workerHeartbeatState(now, &latest, live)
}

func workerHeartbeatState(now time.Time, latest *meta.SourceWorkerPresence, live int64) (string, string) {
	if latest == nil || latest.ExpiresAt.Before(now.Add(-24*time.Hour)) {
		return "unknown", "尚无近期独立 Pull Worker 心跳；无法确认是否已部署"
	}
	if !latest.ExpiresAt.After(now) {
		return "unavailable", "独立 Pull Worker 的最近心跳已超时，无法确认进程仍正常运行"
	}
	if live <= 0 {
		return "unknown", "当前没有可确认的独立 Pull Worker 活跃心跳"
	}
	return "ready", fmt.Sprintf("检测到 %d 个独立 Pull Worker 的有效心跳（仅代表进程活跃，不代表同步任务成功）", live)
}
