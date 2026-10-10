package api

import (
	"bufio"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/media"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
)

const (
	storageTempReclaimableAge = time.Hour

	storageCleanupThumbnail   = "media_thumbnail"
	storageCleanupVideoPoster = "video_poster"
	storageCleanupAnalysis    = "analysis_preview"
	storageCleanupStaging     = "upload_staging"
	storageCleanupTemp        = "storage_temp"
	storageCleanupAll         = "all"
)

type storageInventoryItemDTO struct {
	Key              string `json:"key"`
	Label            string `json:"label"`
	Category         string `json:"category"`
	Path             string `json:"path"`
	Files            int64  `json:"files"`
	Bytes            int64  `json:"bytes"`
	ReclaimableFiles int64  `json:"reclaimable_files"`
	ReclaimableBytes int64  `json:"reclaimable_bytes"`
	Deletable        bool   `json:"deletable"`
	CleanupKind      string `json:"cleanup_kind,omitempty"`
	Status           string `json:"status"`
}

type storageInventoryDTO struct {
	Items             []storageInventoryItemDTO `json:"items"`
	StorageRootBytes  int64                     `json:"storage_root_bytes"`
	DatabaseBytes     int64                     `json:"database_bytes"`
	BackupBytes       int64                     `json:"backup_bytes"`
	HostServiceBytes  int64                     `json:"host_service_bytes"`
	TotalManagedBytes int64                     `json:"total_managed_bytes"`
	ReclaimableBytes  int64                     `json:"reclaimable_bytes"`
	UnclassifiedBytes int64                     `json:"unclassified_bytes"`
	GeneratedAt       time.Time                 `json:"generated_at"`
}

type storageInventoryCounter struct {
	files            int64
	bytes            int64
	reclaimableFiles int64
	reclaimableBytes int64
}

type hostStorageCounter struct {
	Files int64
	Bytes int64
}

type hostStorageInventory struct {
	Database         hostStorageCounter
	BackupRoot       hostStorageCounter
	BackupSnapshots  hostStorageCounter
	BackupPreUpgrade hostStorageCounter
	BackupPreRestore hostStorageCounter
	Config           hostStorageCounter
	Bin              hostStorageCounter
	Logs             hostStorageCounter
	State            hostStorageCounter
	CaddyData        hostStorageCounter
	CaddyConfig      hostStorageCounter
	HomeFiles        hostStorageCounter
}

func (s *Server) invalidateStorageInventory() {}

func (s *Server) loadStorageInventory(ctx context.Context) (storageInventoryDTO, error) {
	return s.scanStorageInventory(ctx)
}

func storageHostPath(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value != "" && filepath.IsAbs(value) {
		return filepath.Clean(value)
	}
	fallback = strings.TrimSpace(fallback)
	if fallback != "" && filepath.IsAbs(fallback) {
		return filepath.Clean(fallback)
	}
	return ""
}

func storageHostJoin(root string, parts ...string) string {
	if root == "" {
		return "宿主机绝对路径不可用"
	}
	values := append([]string{root}, parts...)
	return filepath.Clean(filepath.Join(values...))
}

func storageHostPattern(root, relative string) string {
	if root == "" {
		return "宿主机绝对路径不可用"
	}
	return filepath.ToSlash(filepath.Join(root, filepath.FromSlash(relative)))
}

func storageInventoryCategory(key string) string {
	key = filepath.ToSlash(strings.TrimSpace(key))
	base := filepath.Base(filepath.FromSlash(key))
	if strings.HasPrefix(base, ".xdrive-upload-") {
		return "write_temp"
	}
	if strings.HasPrefix(base, ".xdrive-ready-") {
		return "readiness_temp"
	}
	if strings.HasPrefix(key, storage.UploadStagingDir+"/") {
		return "upload_staging"
	}
	if strings.HasPrefix(key, media.VideoPosterStoragePrefix) {
		if strings.HasSuffix(key, "-"+strconv.Itoa(media.VideoPosterEdge)+".jpg") {
			return "video_poster"
		}
		return "media_other"
	}
	if strings.HasPrefix(key, media.ThumbnailStoragePrefix) {
		switch {
		case strings.HasSuffix(key, "-"+strconv.Itoa(media.DefaultThumbnailEdge)+".jpg"),
			strings.HasSuffix(key, "-"+strconv.Itoa(media.DefaultThumbnailEdge)+".thumb"):
			return "media_thumbnail"
		case strings.HasSuffix(key, "-"+strconv.Itoa(media.AnalysisPreviewEdge)+".jpg"),
			strings.HasSuffix(key, "-"+strconv.Itoa(media.CreativePreviewEdge)+".jpg"):
			return "analysis_preview"
		default:
			return "media_other"
		}
	}
	if strings.HasPrefix(key, storage.ContentBlobDir+"/") {
		return "cas"
	}
	if strings.HasPrefix(key, ".xdrive-") {
		return "unclassified"
	}
	return "legacy"
}

