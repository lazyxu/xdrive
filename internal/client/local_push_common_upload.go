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

const localPushCommonUploadReplyLimit = 2048

// LocalPushCommonUploadInput is assembled ONLY by the owning Agent from a
// verified native Inventory snapshot and a stable, persisted Operation ID.
// It is never accepted from Renderer or Web. The Server checks Owner/Device/
// Root/Source independently; IDs, digests and resume keys are not credentials.
type LocalPushCommonUploadInput struct {
	OperationID      string  `json:"operation_id"`
	ResumeKey        string  `json:"resume_key"`
	SHA256           string  `json:"sha256"`
	Size             int64   `json:"size"`
	ParentID         *uint64 `json:"parent_id,omitempty"`
	NodeID           *uint64 `json:"node_id,omitempty"`
	Name             string  `json:"name,omitempty"`
	ExpectedRevision uint64  `json:"expected_revision,omitempty"`
}

// These private receipts MUST NOT be serialized through Agent IPC/Web.
type LocalPushCommonUploadStatus struct {
	SourceID    uint64 `json:"-"`
	Revision    uint64 `json:"-"`
	OperationID string `json:"-"`
	State       string `json:"-"`
}

type LocalPushCommonUploadReceipt struct {
	SourceID      uint64 `json:"-"`
	Revision      uint64 `json:"-"`
	OperationID   string `json:"-"`
	State         string `json:"-"`
	Committed     bool   `json:"-"`
	NodeID        uint64 `json:"-"`
	NodeRevision  uint64 `json:"-"`
	ContentSHA256 string `json:"-"`
	Size          int64  `json:"-"`
}

func validLocalPushCommonUUID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id.String() == value
}

func validLocalPushCommonResumeKey(value string) bool {
	if len(value) != 68 || !strings.HasPrefix(value, "lp2_") {
		return false
	}
	return canonicalStreamSHA256(value[4:])
}

func validLocalPushCommonUploadInput(input LocalPushCommonUploadInput) bool {
	if !validLocalPushCommonUUID(input.OperationID) ||
		!validLocalPushCommonResumeKey(input.ResumeKey) ||
		!canonicalStreamSHA256(input.SHA256) || input.Size < 0 ||
		(input.ParentID == nil) == (input.NodeID == nil) {
		return false
	}
	if input.ParentID != nil {
		return *input.ParentID > 0 && input.Name != "" && len(input.Name) <= 255 &&
			strings.TrimSpace(input.Name) == input.Name &&
			!strings.ContainsAny(input.Name, "/\\\x00\r\n") &&
			input.ExpectedRevision == 0
	}
	return *input.NodeID > 0 && input.Name == "" && input.ExpectedRevision != 0
}

func (c *Client) postLocalPushCommonOperation(ctx context.Context, sourceID, revision uint64,
	proof LocalBoundSourceProof, action string, payload any,
) ([]byte, error) {
	if c == nil || !validLocalPushStageProof(ctx, sourceID, revision, proof) ||
		(action != "admit" && action != "bind" && action != "receipt") {
		return nil, errors.New("invalid private common Push operation scope")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, errors.New("invalid private common Push operation request")
	}
	req, err := c.request(ctx, http.MethodPost,
		fmt.Sprintf("/api/v1/sources/%d/local-common-upload/%s", sourceID, action),
		bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", strconv.Quote(strconv.FormatUint(revision, 10)))
	localRulesProofHeaders(req, proof)
	resp, err := c.do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, errors.New("private common Push operation unavailable")
	}
	cache := strings.ToLower(resp.Header.Get("Cache-Control"))
	if resp.Header.Get("ETag") != strconv.Quote(strconv.FormatUint(revision, 10)) ||
		!strings.Contains(cache, "private") || !strings.Contains(cache, "no-store") {
		return nil, errors.New("unfenced private common Push operation")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, localPushCommonUploadReplyLimit+1))
	if err != nil || len(raw) > localPushCommonUploadReplyLimit {
		return nil, errors.New("oversized private common Push operation reply")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return raw, nil
}

func decodeLocalPushCommonReply(raw []byte, into any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(into); err != nil {
		return errors.New("invalid private common Push operation response")
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("trailing private common Push operation response")
	}
	return nil
}

type localPushCommonOperationResponse struct {
	SourceID       uint64 `json:"source_id"`
	Revision       uint64 `json:"revision"`
	OperationID    string `json:"operation_id"`
	State          string `json:"state"`
	BackupComplete *bool  `json:"backup_complete"`
	RetirementSafe *bool  `json:"retirement_safe"`
}

func validateLocalPushCommonOperationResponse(raw []byte, sourceID, revision uint64,
	operationID, action string,
) (LocalPushCommonUploadStatus, error) {
	var got localPushCommonOperationResponse
	if err := decodeLocalPushCommonReply(raw, &got); err != nil {
		return LocalPushCommonUploadStatus{}, err
	}
	if got.SourceID != sourceID || got.Revision != revision ||
		got.OperationID != operationID ||
		got.BackupComplete == nil || *got.BackupComplete ||
		got.RetirementSafe == nil || *got.RetirementSafe {
		return LocalPushCommonUploadStatus{}, errors.New("unsafe private common Push operation response")
	}
	switch action {
	case "admit":
		if got.State != "reserved" && got.State != "bound" && got.State != "committed" {
			return LocalPushCommonUploadStatus{}, errors.New("invalid common Push admission state")
		}
	case "bind":
		if got.State != "bound" {
			return LocalPushCommonUploadStatus{}, errors.New("unbound common Push upload session")
		}
	default:
		return LocalPushCommonUploadStatus{}, errors.New("invalid common Push operation action")
	}
	return LocalPushCommonUploadStatus{
		SourceID: sourceID, Revision: revision, OperationID: operationID, State: got.State,
	}, nil
}

