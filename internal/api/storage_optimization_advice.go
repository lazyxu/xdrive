package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/storage"
	"github.com/lazyxu/xdrive/internal/storageadvice"
	"gorm.io/gorm"
)

const (
	optimizationMaxPerBand      = 16
	optimizationReadPrefixBytes = 512 << 10
)

type optimizationAdviceResponse struct {
	Status      string                `json:"status"`
	RunID       uint64                `json:"run_id,omitempty"`
	GeneratedAt *time.Time            `json:"generated_at,omitempty"`
	Error       string                `json:"error,omitempty"`
	Report      *storageadvice.Report `json:"report,omitempty"`
}

func (s *Server) adminStorageOptimizationAdvice(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	if s == nil || s.DB == nil {
		fail(c, http.StatusServiceUnavailable, "optimization advice is unavailable")
		return
	}
	var latest meta.SystemMaintenanceRun
	err := s.DB.WithContext(c.Request.Context()).
		Where("kind = ?", meta.SystemMaintenanceKindStorageOptimization).
		Order("id DESC").First(&latest).Error
	if err != nil {
		// A fresh instance has no evaluation, not a zero-percent compression result.
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusOK, optimizationAdviceResponse{Status: "not_run"})
		} else {
			fail(c, http.StatusInternalServerError, "read optimization status failed")
		}
		return
	}
	result := optimizationAdviceResponse{
		Status: latest.Status, RunID: latest.ID, Error: latest.Error,
	}
	// If a new run is queued/running, retain the last verified report, never
	// accidentally show a partial or failed run's advisory as completed data.
	var completed meta.SystemMaintenanceRun
	err = s.DB.WithContext(c.Request.Context()).
		Where("kind = ? AND status = ? AND report_json <> ''",
			meta.SystemMaintenanceKindStorageOptimization, meta.SystemMaintenanceStatusSuccess).
		Order("id DESC").First(&completed).Error
	if err == nil && completed.ReportJSON != "" {
		var report storageadvice.Report
		if json.Unmarshal([]byte(completed.ReportJSON), &report) == nil {
			result.Report = &report
			result.GeneratedAt = completed.FinishedAt
		}
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusInternalServerError, "read optimization report failed")
		return
	}
	c.JSON(http.StatusOK, result)
}

// statBlocks returns actual Linux-allocated bytes when available. On other
// systems the 4KiB model is explicit; we never claim a projected number is
// measured disk space.
func optimizationAllocatedBytes(info any) int64 {
	if info == nil {
		return 0
	}
	value := reflect.ValueOf(info)
	for value.IsValid() && value.Kind() == reflect.Pointer {
		if value.IsNil() {
			return 0
		}
		value = value.Elem()
	}
	if !value.IsValid() || value.Kind() != reflect.Struct {
		return 0
	}
	blocks := value.FieldByName("Blocks")
	if !blocks.IsValid() {
		return 0
	}
	switch blocks.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		n := blocks.Int()
		if n > 0 {
			return n * 512
		}
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		n := blocks.Uint()
		if n > 0 && n < 1<<50 {
			return int64(n * 512)
		}
	}
	return 0
}

