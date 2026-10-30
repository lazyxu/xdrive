// Package storageadvice evaluates read-only bounded samples of immutable CAS
// objects. It NEVER rewrites live storage or publishes a packing/compression
// format. All proposed savings are advisory, not capacity commitments.
package storageadvice

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"time"
)

const (
	MaxSamples          = 64
	MaxTotalSampleBytes = 32 << 20
	SmallBlobLimit      = 64 << 10
	assumedBlockBytes   = 4096
	indexEntryBytes     = 48
)

type Sample struct {
	Size           int64  // Full immutable object size, even when only a prefix was read.
	AllocatedBytes int64  // Actual physical allocation where OS exposes it.
	Data           []byte // Bounded prefix, never the original Store file.
	Bucket         string
}

type CompressionResult struct {
	Algorithm      string  `json:"algorithm"`
	SampleBytes    int64   `json:"sample_bytes"`
	OutputBytes    int64   `json:"output_bytes"`
	Ratio          float64 `json:"ratio"`
	SavingsPercent float64 `json:"savings_percent"`
	CompressMS     int64   `json:"compress_ms"`
	DecompressMS   int64   `json:"decompress_ms"`
}

type PackResult struct {
	Objects                 int     `json:"objects"`
	PayloadBytes            int64   `json:"payload_bytes"`
	IndexBytes              int64   `json:"index_bytes"`
	SourceAllocatedBytes    int64   `json:"source_allocated_bytes"`
	ProjectedAllocatedBytes int64   `json:"projected_allocated_bytes"`
	ProjectedSavingsPercent float64 `json:"projected_savings_percent"`
	BuildMS                 int64   `json:"build_ms"`
	AllocationModel         string  `json:"allocation_model"`

	// Actual source blocks are diagnostic only. Never mix measured source
	// allocation with a hypothetical 4KiB Pack allocation in one ratio.
	ObservedSourceAllocatedBytes int64 `json:"observed_source_allocated_bytes,omitempty"`
	ObservedSourceObjects        int   `json:"observed_source_objects,omitempty"`
}

type Recommendation struct {
	Scope    string `json:"scope"`    // online_storage or backup_repository
	Feature  string `json:"feature"`  // compression or pack
	Decision string `json:"decision"` // observe, candidate, or not_recommended
	Reason   string `json:"reason"`
}

type Report struct {
	SampleObjects   int                 `json:"sample_objects"`
	SampleBytes     int64               `json:"sample_bytes"`
	PartialObjects  int                 `json:"partial_objects"`
	FullObjects     int                 `json:"full_objects"`
	SkippedObjects  int                 `json:"skipped_objects"`
	Confidence      string              `json:"confidence"`
	SampleMethod    string              `json:"sample_method"`
	Compression     []CompressionResult `json:"compression"`
	Pack            PackResult          `json:"pack"`
	Recommendations []Recommendation    `json:"recommendations"`
	Limitations     []string            `json:"limitations"`
}

func roundUp(value, block int64) int64 {
	if value <= 0 {
		return 0
	}
	return ((value + block - 1) / block) * block
}

