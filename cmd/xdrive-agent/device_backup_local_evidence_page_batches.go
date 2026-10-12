package main

import (
	"context"
	"errors"

	"github.com/lazyxu/xdrive/internal/client"
)

const (
	localPhysicalPageMaxBatches = 4
	localPhysicalPageBatchItems = 4
	localPhysicalPageBatchBytes = int64(64 << 20)
	localPhysicalPageTotalBytes = int64(256 << 20)
)

// localPhysicalPagePlan is strictly Agent-private and ephemeral. Not a
// SourceRun checkpoint, per-file result, or durable cloud-byte attestation.
type localPhysicalPagePlan struct {
	Batches       [][]client.LocalEvidenceCloudDigest
	SelectedFiles int
	SelectedBytes int64
}

// planLocalEvidencePhysicalPage keeps evidence in increasing-ID order and
// consumes at most four sequential Server calls, 16 files and 256MiB of
// physical reads for one already verified 64-item evidence page. Oversized
// claims are deliberately NOT sampled and must never count as verified.
func planLocalEvidencePhysicalPage(
	claims []client.LocalEvidenceCloudDigest,
) (localPhysicalPagePlan, error) {
	var plan localPhysicalPagePlan
	var current []client.LocalEvidenceCloudDigest
	var currentBytes int64
	var priorID uint64
	for _, claim := range claims {
		if claim.EvidenceID == 0 || claim.EvidenceID <= priorID || claim.Size < 0 {
			return localPhysicalPagePlan{}, errors.New("invalid ordered physical evidence")
		}
		priorID = claim.EvidenceID
		if claim.Size > localPhysicalPageBatchBytes ||
			claim.Size > localPhysicalPageTotalBytes-plan.SelectedBytes {
			continue
		}
		if len(current) != 0 && (len(current) == localPhysicalPageBatchItems ||
			claim.Size > localPhysicalPageBatchBytes-currentBytes) {
			plan.Batches = append(plan.Batches, current)
			current = nil
			currentBytes = 0
		}
		if len(plan.Batches) == localPhysicalPageMaxBatches {
			continue
		}
		current = append(current, claim)
		currentBytes += claim.Size
		plan.SelectedFiles++
		plan.SelectedBytes += claim.Size
	}
	if len(current) != 0 {
		plan.Batches = append(plan.Batches, current)
	}
	return plan, nil
}

// observeLocalEvidencePhysicalBatches emits NO partial success if a later
// batch fails, the Server overstates any authority, or the request is
// canceled. A successful return remains only a transient sampled observation.
func observeLocalEvidencePhysicalBatches(
	ctx context.Context, sourceID, revision uint64,
	batches [][]client.LocalEvidenceCloudDigest,
	verify func(context.Context, []client.LocalEvidenceCloudDigest) (client.LocalEvidencePhysicalCAS, error),
) (int, int64, error) {
	if ctx == nil || sourceID == 0 || revision == 0 || verify == nil ||
		len(batches) > localPhysicalPageMaxBatches {
		return 0, 0, errors.New("invalid private physical evidence operation")
	}
	// Validate the ENTIRE work plan before opening any physical objects.
	// A malformed later batch must not execute an earlier Store read.
	var previousID uint64
	var plannedBytes int64
	var plannedFiles int
	for _, batch := range batches {
		if len(batch) == 0 || len(batch) > localPhysicalPageBatchItems {
			return 0, 0, errors.New("invalid physical evidence batch size")
		}
		var batchBytes int64
		for _, claim := range batch {
			if claim.EvidenceID == 0 || claim.EvidenceID <= previousID ||
				claim.Size < 0 || claim.Size > localPhysicalPageBatchBytes-batchBytes ||
				claim.Size > localPhysicalPageTotalBytes-plannedBytes-batchBytes {
				return 0, 0, errors.New("invalid physical evidence batch budget or order")
			}
			previousID = claim.EvidenceID
			batchBytes += claim.Size
		}
		plannedFiles += len(batch)
		plannedBytes += batchBytes
	}
	for _, batch := range batches {
		if err := ctx.Err(); err != nil {
			return 0, 0, err
		}
		observed, err := verify(ctx, batch)
		if err != nil || observed.SourceID != sourceID ||
			observed.Revision != revision || observed.Checked != len(batch) ||
			!observed.CloudMetadataMatched || !observed.PhysicalCASMatched ||
			observed.CloudBytesVerified || observed.ContentVerified ||
			observed.CommitSupported || observed.Authoritative ||
			observed.MissingInferenceSafe {
			return 0, 0, errors.New("physical CAS batch no longer matches original")
		}
		if err := ctx.Err(); err != nil {
			return 0, 0, err
		}
	}
	return plannedFiles, plannedBytes, nil
}