// Read at most 64 committed, READY, referenced canonical CAS objects, with a
// maximum of 512KiB per object. There is no full-tree scan or scratch write.
func (s *Server) captureStorageOptimizationAdvice(
	ctx context.Context,
	progress func(done, total int64, message string),
) (storageadvice.Report, error) {
	reader, ok := s.Store.(storage.CASReadLeaseProvider)
	if !ok {
		return storageadvice.Report{}, errors.New("pinned CAS reading is unavailable")
	}
	bands := []struct {
		name         string
		lower, upper int64
	}{
		{"small (<64KiB)", 1, 64 << 10},
		{"medium (64KiB–1MiB)", 64 << 10, 1 << 20},
		{"large (1–16MiB)", 1 << 20, 16 << 20},
		{"huge (>=16MiB)", 16 << 20, 0},
	}
	samples := make([]storageadvice.Sample, 0, storageadvice.MaxSamples)
	var skipped int
	for bandIndex, band := range bands {
		if err := ctx.Err(); err != nil {
			return storageadvice.Report{}, err
		}
		query := s.DB.WithContext(ctx).Model(&meta.ContentBlob{}).
			Where("state = ? AND ref_count > 0 AND size >= ?", meta.ContentBlobStateReady, band.lower)
		if band.upper > 0 {
			query = query.Where("size < ?", band.upper)
		}
		var candidates []meta.ContentBlob
		if err := query.Order("sha256 ASC").Limit(optimizationMaxPerBand).Find(&candidates).Error; err != nil {
			return storageadvice.Report{}, err
		}
		for _, item := range candidates {
			if err := ctx.Err(); err != nil {
				return storageadvice.Report{}, err
			}
			key, err := storage.ContentAddressedKey(item.SHA256)
			if err != nil || key != item.StorageKey || item.Size <= 0 {
				skipped++
				continue
			}
			stream, err := reader.OpenPinnedCAS(ctx, key)
			if err != nil {
				skipped++
				continue
			}
			info, err := stream.Stat()
			if err != nil || !info.Mode().IsRegular() || info.Size() != item.Size {
				_ = stream.Close()
				skipped++
				continue
			}
			size := item.Size
			if size > optimizationReadPrefixBytes {
				size = optimizationReadPrefixBytes
			}
			payload := make([]byte, int(size))
			_, err = io.ReadFull(stream, payload)
			closeErr := stream.Close()
			if err != nil || closeErr != nil {
				skipped++
				continue
			}
			if int64(len(payload)) == item.Size {
				digest := sha256.Sum256(payload)
				if hex.EncodeToString(digest[:]) != item.SHA256 {
					skipped++
					continue
				}
			}
			samples = append(samples, storageadvice.Sample{
				Size: item.Size, AllocatedBytes: optimizationAllocatedBytes(info.Sys()),
				Data: payload, Bucket: band.name,
			})
		}
		if progress != nil {
			progress(int64(bandIndex+1), int64(len(bands)), band.name)
		}
	}
	report, err := storageadvice.Analyze(ctx, samples)
	if err != nil {
		return report, fmt.Errorf("analyze read-only CAS samples: %w", err)
	}
	report.SkippedObjects = skipped
	if skipped > 0 {
		report.Limitations = append(report.Limitations,
			fmt.Sprintf("%d candidate objects were skipped due to missing/unsafe/inconsistent reads; inspect CAS health separately", skipped))
	}
	if len(samples) == 0 {
		report.Limitations = append(report.Limitations, "No eligible referenced canonical CAS objects were available; do not infer 0% compression savings.")
	}
	return report, nil
}

// Stored in the durable system maintenance row; available in Global Storage
// across Web/Desktop reloads and Server restarts.
func (s *Server) evaluateStorageOptimizationTask(ctx context.Context, runID uint64) (string, error) {
	report, err := s.captureStorageOptimizationAdvice(ctx, func(done, total int64, message string) {
		s.updateSystemMaintenanceRunProgress(ctx, runID, backgroundTaskProgressDTO{
			Phase:   meta.SystemMaintenancePhaseStorageOptimization,
			Current: done, Total: total, Unit: "step", CurrentItem: message,
		})
	})
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal(report)
	if err != nil {
		return "", err
	}
	if err = ctx.Err(); err != nil {
		return "", err
	}
	row := s.DB.WithContext(ctx).Model(&meta.SystemMaintenanceRun{}).
		Where("id = ? AND status = ?", runID, meta.SystemMaintenanceStatusRunning).
		Update("report_json", string(raw))
	if row.Error != nil {
		return "", row.Error
	}
	if row.RowsAffected != 1 {
		return "", errors.New("optimization report no longer owns the active run")
	}
	if report.SampleObjects == 0 {
		return "样本不足：没有可安全读取的已引用 CAS Blob，未生成格式切换建议", nil
	}
	return fmt.Sprintf(
		"只读评估完成 · %d 个样本 · %d bytes · gzip-1 节省 %.1f%% · Pack 模型 %.1f%%（未修改存储）",
		report.SampleObjects, report.SampleBytes, report.Compression[0].SavingsPercent, report.Pack.ProjectedSavingsPercent,
	), nil
}
