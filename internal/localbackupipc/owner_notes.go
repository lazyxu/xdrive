package localbackupipc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/client"
)

const ownerNotesReplyMax = 7 << 20

// This is an allowlisted Owner Notes domain port, not an arbitrary Agent
// forwarder. The current signed-in xDrive Owner is checked by the Agent and
// Server on every operation. No bearer or NAS filesystem path is returned.
func validOwnerNoteUUID(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id.String() == value
}

func validOwnerNoteWrite(value client.NotesWrite) bool {
	if strings.TrimSpace(value.Title) == "" ||
		len([]byte(value.Title)) > 255 || !utf8.ValidString(value.Title) ||
		!utf8.ValidString(value.Markdown) ||
		len([]byte(value.Markdown)) > client.NotesMaxMarkdownBytes {
		return false
	}
	for _, r := range value.Title {
		if r < 32 || r == 127 {
			return false
		}
	}
	return !strings.ContainsRune(value.Markdown, 0)
}

func validOwnerNoteRow(value client.NotesRow, source string) bool {
	return validOwnerNoteUUID(value.ID) &&
		(source == "" || value.Source == source) &&
		(value.Source == "mine" || value.Source == "ios_notes") &&
		value.NodeID > 0 && value.Revision > 0 &&
		value.Bytes >= 0 && value.Bytes <= client.NotesMaxMarkdownBytes &&
		len(value.SHA256) == 64 &&
		strings.TrimSpace(value.Title) != "" &&
		len([]byte(value.Title)) <= 255
}

func validOwnerNoteDetail(value client.NotesDetail) bool {
	if !validOwnerNoteRow(value.NotesRow, "") ||
		!utf8.ValidString(value.Markdown) ||
		value.Bytes != int64(len([]byte(value.Markdown))) {
		return false
	}
	sum := sha256.Sum256([]byte(value.Markdown))
	return strings.EqualFold(value.SHA256, hex.EncodeToString(sum[:]))
}

// The DSM Host may check availability without mutating Notes or attempting
// an initialization on a previous Agent that lacks the new protocol.
func (c *Client) OwnerNotesAvailable() bool {
	return c != nil && hasCapability(c.capabilities, "cloud-notes")
}

func (c *Client) requireOwnerNotes() error {
	if c == nil || !hasCapability(c.capabilities, "cloud-notes") {
		return errors.New("owning Agent lacks the authorized Owner Notes capability")
	}
	return nil
}

func (c *Client) OwnerNotesInitialize(ctx context.Context) (client.NotesNamespace, error) {
	var out client.NotesNamespace
	if err := c.requireOwnerNotes(); err != nil {
		return out, err
	}
	err := c.request(ctx, http.MethodPost, "/v1/cloud/notes/namespace", nil, &out)
	if err != nil {
		return out, err
	}
	if out.SystemNodeID == 0 || out.NotesNodeID == 0 ||
		out.IOSBackupNodeID == 0 || out.MyNotesNodeID == 0 {
		return client.NotesNamespace{}, errors.New("invalid owning Notes namespace")
	}
	return out, nil
}

func (c *Client) OwnerNotesList(ctx context.Context, source, query string, offset int) (client.NotesPage, error) {
	var result client.NotesPage
	if err := c.requireOwnerNotes(); err != nil {
		return result, err
	}
	if (source != "mine" && source != "ios_notes") ||
		!utf8.ValidString(query) || len([]byte(query)) > 200 ||
		offset < 0 || offset > 10000000 || offset%client.NotesMaxPageSize != 0 {
		return result, errors.New("invalid Owner Notes list selector")
	}
	params := url.Values{"source": {source}, "q": {query}, "offset": {strconv.Itoa(offset)}}
	if err := c.request(ctx, http.MethodGet, "/v1/cloud/notes?"+params.Encode(), nil, &result); err != nil {
		return result, err
	}
	if len(result.Items) > client.NotesMaxPageSize || result.NextOffset < 0 ||
		(result.NextOffset != 0 && result.NextOffset != offset+client.NotesMaxPageSize) {
		return client.NotesPage{}, errors.New("invalid owning Notes page")
	}
	seen := make(map[string]bool, len(result.Items))
	for _, row := range result.Items {
		if !validOwnerNoteRow(row, source) || seen[row.ID] {
			return client.NotesPage{}, errors.New("Owner Notes list contains invalid or duplicate identity")
		}
		seen[row.ID] = true
	}
	return result, nil
}

func (c *Client) OwnerNotesRead(ctx context.Context, id string) (client.NotesDetail, error) {
	var out client.NotesDetail
	if err := c.requireOwnerNotes(); err != nil {
		return out, err
	}
	if !validOwnerNoteUUID(id) {
		return out, errors.New("invalid Owner Note ID")
	}
	if err := c.requestWithLimit(ctx, http.MethodGet, "/v1/cloud/notes/"+id, nil, &out,
		ownerNotesReplyMax); err != nil {
		return out, err
	}
	if out.ID != id || !validOwnerNoteDetail(out) {
		return client.NotesDetail{}, errors.New("unverified Owner Notes Markdown")
	}
	return out, nil
}