func gzipRoundTrip(ctx context.Context, samples []Sample, level int) (CompressionResult, error) {
	result := CompressionResult{Algorithm: fmt.Sprintf("gzip-%d", level)}
	var compressTime, decompressTime time.Duration
	for _, sample := range samples {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if len(sample.Data) == 0 {
			continue
		}
		result.SampleBytes += int64(len(sample.Data))
		var output bytes.Buffer
		start := time.Now()
		writer, err := gzip.NewWriterLevel(&output, level)
		if err != nil {
			return result, err
		}
		if _, err = writer.Write(sample.Data); err != nil {
			_ = writer.Close()
			return result, err
		}
		if err = writer.Close(); err != nil {
			return result, err
		}
		compressTime += time.Since(start)
		result.OutputBytes += int64(output.Len())
		start = time.Now()
		reader, err := gzip.NewReader(bytes.NewReader(output.Bytes()))
		if err != nil {
			return result, err
		}
		decoded, err := io.ReadAll(io.LimitReader(reader, int64(len(sample.Data))+1))
		closeErr := reader.Close()
		if err != nil {
			return result, err
		}
		if closeErr != nil {
			return result, closeErr
		}
		if !bytes.Equal(sample.Data, decoded) {
			return result, errors.New("compression round-trip bytes do not match")
		}
		decompressTime += time.Since(start)
	}
	// Accumulate sub-millisecond work before converting. Rounding each of
	// up to 64 tiny objects independently can otherwise report 0 ms.
	result.CompressMS = compressTime.Milliseconds()
	result.DecompressMS = decompressTime.Milliseconds()
	if result.SampleBytes > 0 {
		result.Ratio = float64(result.OutputBytes) / float64(result.SampleBytes)
		result.SavingsPercent = 100 * (1 - result.Ratio)
	}
	return result, nil
}

// evaluatePack simulates a single immutable pack + 48-byte SHA/offset index
// in memory. Both source and packed allocation use the same explicit 4KiB
// model, NOT measured disk write amplification or live read/GC performance.
func evaluatePack(ctx context.Context, samples []Sample) (PackResult, error) {
	result := PackResult{AllocationModel: "4KiB source-block/pack+index projection (no disk writes)"}
	type entry struct {
		offset int64
		data   []byte
		hash   [32]byte
	}
	entries := make([]entry, 0, len(samples))
	var pack bytes.Buffer
	var index bytes.Buffer
	start := time.Now()
	for _, sample := range samples {
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if sample.Size <= 0 || sample.Size > SmallBlobLimit || int64(len(sample.Data)) != sample.Size {
			continue
		}
		offset := int64(pack.Len())
		if _, err := pack.Write(sample.Data); err != nil {
			return result, err
		}
		digest := sha256.Sum256(sample.Data)
		record := make([]byte, indexEntryBytes)
		binary.LittleEndian.PutUint64(record[0:8], uint64(offset))
		binary.LittleEndian.PutUint32(record[8:12], uint32(sample.Size))
		copy(record[12:44], digest[:])
		if _, err := index.Write(record); err != nil {
			return result, err
		}
		entries = append(entries, entry{offset: offset, data: sample.Data, hash: digest})
		result.Objects++
		result.PayloadBytes += sample.Size
		// Both sides of the projected savings ratio MUST use the same
		// assumed 4KiB allocation model; real filesystem blocks may use
		// different granularity, compression, sparse extents or reflinks.
		result.SourceAllocatedBytes += roundUp(sample.Size, assumedBlockBytes)
		if sample.AllocatedBytes > 0 {
			result.ObservedSourceAllocatedBytes += sample.AllocatedBytes
			result.ObservedSourceObjects++
		}
	}
	for i, entry := range entries {
		record := index.Bytes()[i*indexEntryBytes : (i+1)*indexEntryBytes]
		offset := int64(binary.LittleEndian.Uint64(record[0:8]))
		length := int(binary.LittleEndian.Uint32(record[8:12]))
		if offset != entry.offset || length != len(entry.data) || offset < 0 ||
			offset+int64(length) > int64(pack.Len()) {
			return result, errors.New("pack index offset/length mismatch")
		}
		data := pack.Bytes()[int(offset) : int(offset)+length]
		digest := sha256.Sum256(data)
		if digest != entry.hash || !bytes.Equal(record[12:44], digest[:]) || !bytes.Equal(data, entry.data) {
			return result, errors.New("pack/index hash readback mismatch")
		}
	}
	result.IndexBytes = int64(index.Len())
	if result.Objects > 0 {
		result.ProjectedAllocatedBytes = roundUp(int64(pack.Len()), assumedBlockBytes) + roundUp(int64(index.Len()), assumedBlockBytes)
		if result.SourceAllocatedBytes > 0 {
			result.ProjectedSavingsPercent = 100 * (1 - float64(result.ProjectedAllocatedBytes)/float64(result.SourceAllocatedBytes))
		}
	}
	result.BuildMS = time.Since(start).Milliseconds()
	return result, nil
}

