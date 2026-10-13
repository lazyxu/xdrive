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
	"time"

	"github.com/google/uuid"
)

const localPushStageLimitBytes = int64(64 << 20)

// LocalPushStagingInput is an Agent-private temporary transport description.
// A native journal and Root must be verified BEFORE using this transport.
// None of these caller-supplied digests are Server upload/commit authority.
type LocalPushStagingInput struct {
	CurrentSnapshotSHA256 string `json:"current_snapshot_sha256"`
	CurrentPathKey        string `json:"current_path_key"`
	SHA256                string `json:"sha256"`
	Size                  int64  `json:"size"`
}

type LocalPushStagingResult struct {
	StageID              string    `json:"stage_id"`
	SourceID             uint64    `json:"source_id"`
	Revision             uint64    `json:"revision"`
	Size                 int64     `json:"size"`
	Status               string    `json:"status"`
	ExpiresAt            time.Time `json:"expires_at"`
	ContentVerified      bool      `json:"content_verified"`
	CommitSupported      bool      `json:"commit_supported"`
	Authoritative        bool      `json:"authoritative"`
	MissingInferenceSafe bool      `json:"missing_inference_safe"`
}

func validLocalPushStagingInput(input LocalPushStagingInput) bool {
	return input.Size >= 0 && input.Size <= localPushStageLimitBytes &&
		validLocalEvidenceGenerationDigest(input.CurrentSnapshotSHA256) &&
		validLocalEvidenceGenerationDigest(input.CurrentPathKey) &&
		validLocalEvidenceGenerationDigest(input.SHA256)
}

func validateLocalPushStagingOutput(
	resp *http.Response, sourceID, revision, size uint64, stageID string,
) (LocalPushStagingResult, error) {
	var empty LocalPushStagingResult
	if resp == nil {
		return empty, errors.New("missing owning-Agent staging response")
	}
	if resp.Header.Get("ETag") != strconv.Quote(strconv.FormatUint(revision, 10)) ||
		!strings.Contains(strings.ToLower(resp.Header.Get("Cache-Control")), "no-store") {
		return empty, errors.New("unfenced owning-Agent staging response")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2049))
	if err != nil || len(raw) > 2048 {
		return empty, errors.New("oversized owning-Agent staging response")
	}
	// Stage bytes are NEVER canonical upload success. Require all explicit
	// negative authority flags, not just their zero-value defaults.
	var flags map[string]json.RawMessage
	if err := json.Unmarshal(raw, &flags); err != nil {
		return empty, errors.New("invalid private staging authority flags")
	}
	for _, field := range []string{
		"content_verified", "commit_supported", "authoritative", "missing_inference_safe",
	} {
		if string(flags[field]) != "false" {
			return empty, errors.New("private staging cannot grant canonical authority")
		}
	}
	var out LocalPushStagingResult
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&out); err != nil {
		return empty, errors.New("invalid owning-Agent staging response")
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return empty, errors.New("trailing owning-Agent staging response")
	}
	parsed, err := uuid.Parse(out.StageID)
	if err != nil || parsed.String() != out.StageID ||
		out.SourceID != sourceID || out.Revision != revision ||
		out.Size < 0 || uint64(out.Size) != size ||
		(stageID != "" && out.StageID != stageID) ||
		out.ExpiresAt.IsZero() {
		return empty, errors.New("mismatched owning-Agent staging response")
	}
	switch out.Status {
	case "reserved", "writing", "staged", "failed", "canceled":
	default:
		return empty, errors.New("unknown owning-Agent staging state")
	}
	return out, nil
}

func localPushStagingURL(sourceID uint64, stageID string) string {
	base := fmt.Sprintf("/api/v1/sources/%d/local-staging", sourceID)
	if stageID != "" {
		return base + "/" + stageID
	}
	return base
}

func validLocalPushStageProof(ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof) bool {
	return ctx != nil && ctx.Err() == nil && sourceID > 0 && revision > 0 &&
		proof.DeviceID != "" && proof.DeviceToken != "" &&
		proof.RootID != "" && proof.RootFingerprint != ""
}

func localPushStageRequestHeaders(req *http.Request, revision uint64, proof LocalBoundSourceProof) {
	req.Header.Set("If-Match", strconv.Quote(strconv.FormatUint(revision, 10)))
	localRulesProofHeaders(req, proof)
}

