package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	auditpkg "github.com/lazyxu/xdrive/internal/audit"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Snapshot is deliberately distinct from apply. Only the existing
// deployment-selected, read-only GeoNames directory is a possible source;
// the client supplies no filesystem paths or dataset bytes in this phase.
const (
	geoNamesSnapshotHistoryLimit = 20
	geoNamesSnapshotMaxTotal     = 146 << 20
)

type geoNamesSnapshotFile struct {
	Name     string
	MaxBytes int64
}

var geoNamesSnapshotFiles = []geoNamesSnapshotFile{
	{Name: "cities500.txt", MaxBytes: 128 << 20},
	{Name: "admin1CodesASCII.txt", MaxBytes: 16 << 20},
	{Name: "countryInfo.txt", MaxBytes: 2 << 20},
}

type geoNamesSnapshotDTO struct {
	Fingerprint     string    `json:"fingerprint"`
	ResolverVersion string    `json:"resolver_version"`
	CheckedRadiusKM float64   `json:"checked_radius_km"`
	CheckedRevision uint64    `json:"checked_revision"`
	TotalBytes      int64     `json:"total_bytes"`
	CreatedAt       time.Time `json:"created_at"`
	LocallyPresent  bool      `json:"locally_present"`
}

type geoNamesSnapshotResult struct {
	Staged   bool                `json:"staged"`
	Applied  bool                `json:"applied"`
	Snapshot geoNamesSnapshotDTO `json:"snapshot"`
}

func geoNamesSnapshotRoot(directory, sourceDirectory string) (string, error) {
	if strings.TrimSpace(directory) == "" || strings.TrimSpace(sourceDirectory) == "" {
		return "", errors.New("snapshot storage and trusted source mount are required")
	}
	root := filepath.Clean(directory)
	source := filepath.Clean(sourceDirectory)
	if !filepath.IsAbs(root) || !filepath.IsAbs(source) {
		return "", errors.New("snapshot root and source directory must be absolute deployment paths")
	}
	if root == source {
		return "", errors.New("snapshot root cannot equal the read-only dataset source")
	}
	if relative, err := filepath.Rel(source, root); err == nil &&
		relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", errors.New("snapshot root cannot be inside the deployment data source")
	}
	stat, err := os.Lstat(root)
	if err != nil {
		return "", err
	}
	if !stat.IsDir() || stat.Mode()&os.ModeSymlink != 0 {
		return "", errors.New("snapshot root must be a real directory, not a symlink")
	}
	if runtime.GOOS != "windows" && stat.Mode().Perm()&0022 != 0 {
		return "", errors.New("snapshot root must not be writable by group or others")
	}
	return root, nil
}

func geoNamesSnapshotStorageConfigured(directory, sourceDirectory string) bool {
	_, err := geoNamesSnapshotRoot(directory, sourceDirectory)
	return err == nil
}

func geoNamesSnapshotDTOForRow(row meta.AdminGeoNamesDatasetSnapshot, root string) geoNamesSnapshotDTO {
	present := false
	if root != "" {
		if info, err := os.Lstat(filepath.Join(root, row.Fingerprint)); err == nil {
			present = info.IsDir() && info.Mode()&os.ModeSymlink == 0
		}
	}
	return geoNamesSnapshotDTO{
		Fingerprint:     row.Fingerprint,
		ResolverVersion: row.ResolverVersion,
		CheckedRadiusKM: row.CheckedRadiusKM,
		CheckedRevision: row.CheckedRevision,
		TotalBytes:      row.TotalBytes,
		CreatedAt:       row.CreatedAt,
		LocallyPresent:  present,
	}
}

// Historical records are immutable even if files are missing on this Server.
// Presence is only a directory check; it is NOT a fresh content verification.
func (s *Server) geoNamesSnapshotHistory(ctx context.Context) ([]geoNamesSnapshotDTO, bool) {
	result := make([]geoNamesSnapshotDTO, 0)
	if s == nil || s.DB == nil {
		return result, false
	}
	root, _ := geoNamesSnapshotRoot(s.GeoNamesSnapshotDir, s.GeoNamesDataDir)
	var rows []meta.AdminGeoNamesDatasetSnapshot
	if err := s.DB.WithContext(ctx).Order("created_at DESC, fingerprint ASC").
		Limit(geoNamesSnapshotHistoryLimit).Find(&rows).Error; err != nil {
		return result, false
	}
	for _, row := range rows {
		result = append(result, geoNamesSnapshotDTOForRow(row, root))
	}
	return result, true
}