func storageInventoryProgressLabel(category string) string {
	switch category {
	case "cas":
		return "CAS 主数据"
	case "legacy":
		return "Legacy 文件数据"
	case "upload_staging":
		return "上传暂存区"
	case "media_thumbnail":
		return "图片缩略图"
	case "video_poster":
		return "视频 Poster"
	case "analysis_preview":
		return "分析预览"
	case "media_other":
		return "其他媒体派生文件"
	case "write_temp":
		return "写入临时文件"
	case "readiness_temp":
		return "存储探针临时文件"
	default:
		return "未分类文件"
	}
}

func (s *Server) scanStorageInventory(ctx context.Context) (storageInventoryDTO, error) {
	return s.scanStorageInventoryWithProgress(ctx, nil)
}

func (s *Server) scanStorageInventoryWithProgress(
	ctx context.Context,
	report storageSampleProgressReporter,
) (storageInventoryDTO, error) {
	emit := func(value storageSampleProgress) {
		if report != nil {
			report(value)
		}
	}

	filesRoot := storageHostPath(s.FilesDataHostPath, "")
	homeRoot := storageHostPath(s.XDriveHomeHostPath, "")
	postgresRoot := storageHostPath(s.PostgresDataHostPath, storageHostJoin(homeRoot, "data", "postgres"))
	backupRoot := storageHostPath(s.BackupRootHostPath, storageHostJoin(homeRoot, "backups"))
	caddyDataRoot := storageHostPath(s.CaddyDataHostPath, storageHostJoin(homeRoot, "data", "caddy", "data"))
	caddyConfigRoot := storageHostPath(s.CaddyConfigHostPath, storageHostJoin(homeRoot, "data", "caddy", "config"))

	counters := map[string]*storageInventoryCounter{}
	for _, key := range []string{
		"cas", "legacy", "upload_staging", "media_thumbnail", "video_poster", "analysis_preview",
		"media_other", "write_temp", "readiness_temp", "unclassified",
	} {
		counters[key] = &storageInventoryCounter{}
	}

	walker, ok := s.Store.(storage.ManagedFileWalker)
	if !ok {
		return storageInventoryDTO{}, errors.New("storage backend does not support managed file inventory")
	}
	now := time.Now()
	var scannedFiles, scannedBytes int64
	emit(storageSampleProgress{
		Phase:       meta.SystemMaintenancePhaseStorageSampleInventory,
		Unit:        "item",
		CurrentItem: "物理存储",
		Force:       true,
	})
	if err := walker.WalkManagedFiles(ctx, func(file storage.ManagedFile) error {
		category := storageInventoryCategory(file.Key)
		scannedFiles++
		scannedBytes += file.Size
		emit(storageSampleProgress{
			Phase:       meta.SystemMaintenancePhaseStorageSampleInventory,
			Current:     scannedFiles,
			Unit:        "item",
			Bytes:       scannedBytes,
			CurrentItem: storageInventoryProgressLabel(category),
		})
		counter := counters[category]
		if counter == nil {
			counter = counters["unclassified"]
		}
		counter.files++
		counter.bytes += file.Size
		switch category {
		case "media_thumbnail", "video_poster", "analysis_preview":
			counter.reclaimableFiles++
			counter.reclaimableBytes += file.Size
		case "write_temp", "readiness_temp":
			if file.ModifiedAt.Before(now.Add(-storageTempReclaimableAge)) {
				counter.reclaimableFiles++
				counter.reclaimableBytes += file.Size
			}
		}
		return nil
	}); err != nil {
		return storageInventoryDTO{}, err
	}

	staging, err := s.loadUploadStagingInventory(ctx)
	if err != nil {
		return storageInventoryDTO{}, err
	}
	emit(storageSampleProgress{
		Phase:       meta.SystemMaintenancePhaseStorageSampleInventory,
		Current:     scannedFiles,
		Unit:        "item",
		Bytes:       scannedBytes,
		CurrentItem: "物理存储",
		Force:       true,
	})
	counters["upload_staging"].reclaimableFiles = staging.Stats.ReclaimableFiles
	counters["upload_staging"].reclaimableBytes = staging.Stats.ReclaimableBytes

	host := s.loadHostStorageInventory()
	if host.Database.Bytes == 0 {
		if err := s.DB.WithContext(ctx).
			Raw("SELECT pg_database_size(current_database())").
			Scan(&host.Database.Bytes).Error; err != nil {
			return storageInventoryDTO{}, err
		}
	}

	backupOtherBytes := host.BackupRoot.Bytes -
		host.BackupSnapshots.Bytes -
		host.BackupPreUpgrade.Bytes -
		host.BackupPreRestore.Bytes
	if backupOtherBytes < 0 {
		backupOtherBytes = 0
	}
	backupOtherFiles := host.BackupRoot.Files -
		host.BackupSnapshots.Files -
		host.BackupPreUpgrade.Files -
		host.BackupPreRestore.Files
	if backupOtherFiles < 0 {
		backupOtherFiles = 0
	}

	item := func(key, label, category, path, status string, deletable bool, cleanupKind string) storageInventoryItemDTO {
		counter := counters[key]
		out := storageInventoryItemDTO{
			Key: key, Label: label, Category: category, Path: path,
			Deletable: deletable, CleanupKind: cleanupKind, Status: status,
		}
		if counter != nil {
			out.Files = counter.files
			out.Bytes = counter.bytes
			out.ReclaimableFiles = counter.reclaimableFiles
			out.ReclaimableBytes = counter.reclaimableBytes
		}
		return out
	}
	hostItem := func(key, label, category, path string, counter hostStorageCounter) storageInventoryItemDTO {
		return storageInventoryItemDTO{
			Key: key, Label: label, Category: category, Path: path,
			Files: counter.Files, Bytes: counter.Bytes, Status: "read_only",
		}
	}

	items := []storageInventoryItemDTO{
		item("cas", "CAS 主数据", "primary", storageHostJoin(filesRoot, storage.ContentBlobDir), "active", false, ""),
		item("legacy", "Legacy 文件数据", "primary", filesRoot, "active", false, ""),
		item("upload_staging", "上传临时文件", "temporary", storageHostJoin(filesRoot, storage.UploadStagingDir), "active", true, storageCleanupStaging),
		item("media_thumbnail", "图片缩略图 · 512px", "cache", storageHostPattern(filesRoot, ".xdrive-media/thumbnails/*-512.{jpg,thumb}"), "regenerable", true, storageCleanupThumbnail),
		item("video_poster", "视频 Poster · 512px", "cache", storageHostPattern(filesRoot, ".xdrive-media/posters/*-512.jpg"), "regenerable", true, storageCleanupVideoPoster),
		item("analysis_preview", "Photo Intelligence 分析/创作预览 · 1280/2048px", "cache", storageHostPattern(filesRoot, ".xdrive-media/thumbnails/*-{1280,2048}.jpg"), "regenerable", true, storageCleanupAnalysis),
		item("media_other", "其他媒体派生文件", "cache", storageHostJoin(filesRoot, ".xdrive-media"), "unknown", false, ""),
		item("write_temp", "写入临时文件", "temporary", storageHostPattern(filesRoot, "**/.xdrive-upload-*"), "reclaimable_by_age", true, storageCleanupTemp),
		item("readiness_temp", "存储探针临时文件", "temporary", storageHostPattern(filesRoot, ".xdrive-ready-*"), "reclaimable_by_age", true, storageCleanupTemp),
		item("unclassified", "未分类 xDrive 文件数据", "other", filesRoot, "review", false, ""),
		{
			Key: "preview_cache", Label: "普通预览缓存", Category: "cache",
			Path: storageHostJoin(filesRoot, ".xdrive-media", "previews"), Status: "not_enabled",
		},
		{
			Key: "video_transcode", Label: "视频转码 / Proxy", Category: "cache",
			Path: storageHostJoin(filesRoot, ".xdrive-media", "transcodes"), Status: "not_enabled",
		},
		hostItem("database", "PostgreSQL 数据库", "database", postgresRoot, host.Database),
		hostItem("backup_snapshots", "常规备份", "backup", storageHostJoin(backupRoot, "snapshots"), host.BackupSnapshots),
		hostItem("backup_pre_upgrade", "升级前备份", "backup", storageHostJoin(backupRoot, "pre-upgrade"), host.BackupPreUpgrade),
		hostItem("backup_pre_restore", "恢复前备份", "backup", storageHostJoin(backupRoot, "pre-restore"), host.BackupPreRestore),
		hostItem("server_config", "Server 配置", "host", storageHostJoin(homeRoot, "config"), host.Config),
		hostItem("server_bin", "Server 程序与维护脚本", "host", storageHostJoin(homeRoot, "bin"), host.Bin),
		hostItem("server_logs", "Server 日志", "host", storageHostJoin(homeRoot, "logs"), host.Logs),
		hostItem("server_state", "Server 运行状态", "host", storageHostJoin(homeRoot, "state"), host.State),
		hostItem("caddy_data", "Caddy 数据", "host", caddyDataRoot, host.CaddyData),
		hostItem("caddy_config", "Caddy 配置数据", "host", caddyConfigRoot, host.CaddyConfig),
		hostItem("home_root_files", "xDrive Home 根目录文件", "host", homeRoot, host.HomeFiles),
	}
	if backupOtherBytes > 0 || backupOtherFiles > 0 {
		items = append(items, storageInventoryItemDTO{
			Key: "backup_other", Label: "其他备份文件", Category: "backup",
			Path: backupRoot, Files: backupOtherFiles, Bytes: backupOtherBytes, Status: "read_only",
		})
	}

	var storageRootBytes, reclaimableBytes int64
	for _, key := range []string{
		"cas", "legacy", "upload_staging", "media_thumbnail", "video_poster", "analysis_preview",
		"media_other", "write_temp", "readiness_temp", "unclassified",
	} {
		storageRootBytes += counters[key].bytes
		reclaimableBytes += counters[key].reclaimableBytes
	}
	hostServiceBytes := host.Config.Bytes + host.Bin.Bytes + host.Logs.Bytes +
		host.State.Bytes + host.CaddyData.Bytes + host.CaddyConfig.Bytes + host.HomeFiles.Bytes

	return storageInventoryDTO{
		Items:             items,
		StorageRootBytes:  storageRootBytes,
		DatabaseBytes:     host.Database.Bytes,
		BackupBytes:       host.BackupRoot.Bytes,
		HostServiceBytes:  hostServiceBytes,
		TotalManagedBytes: storageRootBytes + host.Database.Bytes + host.BackupRoot.Bytes + hostServiceBytes,
		ReclaimableBytes:  reclaimableBytes,
		UnclassifiedBytes: counters["unclassified"].bytes,
		GeneratedAt:       time.Now().UTC(),
	}, nil
}