func (c *Client) AdmitLocalPushCommonUpload(ctx context.Context, sourceID, revision uint64,
	proof LocalBoundSourceProof, input LocalPushCommonUploadInput,
) (LocalPushCommonUploadStatus, error) {
	if !validLocalPushCommonUploadInput(input) {
		return LocalPushCommonUploadStatus{}, errors.New("invalid common Push file plan")
	}
	raw, err := c.postLocalPushCommonOperation(ctx, sourceID, revision, proof, "admit", input)
	if err != nil {
		return LocalPushCommonUploadStatus{}, err
	}
	return validateLocalPushCommonOperationResponse(raw, sourceID, revision, input.OperationID, "admit")
}

func (c *Client) BindLocalPushCommonUpload(ctx context.Context, sourceID, revision uint64,
	proof LocalBoundSourceProof, operationID, resumeKey, uploadSessionID string,
) (LocalPushCommonUploadStatus, error) {
	if !validLocalPushCommonUUID(operationID) ||
		!validLocalPushCommonResumeKey(resumeKey) ||
		!validLocalPushCommonUUID(uploadSessionID) {
		return LocalPushCommonUploadStatus{}, errors.New("invalid common Push session binding")
	}
	raw, err := c.postLocalPushCommonOperation(ctx, sourceID, revision, proof, "bind",
		struct {
			OperationID     string `json:"operation_id"`
			ResumeKey       string `json:"resume_key"`
			UploadSessionID string `json:"upload_session_id"`
		}{operationID, resumeKey, uploadSessionID})
	if err != nil {
		return LocalPushCommonUploadStatus{}, err
	}
	return validateLocalPushCommonOperationResponse(raw, sourceID, revision, operationID, "bind")
}

// ReadLocalPushCommonUploadReceipt retrieves the immutable original SQL
// operation result. "committed" does NOT attest present-day CAS bytes,
// complete SourceRun, cancel quiescence or legacy Stage/Key/Writer retirement.
func (c *Client) ReadLocalPushCommonUploadReceipt(ctx context.Context, sourceID, revision uint64,
	proof LocalBoundSourceProof, operationID, resumeKey string,
) (LocalPushCommonUploadReceipt, error) {
	var empty LocalPushCommonUploadReceipt
	if !validLocalPushCommonUUID(operationID) || !validLocalPushCommonResumeKey(resumeKey) {
		return empty, errors.New("invalid original common Push receipt selector")
	}
	raw, err := c.postLocalPushCommonOperation(ctx, sourceID, revision, proof, "receipt",
		struct {
			OperationID string `json:"operation_id"`
			ResumeKey   string `json:"resume_key"`
		}{operationID, resumeKey})
	if err != nil {
		return empty, err
	}
	var got struct {
		SourceID           uint64 `json:"source_id"`
		Revision           uint64 `json:"revision"`
		OperationID        string `json:"operation_id"`
		State              string `json:"state"`
		Committed          *bool  `json:"committed"`
		NodeID             uint64 `json:"node_id"`
		NodeRevision       uint64 `json:"node_revision"`
		ContentSHA256      string `json:"content_sha256"`
		Size               int64  `json:"size"`
		BackupComplete     *bool  `json:"backup_complete"`
		RetirementSafe     *bool  `json:"retirement_safe"`
		CurrentCASVerified *bool  `json:"current_cas_verified"`
	}
	if err := decodeLocalPushCommonReply(raw, &got); err != nil {
		return empty, err
	}
	if got.SourceID != sourceID || got.Revision != revision ||
		got.OperationID != operationID || got.Committed == nil ||
		got.BackupComplete == nil || *got.BackupComplete ||
		got.RetirementSafe == nil || *got.RetirementSafe ||
		got.CurrentCASVerified == nil || *got.CurrentCASVerified {
		return empty, errors.New("unsafe original common Push receipt")
	}
	switch got.State {
	case "reserved", "bound":
		if *got.Committed || got.NodeID != 0 || got.NodeRevision != 0 ||
			got.ContentSHA256 != "" {
			return empty, errors.New("uncommitted common Push operation invented a result")
		}
	case "committed":
		if !*got.Committed || got.NodeID == 0 || got.NodeRevision == 0 ||
			!canonicalStreamSHA256(got.ContentSHA256) || got.Size < 0 {
			return empty, errors.New("invalid committed original common Push receipt")
		}
	default:
		return empty, errors.New("unknown original common Push operation state")
	}
	return LocalPushCommonUploadReceipt{
		SourceID: sourceID, Revision: revision, OperationID: operationID,
		State: got.State, Committed: *got.Committed,
		NodeID: got.NodeID, NodeRevision: got.NodeRevision,
		ContentSHA256: got.ContentSHA256, Size: got.Size,
	}, nil
}