type geoNamesContextReader struct {
	Context context.Context
	Source  io.Reader
}

func (r geoNamesContextReader) Read(b []byte) (int, error) {
	if err := r.Context.Err(); err != nil {
		return 0, err
	}
	return r.Source.Read(b)
}

func copyGeoNamesSnapshotFile(ctx context.Context, fromDir, toDir string, item geoNamesSnapshotFile, fingerprint hash.Hash) (int64, error) {
	srcPath := filepath.Join(fromDir, item.Name)
	info, err := os.Lstat(srcPath)
	if err != nil {
		return 0, err
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > item.MaxBytes {
		return 0, errors.New("GeoNames source file is not a bounded regular file")
	}
	src, err := os.Open(srcPath)
	if err != nil {
		return 0, err
	}
	defer src.Close()
	dst, err := os.OpenFile(filepath.Join(toDir, item.Name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return 0, err
	}
	hasher := sha256.New()
	size, copyErr := io.Copy(io.MultiWriter(dst, hasher),
		io.LimitReader(geoNamesContextReader{Context: ctx, Source: src}, item.MaxBytes+1))
	if copyErr == nil && (size == 0 || size > item.MaxBytes || size != info.Size()) {
		copyErr = errors.New("GeoNames source file changed or exceeded its size cap")
	}
	if copyErr == nil {
		copyErr = dst.Sync()
	}
	if err := dst.Close(); copyErr == nil {
		copyErr = err
	}
	if copyErr != nil {
		return 0, copyErr
	}
	_, _ = fmt.Fprintf(fingerprint, "%s:%d:%x\n", item.Name, size, hasher.Sum(nil))
	return size, nil
}

func copyAndValidateGeoNamesSnapshot(ctx context.Context, sourceDir, root string, radius float64) (string, string, int64, string, error) {
	temp, err := os.MkdirTemp(root, ".geonames-staging-")
	if err != nil {
		return "", "", 0, "", err
	}
	// Caller owns the staged directory until commit; a failure must never
	// leave a partial or remotely visible dataset.
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(temp)
		}
	}()
	fingerprint := sha256.New()
	var total int64
	for _, item := range geoNamesSnapshotFiles {
		size, err := copyGeoNamesSnapshotFile(ctx, sourceDir, temp, item, fingerprint)
		if err != nil {
			return "", "", 0, "", err
		}
		total += size
		if total > geoNamesSnapshotMaxTotal {
			return "", "", 0, "", errors.New("GeoNames dataset exceeds snapshot size cap")
		}
	}
	if err := ctx.Err(); err != nil {
		return "", "", 0, "", err
	}
	candidate, err := photointelligence.LoadGeoNamesResolver(temp, radius)
	if err != nil {
		return "", "", 0, "", err
	}
	if err := ctx.Err(); err != nil {
		return "", "", 0, "", err
	}
	cleanup = false
	return temp, hex.EncodeToString(fingerprint.Sum(nil)), total, candidate.Version(), nil
}