func (s *Server) loadHostStorageInventory() hostStorageInventory {
	var out hostStorageInventory
	controlDir := strings.TrimSpace(s.HostControlDir)
	if controlDir == "" {
		return out
	}
	file, err := os.Open(filepath.Join(controlDir, "storage-host-inventory.env"))
	if err != nil {
		return out
	}
	defer file.Close()

	values := map[string]*int64{
		"database_bytes":           &out.Database.Bytes,
		"database_files":           &out.Database.Files,
		"backup_root_bytes":        &out.BackupRoot.Bytes,
		"backup_root_files":        &out.BackupRoot.Files,
		"backup_snapshots_bytes":   &out.BackupSnapshots.Bytes,
		"backup_snapshots_files":   &out.BackupSnapshots.Files,
		"backup_pre_upgrade_bytes": &out.BackupPreUpgrade.Bytes,
		"backup_pre_upgrade_files": &out.BackupPreUpgrade.Files,
		"backup_pre_restore_bytes": &out.BackupPreRestore.Bytes,
		"backup_pre_restore_files": &out.BackupPreRestore.Files,
		"config_bytes":             &out.Config.Bytes,
		"config_files":             &out.Config.Files,
		"bin_bytes":                &out.Bin.Bytes,
		"bin_files":                &out.Bin.Files,
		"logs_bytes":               &out.Logs.Bytes,
		"logs_files":               &out.Logs.Files,
		"state_bytes":              &out.State.Bytes,
		"state_files":              &out.State.Files,
		"caddy_data_bytes":         &out.CaddyData.Bytes,
		"caddy_data_files":         &out.CaddyData.Files,
		"caddy_config_bytes":       &out.CaddyConfig.Bytes,
		"caddy_config_files":       &out.CaddyConfig.Files,
		"home_root_files_bytes":    &out.HomeFiles.Bytes,
		"home_root_files_count":    &out.HomeFiles.Files,
	}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		key, raw, ok := strings.Cut(scanner.Text(), "=")
		if !ok {
			continue
		}
		target := values[strings.TrimSpace(key)]
		if target == nil {
			continue
		}
		value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
		if err == nil && value >= 0 {
			*target = value
		}
	}
	return out
}
