package client

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

const NotesMaxMarkdownBytes = 1 << 20
const NotesMaxPageSize = 50

type NotesNamespace struct {
	SystemNodeID uint64 `json:"system_node_id"`
	NotesNodeID uint64 `json:"notes_node_id"`
	IOSBackupNodeID uint64 `json:"ios_backup_node_id"`
	MyNotesNodeID uint64 `json:"my_notes_node_id"`
}

type NotesRow struct {
	ID string `json:"id"`
	Source string `json:"source"`
	Title string `json:"title"`
	NodeID uint64 `json:"node_id"`
	Revision uint64 `json:"revision"`
	SHA256 string `json:"sha256"`
	Bytes int64 `json:"bytes"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type NotesDetail struct {
	NotesRow
	Markdown string `json:"markdown"`
}

type NotesPage struct {
	Items []NotesRow `json:"items"`
	NextOffset int `json:"next_offset"`
}

type NotesVersion struct {
	ID uint64 `json:"id"`
	Revision uint64 `json:"revision"`
	SHA256 string `json:"sha256"`
	Bytes int64 `json:"bytes"`
}

type NotesVersions struct {
	Items []NotesVersion `json:"items"`
	NodeID uint64 `json:"node_id"`
}

type NotesWrite struct {
	Title string `json:"title"`
	Markdown string `json:"markdown"`
	ExpectedRevision uint64 `json:"expected_revision,omitempty"`
}

func validNoteID(id string) bool {
	parsed, err := uuid.Parse(id)
	return err == nil && parsed.String() == strings.ToLower(id)
}

func validateNotesWrite(write NotesWrite) error {
	title := strings.TrimSpace(write.Title)
	if title == "" || !utf8.ValidString(title) || len([]byte(title)) > 255 ||
		!utf8.ValidString(write.Markdown) || len([]byte(write.Markdown)) > NotesMaxMarkdownBytes {
		return errors.New("notes title or Markdown exceeds supported limits")
	}
	for _, r := range title {
		if r < 32 || r == 127 {
			return errors.New("notes title contains a control character")
		}
	}
	for _, r := range write.Markdown {
		if r == 0 {
			return errors.New("notes Markdown contains an invalid NUL character")
		}
	}
	return nil
}

func notesContentReceipt(row NotesRow, markdown string) error {
	if !validNoteID(row.ID) || row.NodeID == 0 || row.Revision == 0 ||
		(row.Source != "mine" && row.Source != "ios_notes") {
		return errors.New("invalid notes file receipt")
	}
	if !utf8.ValidString(markdown) ||
		len([]byte(markdown)) > NotesMaxMarkdownBytes ||
		row.Bytes != int64(len([]byte(markdown))) {
		return errors.New("notes Markdown byte length mismatch")
	}
	sum := sha256.Sum256([]byte(markdown))
	if !strings.EqualFold(row.SHA256, hex.EncodeToString(sum[:])) {
		return errors.New("notes Markdown SHA-256 mismatch")
	}
	return nil
}

func (c *Client) NotesInitialize(ctx context.Context) (NotesNamespace, error) {
	var out NotesNamespace
	err := c.json(ctx, http.MethodPost, "/api/v1/notes/namespace", map[string]any{}, &out)
	if err != nil {
		return out, err
	}
	if out.SystemNodeID == 0 || out.NotesNodeID == 0 ||
		out.IOSBackupNodeID == 0 || out.MyNotesNodeID == 0 {
		return NotesNamespace{}, errors.New("incomplete Owner notes namespace")
	}
	return out, nil
}

func (c *Client) NotesList(ctx context.Context, source, query string, offset int) (NotesPage, error) {
	if source != "mine" && source != "ios_notes" {
		return NotesPage{}, errors.New("invalid notes source")
	}
	if !utf8.ValidString(query) || len([]byte(query)) > 200 ||
		offset < 0 || offset > 10000000 || offset%NotesMaxPageSize != 0 {
		return NotesPage{}, errors.New("invalid notes query or page")
	}
	v := url.Values{}
	v.Set("source", source)
	v.Set("q", query)
	v.Set("offset", strconv.Itoa(offset))
	var page NotesPage
	err := c.json(ctx, http.MethodGet, "/api/v1/notes?"+v.Encode(), nil, &page)
	if err != nil {
		return page, err
	}
	if len(page.Items) > NotesMaxPageSize || page.NextOffset < 0 ||
		(page.NextOffset != 0 && page.NextOffset != offset+NotesMaxPageSize) {
		return NotesPage{}, errors.New("invalid notes paging response")
	}
	for _, row := range page.Items {
		if !validNoteID(row.ID) || row.Source != source || row.NodeID == 0 ||
			row.Revision == 0 || row.Bytes < 0 || row.Bytes > NotesMaxMarkdownBytes {
			return NotesPage{}, errors.New("invalid Owner notes list response")
		}
	}
	return page, nil
}

func (c *Client) NotesRead(ctx context.Context, id string) (NotesDetail, error) {
	if !validNoteID(id) {
		return NotesDetail{}, errors.New("invalid notes identity")
	}
	var out NotesDetail
	err := c.json(ctx, http.MethodGet, "/api/v1/notes/"+id, nil, &out)
	if err != nil {
		return out, err
	}
	if out.ID != id {
		return NotesDetail{}, errors.New("notes identity mismatch")
	}
	if err := notesContentReceipt(out.NotesRow, out.Markdown); err != nil {
		return NotesDetail{}, err
	}
	return out, nil
}

func (c *Client) NotesCreate(ctx context.Context, write NotesWrite) (NotesRow, error) {
	if err := validateNotesWrite(write); err != nil {
		return NotesRow{}, err
	}
	write.ExpectedRevision = 0
	var out NotesRow
	err := c.json(ctx, http.MethodPost, "/api/v1/notes", write, &out)
	if err != nil {
		return out, err
	}
	if out.Source != "mine" || out.Title != strings.TrimSpace(write.Title) ||
		notesContentReceipt(out, write.Markdown) != nil {
		return NotesRow{}, errors.New("Notes creation receipt mismatch")
	}
	return out, nil
}

func (c *Client) NotesUpdate(ctx context.Context, id string, write NotesWrite) (NotesRow, error) {
	if !validNoteID(id) || write.ExpectedRevision == 0 {
		return NotesRow{}, errors.New("invalid Notes update identity/revision")
	}
	if err := validateNotesWrite(write); err != nil {
		return NotesRow{}, err
	}
	var out NotesRow
	err := c.json(ctx, http.MethodPut, "/api/v1/notes/"+id, write, &out)
	if err != nil {
		return out, err
	}
	if out.ID != id || out.Source != "mine" ||
		out.Revision < write.ExpectedRevision ||
		out.Title != strings.TrimSpace(write.Title) ||
		notesContentReceipt(out, write.Markdown) != nil {
		return NotesRow{}, errors.New("Notes update receipt mismatch")
	}
	return out, nil
}

func (c *Client) NotesDelete(ctx context.Context, id string, revision uint64) error {
	if !validNoteID(id) || revision == 0 {
		return errors.New("invalid Notes deletion identity/revision")
	}
	req, err := c.request(ctx, http.MethodDelete, "/api/v1/notes/"+id, nil)
	if err != nil {
		return err
	}
	req.Header.Set("If-Match", strconv.FormatUint(revision, 10))
	resp, err := c.do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		return responseError(resp)
	}
	return nil
}

func (c *Client) NotesVersions(ctx context.Context, id string) (NotesVersions, error) {
	if !validNoteID(id) {
		return NotesVersions{}, errors.New("invalid notes identity")
	}
	var out NotesVersions
	err := c.json(ctx, http.MethodGet, "/api/v1/notes/"+id+"/versions", nil, &out)
	if err != nil {
		return out, err
	}
	if out.NodeID == 0 || len(out.Items) > 100 {
		return NotesVersions{}, errors.New("invalid Notes history")
	}
	for _, v := range out.Items {
		if v.ID == 0 || v.Revision == 0 || v.Bytes < 0 ||
			v.Bytes > NotesMaxMarkdownBytes {
			return NotesVersions{}, errors.New("invalid Notes version metadata")
		}
	}
	return out, nil
}

// NotesReadVersion does not construct an unverified public/signed download URL.
// It uses the same authenticated Client that verifies the current Owner.
func (c *Client) NotesReadVersion(ctx context.Context, nodeID, versionID uint64) (string, error) {
	if nodeID == 0 || versionID == 0 {
		return "", errors.New("invalid Notes version identity")
	}
	path := fmt.Sprintf("/api/v1/files/%d/versions/%d/content", nodeID, versionID)
	req, err := c.request(ctx, http.MethodGet, path, nil)
	if err != nil {
		return "", err
	}
	resp, err := c.do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", responseError(resp)
	}
	if resp.ContentLength > NotesMaxMarkdownBytes {
		return "", errors.New("Notes historical Markdown exceeds 1 MiB")
	}
	content, err := io.ReadAll(io.LimitReader(resp.Body, NotesMaxMarkdownBytes+1))
	if err != nil {
		return "", err
	}
	if len(content) > NotesMaxMarkdownBytes || !utf8.Valid(content) {
		return "", errors.New("Notes historical Markdown is invalid UTF-8 or too large")
	}
	return string(content), nil
}
