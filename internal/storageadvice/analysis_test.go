package storageadvice

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"testing"
)

func TestAnalyzeCompressibleBytesAndPackRoundTrip(t *testing.T) {
	samples := make([]Sample, 0, 32)
	for i := 0; i < 32; i++ {
		data := bytes.Repeat([]byte("AAAAAABBBB"), 2000)
		samples = append(samples, Sample{Size: int64(len(data)), AllocatedBytes: 24576, Data: data, Bucket: "small"})
	}
	original := append([]byte(nil), samples[0].Data...)
	result, err := Analyze(context.Background(), samples)
	if err != nil {
		t.Fatal(err)
	}
	if result.SampleObjects != 32 || result.FullObjects != 32 {
		t.Fatalf("unexpected sample count: %+v", result)
	}
	if len(result.Compression) != 2 || result.Compression[0].SavingsPercent < 80 {
		t.Fatalf("unexpected compression: %+v", result.Compression)
	}
	if result.Pack.Objects != 32 || result.Pack.ProjectedSavingsPercent <= 0 {
		t.Fatalf("unexpected pack: %+v", result.Pack)
	}
	if !bytes.Equal(original, samples[0].Data) {
		t.Fatal("input data mutated")
	}
	if len(result.Recommendations) != 4 {
		t.Fatalf("unexpected recommendations: %+v", result.Recommendations)
	}
	if result.Recommendations[3].Decision != "not_recommended" {
		t.Fatal("small objects with limited modeled Pack savings must not be promoted")
	}
}

func TestPackSmallOnlyDatasetCanBeWorthFurtherTests(t *testing.T) {
	samples := make([]Sample, 0, 16)
	for i := 0; i < 16; i++ {
		payload := bytes.Repeat([]byte{byte(i)}, 1024)
		samples = append(samples, Sample{Size: 1024, AllocatedBytes: 4096, Data: payload})
	}
	report, err := Analyze(context.Background(), samples)
	if err != nil {
		t.Fatal(err)
	}
	if report.Confidence != "low" || report.Pack.Objects != 16 {
		t.Fatalf("small-only sample confidence or pack count incorrect: %+v", report)
	}
	if report.Recommendations[3].Decision != "candidate" ||
		report.Recommendations[2].Decision != "observe" {
		t.Fatalf("Pack may justify backup follow-up tests but never online migration: %+v", report.Recommendations)
	}
}

func TestAnalyzeIncompressibleBytesAndPartialSamples(t *testing.T) {
	samples := make([]Sample, 0, 32)
	for i := 0; i < 32; i++ {
		data := make([]byte, 256<<10)
		if _, err := rand.Read(data); err != nil {
			t.Fatal(err)
		}
		samples = append(samples, Sample{Size: 4 << 20, Data: data, Bucket: "large"})
	}
	r, err := Analyze(context.Background(), samples)
	if err != nil {
		t.Fatal(err)
	}
	if r.PartialObjects != 32 || r.Pack.Objects != 0 {
		t.Fatalf("unexpected partial pack: %+v", r)
	}
	if r.Compression[0].SavingsPercent > 5 {
		t.Fatalf("incompressible bytes unexpectedly shrank: %+v", r.Compression[0])
	}
	if r.Recommendations[1].Decision != "not_recommended" {
		t.Fatalf("unexpected compression recommendation: %+v", r.Recommendations[1])
	}
}

func TestAnalyzeSafetyLimitsAndCancellation(t *testing.T) {
	_, err := Analyze(context.Background(), []Sample{{Size: 3, Data: []byte("abcd")}})
	if err == nil {
		t.Fatal("accepted sample larger than object")
	}
	_, err = Analyze(context.Background(), make([]Sample, MaxSamples+1))
	if err == nil {
		t.Fatal("accepted too many samples")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = Analyze(ctx, []Sample{{Size: 1, Data: []byte("a")}})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}

func TestPackAllocationProjectionUsesComparableFourKiBBaselines(t *testing.T) {
	samples := []Sample{
		{Size: 1024, AllocatedBytes: 64 << 10, Data: bytes.Repeat([]byte{'a'}, 1024)},
		{Size: 1024, AllocatedBytes: 128 << 10, Data: bytes.Repeat([]byte{'b'}, 1024)},
	}
	report, err := Analyze(context.Background(), samples)
	if err != nil {
		t.Fatal(err)
	}
	pack := report.Pack
	if pack.SourceAllocatedBytes != 8192 || pack.ProjectedAllocatedBytes != 8192 ||
		pack.ProjectedSavingsPercent != 0 {
		t.Fatalf("mixed physical/model allocation produced an invalid savings ratio: %+v", pack)
	}
	if pack.ObservedSourceObjects != 2 || pack.ObservedSourceAllocatedBytes != 192<<10 {
		t.Fatalf("observed source allocation must remain separate diagnostic evidence: %+v", pack)
	}
}

func TestEmptyReportIsNotRecommendationToMigrate(t *testing.T) {
	r, err := Analyze(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if r.Confidence != "low" || r.Recommendations[0].Decision != "observe" || r.Recommendations[3].Decision != "observe" {
		t.Fatalf("empty report must only recommend observing: %+v", r)
	}
}