// ReserveLocalPushStaging creates/reuses one temporary, device-bound stage.
// It never calls /uploads, finalizes a File or starts a SourceRun.
func (c *Client) ReserveLocalPushStaging(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	input LocalPushStagingInput,
) (LocalPushStagingResult, error) {
	var empty LocalPushStagingResult
	if !validLocalPushStageProof(ctx, sourceID, revision, proof) ||
		!validLocalPushStagingInput(input) {
		return empty, errors.New("invalid owning-Agent staging reservation")
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return empty, err
	}
	req, err := c.request(ctx, http.MethodPost, localPushStagingURL(sourceID, ""),
		bytes.NewReader(payload))
	if err != nil {
		return empty, err
	}
	req.Header.Set("Content-Type", "application/json")
	localPushStageRequestHeaders(req, revision, proof)
	resp, err := c.do(req)
	if err != nil {
		return empty, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return empty, responseError(resp)
	}
	return validateLocalPushStagingOutput(resp, sourceID, revision,
		uint64(input.Size), "")
}

// PutLocalPushStagingBytes sends actual native bytes through this dedicated
// temporary endpoint, not a generic owner-JWT UploadSession. A short/inexact
// body fails at the Server; successful status is NOT a canonical commit.
func (c *Client) PutLocalPushStagingBytes(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	stageID string, size int64, original io.Reader,
) (LocalPushStagingResult, error) {
	var empty LocalPushStagingResult
	if !validLocalPushStageProof(ctx, sourceID, revision, proof) ||
		original == nil || size < 0 || size > localPushStageLimitBytes {
		return empty, errors.New("invalid owning-Agent staging content input")
	}
	parsed, err := uuid.Parse(stageID)
	if err != nil || parsed.String() != stageID {
		return empty, errors.New("invalid owning-Agent staging ID")
	}
	req, err := c.request(ctx, http.MethodPut,
		localPushStagingURL(sourceID, stageID)+"/content",
		io.LimitReader(original, size+1))
	if err != nil {
		return empty, err
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	localPushStageRequestHeaders(req, revision, proof)
	resp, err := c.do(req)
	if err != nil {
		return empty, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return empty, responseError(resp)
	}
	out, err := validateLocalPushStagingOutput(resp, sourceID, revision,
		uint64(size), stageID)
	if err != nil || out.Status != "staged" {
		return empty, errors.New("native staging bytes were not accepted")
	}
	return out, ctx.Err()
}

func (c *Client) ReadLocalPushStaging(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	stageID string, size int64,
) (LocalPushStagingResult, error) {
	var empty LocalPushStagingResult
	if !validLocalPushStageProof(ctx, sourceID, revision, proof) ||
		size < 0 || size > localPushStageLimitBytes {
		return empty, errors.New("invalid owning-Agent stage read")
	}
	parsed, err := uuid.Parse(stageID)
	if err != nil || parsed.String() != stageID {
		return empty, errors.New("invalid owning-Agent staging ID")
	}
	req, err := c.request(ctx, http.MethodGet, localPushStagingURL(sourceID, stageID), nil)
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
	return validateLocalPushStagingOutput(resp, sourceID, revision,
		uint64(size), stageID)
}

func (c *Client) CancelLocalPushStaging(
	ctx context.Context, sourceID, revision uint64, proof LocalBoundSourceProof,
	stageID string,
) error {
	if !validLocalPushStageProof(ctx, sourceID, revision, proof) {
		return errors.New("invalid owning-Agent stage cancellation")
	}
	parsed, err := uuid.Parse(stageID)
	if err != nil || parsed.String() != stageID {
		return errors.New("invalid owning-Agent staging ID")
	}
	req, err := c.request(ctx, http.MethodDelete, localPushStagingURL(sourceID, stageID), nil)
	if err != nil {
		return err
	}
	localPushStageRequestHeaders(req, revision, proof)
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return responseError(resp)
	}
	if !strings.Contains(strings.ToLower(resp.Header.Get("Cache-Control")), "no-store") {
		return errors.New("cacheable owning-Agent staging cancel response")
	}
	return ctx.Err()
}