func Analyze(ctx context.Context, samples []Sample) (Report, error) {
	report := Report{
		SampleMethod: "SHA-ordered stratified immutable CAS prefixes, max 16 per size band, max 512KiB/object and 32MiB total",
		Limitations: []string{
			"Bounded prefixes do not represent full-object compression for large blobs; no extrapolation to total instance bytes.",
			"Pack savings use a 4KiB allocation model; no production I/O, random-read P99, remote latency or GC measured.",
			"No file type/MIME inference from CAS hashes; results apply only to the sampled bytes.",
			"No change to online storage, backup repository, encryption, compression or pack settings.",
			"zstd/LZ4 and cold I/O are not tested in this lightweight run; compare independently before any format choice.",
		},
	}
	if len(samples) > MaxSamples {
		return report, errors.New("too many samples")
	}
	for _, sample := range samples {
		if err := ctx.Err(); err != nil {
			return report, err
		}
		report.SampleObjects++
		report.SampleBytes += int64(len(sample.Data))
		if int64(len(sample.Data)) == sample.Size {
			report.FullObjects++
		} else {
			report.PartialObjects++
		}
		if sample.Size < 0 || int64(len(sample.Data)) > sample.Size || report.SampleBytes > MaxTotalSampleBytes {
			return report, errors.New("sample size cap exceeded")
		}
	}
	report.Confidence = "low"
	if report.SampleObjects >= 24 && report.SampleBytes >= 4<<20 {
		report.Confidence = "medium"
	}
	for _, level := range []int{gzip.BestSpeed, 6} {
		result, err := gzipRoundTrip(ctx, samples, level)
		if err != nil {
			return report, err
		}
		report.Compression = append(report.Compression, result)
	}
	var err error
	report.Pack, err = evaluatePack(ctx, samples)
	if err != nil {
		return report, err
	}
	compressionDecision := "observe"
	compressionReason := "当前有效样本不足，继续积累不同大小与内容类型的对象；暂不启用压缩。"
	if report.Confidence == "medium" && len(report.Compression) > 0 {
		if report.Compression[0].SavingsPercent >= 15 {
			compressionDecision = "candidate"
			compressionReason = "真实字节的 gzip-fast 试验节省至少15%，可在独立备份仓库进一步比较 zstd 与恢复耗时；不代表全部文件都值得压缩。"
		} else {
			compressionDecision = "not_recommended"
			compressionReason = "当前前缀样本 gzip-fast 节省不足15%，优先保留原始不可变 Blob，并继续观察。"
		}
	}
	packDecision := "observe"
	packReason := "小文件样本不足或物理空间模型收益未达到阈值，保持独立 CAS 文件。"
	if report.Pack.Objects >= 16 {
		if report.Pack.ProjectedSavingsPercent >= 25 {
			packDecision = "candidate"
			packReason = "对小 Blob 的 Pack+Index 物理占用模型节省至少25%；应优先在备份仓库做真实磁盘和冷读测试。"
		} else {
			packDecision = "not_recommended"
			packReason = "小 Blob Pack 的模型节省不足25%，当前没有充分的格式迁移依据。"
		}
	}
	report.Recommendations = []Recommendation{
		{Scope: "online_storage", Feature: "compression", Decision: "observe", Reason: "在线 CAS 必须维持原字节、Range 和不可变 SHA 语义；仅抽样结果不足以决定上线压缩格式。"},
		{Scope: "backup_repository", Feature: "compression", Decision: compressionDecision, Reason: compressionReason},
		{Scope: "online_storage", Feature: "pack", Decision: "observe", Reason: "现有 CAS-A05/A06 只是离线证据；正式在线存储仍需测真实随机读、GC、锁和故障恢复。"},
		{Scope: "backup_repository", Feature: "pack", Decision: packDecision, Reason: packReason},
	}
	return report, nil
}