func (c *Client) OwnerNotesCreate(ctx context.Context, write client.NotesWrite) (client.NotesRow, error) {
	var out client.NotesRow
	if err := c.requireOwnerNotes(); err != nil {
		return out, err
	}
	if !validOwnerNoteWrite(write) || write.ExpectedRevision != 0 {
		return out, errors.New("invalid Owner Notes creation body")
	}
	if err := c.request(ctx, http.MethodPost, "/v1/cloud/notes", write, &out); err != nil {
		return out, err
	}
	if !validOwnerNoteRow(out, "mine") || out.Revision != 1 ||
		out.Title != strings.TrimSpace(write.Title) || out.Bytes != int64(len([]byte(write.Markdown))) {
		return client.NotesRow{}, errors.New("unverified Owner Notes creation receipt")
	}
	sum := sha256.Sum256([]byte(write.Markdown))
	if !strings.EqualFold(out.SHA256, hex.EncodeToString(sum[:])) {
		return client.NotesRow{}, errors.New("Owner Notes creation SHA mismatch")
	}
	return out, nil
}

func (c *Client) OwnerNotesUpdate(ctx context.Context, id string, write client.NotesWrite) (client.NotesRow, error) {
	var out client.NotesRow
	if err := c.requireOwnerNotes(); err != nil {
		return out, err
	}
	if !validOwnerNoteUUID(id) || !validOwnerNoteWrite(write) || write.ExpectedRevision == 0 {
		return out, errors.New("invalid Owner Notes update selector or revision")
	}
	if err := c.request(ctx, http.MethodPut, "/v1/cloud/notes/"+id, write, &out); err != nil {
		return out, err
	}
	sum := sha256.Sum256([]byte(write.Markdown))
	if !validOwnerNoteRow(out, "mine") || out.ID != id ||
		out.Revision <= write.ExpectedRevision ||
		out.Bytes != int64(len([]byte(write.Markdown))) ||
		out.Title != strings.TrimSpace(write.Title) || !strings.EqualFold(out.SHA256, hex.EncodeToString(sum[:])) {
		return client.NotesRow{}, errors.New("unverified Owner Notes update receipt")
	}
	return out, nil
}

func (c *Client) OwnerNotesDelete(ctx context.Context, id string, revision uint64) error {
	if err := c.requireOwnerNotes(); err != nil {
		return err
	}
	if !validOwnerNoteUUID(id) || revision == 0 {
		return errors.New("invalid Owner Notes delete selector")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.baseURL+
		"/v1/cloud/notes/"+id+"?revision="+strconv.FormatUint(revision, 10), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return &AgentHTTPStatusError{Method: http.MethodDelete, StatusCode: resp.StatusCode}
	}
	return nil
}

func (c *Client) OwnerNotesVersions(ctx context.Context, id string) (client.NotesVersions, error) {
	var out client.NotesVersions
	if err := c.requireOwnerNotes(); err != nil {
		return out, err
	}
	if !validOwnerNoteUUID(id) {
		return out, errors.New("invalid Owner Notes version list selector")
	}
	if err := c.request(ctx, http.MethodGet, "/v1/cloud/notes/"+id+"/versions", nil, &out); err != nil {
		return out, err
	}
	if out.NodeID == 0 || len(out.Items) > 100 {
		return client.NotesVersions{}, errors.New("invalid Owner Notes versions")
	}
	for _, v := range out.Items {
		if v.ID == 0 || v.Revision == 0 || v.Bytes < 0 ||
			v.Bytes > client.NotesMaxMarkdownBytes || len(v.SHA256) != 64 {
			return client.NotesVersions{}, errors.New("unverified Owner Notes version metadata")
		}
	}
	return out, nil
}

func (c *Client) OwnerNotesReadVersion(ctx context.Context, nodeID, versionID uint64) (string, error) {
	if err := c.requireOwnerNotes(); err != nil {
		return "", err
	}
	if !ValidOwnerFileID(nodeID) || versionID == 0 {
		return "", errors.New("invalid Owner Notes history selector")
	}
	path := fmt.Sprintf("/v1/cloud/notes/version-content?node_id=%d&version_id=%d", nodeID, versionID)
	var out struct {
		Markdown string `json:"markdown"`
	}
	if err := c.requestWithLimit(ctx, http.MethodGet, path, nil, &out, ownerNotesReplyMax); err != nil {
		return "", err
	}
	if !utf8.ValidString(out.Markdown) || len([]byte(out.Markdown)) > client.NotesMaxMarkdownBytes {
		return "", errors.New("Owner Notes version Markdown exceeds bounds")
	}
	return out.Markdown, nil
}