func (s *Server) adminStageGeoNamesSnapshot(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s.DB == nil || s.GeoNamesRuntime == nil || s.GeoNamesRuntime.Snapshot() == nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames resolver is not configured")
		return
	}
	root, err := geoNamesSnapshotRoot(s.GeoNamesSnapshotDir, s.GeoNamesDataDir)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames snapshot storage requires a separate writable deployment directory")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512)
	var input struct {
		Revision        *uint64 `json:"revision"`
		ExpectedVersion string  `json:"expected_version"`
	}
	if c.ShouldBindJSON(&input) != nil || input.Revision == nil ||
		len(input.ExpectedVersion) == 0 || len(input.ExpectedVersion) > 128 {
		fail(c, http.StatusBadRequest, "current GeoNames revision and expected active version are required")
		return
	}
	if !s.geoNamesSnapshotMu.TryLock() {
		fail(c, http.StatusConflict, "GeoNames dataset snapshot is already running")
		return
	}
	defer s.geoNamesSnapshotMu.Unlock()
	ctx := c.Request.Context()
	active := s.GeoNamesRuntime.Snapshot()
	if active == nil || active.Version() != input.ExpectedVersion {
		fail(c, http.StatusConflict, "GeoNames active dataset changed; refresh and retry")
		return
	}
	desired, err := geoNamesDesiredSettings(ctx, s.DB, s.GeoNamesMaxDistanceKM)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames desired settings are unavailable")
		return
	}
	if desired.Revision != *input.Revision {
		fail(c, http.StatusConflict, "GeoNames settings changed; refresh and retry")
		return
	}
	temp, fingerprint, totalBytes, resolverVersion, err :=
		copyAndValidateGeoNamesSnapshot(ctx, s.GeoNamesDataDir, root, desired.MaxDistanceKM)
	if err != nil {
		fail(c, http.StatusUnprocessableEntity, "GeoNames dataset could not be copied and validated; runtime unchanged")
		return
	}
	defer func() { _ = os.RemoveAll(temp) }()
	// Serialize the final version check/publication with this Server's
	// reload/save/rollback, without holding the lock during the long copy.
	if !s.geoNamesReloadMu.TryLock() {
		fail(c, http.StatusConflict, "GeoNames reload or configuration is in progress")
		return
	}
	defer s.geoNamesReloadMu.Unlock()
	confirmed, err := geoNamesDesiredSettings(ctx, s.DB, s.GeoNamesMaxDistanceKM)
	if err != nil || ctx.Err() != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames settings verification failed")
		return
	}
	if confirmed.Revision != desired.Revision ||
		confirmed.MaxDistanceKM != desired.MaxDistanceKM ||
		s.GeoNamesRuntime.Version() != input.ExpectedVersion {
		fail(c, http.StatusConflict, "GeoNames version changed during snapshot; retry with fresh status")
		return
	}
	destination := filepath.Join(root, fingerprint)
	if _, err := os.Lstat(destination); err == nil {
		fail(c, http.StatusConflict, "This GeoNames dataset fingerprint has already been staged")
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		fail(c, http.StatusServiceUnavailable, "GeoNames snapshot directory cannot be inspected")
		return
	}
	// Atomic same-filesystem publication of fully validated, bounded bytes.
	if err := os.Rename(temp, destination); err != nil {
		fail(c, http.StatusServiceUnavailable, "GeoNames snapshot could not be published")
		return
	}
	// The manifest only becomes visible after the metadata and the audit both
	// commit. On audit/database failure remove this newly created snapshot;
	// neither operation changes the live resolver.
	removeOnError := true
	defer func() {
		if removeOnError {
			_ = os.RemoveAll(destination)
		}
	}()
	row := meta.AdminGeoNamesDatasetSnapshot{
		Fingerprint: fingerprint, ResolverVersion: resolverVersion,
		SourceVersion: active.Version(), CheckedRadiusKM: desired.MaxDistanceKM,
		CheckedRevision: desired.Revision, TotalBytes: totalBytes, CreatedAt: time.Now().UTC(),
	}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var current meta.AdminGeoNamesSetting
		readErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("name = ?", geoNamesSettingName).Take(&current).Error
		if readErr != nil && !errors.Is(readErr, gorm.ErrRecordNotFound) {
			return readErr
		}
		if (readErr == nil && (current.Revision != desired.Revision ||
			current.MaxDistanceKM != desired.MaxDistanceKM)) ||
			(errors.Is(readErr, gorm.ErrRecordNotFound) && desired.Revision != 0) {
			return errGeoNamesRevisionConflict
		}
		if err := tx.Create(&row).Error; err != nil {
			return err
		}
		return recordAuditTx(tx, auditEventFromContext(
			c, "admin.service.geonames.dataset_snapshot", "service", geoNamesSettingName,
			"GeoNames 数据集版本快照", auditpkg.ResultSuccess,
			map[string]any{"fingerprint": fingerprint, "bytes": totalBytes,
				"checked_revision": desired.Revision, "resolver_version": resolverVersion},
		))
	})
	if err != nil {
		if errors.Is(err, errGeoNamesRevisionConflict) {
			fail(c, http.StatusConflict, "GeoNames settings changed; snapshot not retained")
		} else {
			fail(c, http.StatusServiceUnavailable, "GeoNames snapshot manifest and audit could not be persisted")
		}
		return
	}
	removeOnError = false
	c.JSON(http.StatusOK, geoNamesSnapshotResult{
		Staged: true, Applied: false,
		Snapshot: geoNamesSnapshotDTOForRow(row, root),
	})
}
