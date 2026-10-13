package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// LocalPushPhysicalStagingPreflight is a private, ephemeral read-only result.
// A true PhysicalStagingMatched does not attest an Agent's original bytes,
// acquire an immutable CAS pin, start a SourceRun or grant a file commit.
type LocalPushPhysicalStagingPreflight struct {
	SourceID               uint64
	Revision               uint64
	StageID                string
	Size                   int64
	PhysicalStagingMatched bool
	ContentVerified        bool
	CommitSupported        bool
	Authoritative          bool
	MissingInferenceSafe   bool
}

// PreflightLocalPushStagingPhysical invokes only the device-bound, bounded
// Server-side physical temporary byte observation. This is never a generic
// owner-JWT-only upload call and is not called by Desktop/Web or a scheduler.
func (c *Client) PreflightLocalPushStagingPhysical(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	stageID string, size int64,
) (LocalPushPhysicalStagingPreflight, error) {
	var empty LocalPushPhysicalStagingPreflight
	id, err := uuid.Parse(stageID)
	if !validLocalPushStageProof(ctx, sourceID, revision, proof) ||
		err != nil || id.String() != stageID ||
		size < 0 || size > localPushStageLimitBytes {
		return empty, errors.New("invalid private physical temporary staging request")
	}
	req, err := c.request(ctx, http.MethodGet,
		localPushStagingURL(sourceID, stageID)+"/content-preflight", nil)
	if err != nil {
		return empty, err
	}
	localPushStageRequestHeaders(req, revision, proof)
	resp, err := c.do(req)
	if err != nil {
		return empty, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return empty, responseError(resp)
	}
	if resp.Header.Get("ETag") != strconv.Quote(strconv.FormatUint(revision, 10)) ||
		!strings.Contains(strings.ToLower(resp.Header.Get("Cache-Control")), "no-store") {
		return empty, errors.New("unfenced private temporary physical response")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2049))
	if err != nil || len(raw) > 2048 {
		return empty, errors.New("oversized private physical staging response")
	}
	var out struct {
		SourceID               uint64 `json:"source_id"`
		Revision               uint64 `json:"revision"`
		StageID                string `json:"stage_id"`
		Size                   int64  `json:"size"`
		PhysicalStagingMatched *bool  `json:"physical_staging_matched"`
		ContentVerified        *bool  `json:"content_verified"`
		CommitSupported        *bool  `json:"commit_supported"`
		Authoritative          *bool  `json:"authoritative"`
		MissingInferenceSafe   *bool  `json:"missing_inference_safe"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&out); err != nil {
		return empty, errors.New("invalid private physical staging response")
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return empty, errors.New("trailing private physical staging response")
	}
	if out.SourceID != sourceID || out.Revision != revision ||
		out.StageID != stageID || out.Size != size ||
		out.PhysicalStagingMatched == nil || !*out.PhysicalStagingMatched ||
		out.ContentVerified == nil || *out.ContentVerified ||
		out.CommitSupported == nil || *out.CommitSupported ||
		out.Authoritative == nil || *out.Authoritative ||
		out.MissingInferenceSafe == nil || *out.MissingInferenceSafe {
		return empty, fmt.Errorf("unauthorized or mismatched private physical staging response")
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	return LocalPushPhysicalStagingPreflight{
		SourceID: sourceID, Revision: revision,
		StageID: stageID, Size: size,
		PhysicalStagingMatched: true,
		ContentVerified:        false, CommitSupported: false,
		Authoritative: false, MissingInferenceSafe: false,
	}, nil
}
