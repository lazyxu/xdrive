package localbackupipc

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/client"
)

// OwnerFileNode is a bounded Server Owner-authenticated cloud file projection.
// Never relay a mount path, private blob key, credential or entire Agent DTO.
type OwnerFileNode struct {
	ID        uint64    `json:"id"`
	ParentID  *uint64   `json:"parent_id,omitempty"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	Size      int64     `json:"size"`
	Revision  uint64    `json:"revision"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type OwnerFilesPage struct {
	Items      []OwnerFileNode `json:"items"`
	NextCursor string          `json:"next_cursor,omitempty"`
	HasMore    bool            `json:"has_more"`
	Sort       string          `json:"sort"`
	Order      string          `json:"order"`
}

func ValidOwnerFileID(id uint64) bool { return id > 0 && id <= MaxSafeSourceID }

func ValidOwnerFileSort(sort, order string) bool {
	return (sort == "name" || sort == "updated" || sort == "type" || sort == "size") &&
		(order == "asc" || order == "desc")
}

func ValidOwnerFileCursor(cursor string) bool {
	return len(cursor) <= 1024 && utf8.ValidString(cursor) &&
		!strings.ContainsAny(cursor, "\x00\r\n")
}

func ownerFileNode(n client.Node, parentID *uint64) (OwnerFileNode, error) {
	if !ValidOwnerFileID(n.ID) || !ValidOwnerFileID(n.Revision) ||
		!safeQuotaAmount(n.Size) || !utf8.ValidString(n.Name) ||
		len(n.Name) < 1 || len(n.Name) > 512 ||
		(n.Type != "dir" && n.Type != "file") ||
		n.DeletedAt != nil ||
		(parentID != nil && (n.ParentID == nil || *n.ParentID != *parentID)) {
		return OwnerFileNode{}, errors.New("invalid Owner file projection")
	}
	if parentID == nil && (n.Type != "dir" || n.ParentID != nil) {
		return OwnerFileNode{}, errors.New("Owner cloud root must be a directory")
	}
	return OwnerFileNode{
		ID: n.ID, ParentID: parentID, Name: n.Name, Type: n.Type,
		Size: n.Size, Revision: n.Revision, CreatedAt: n.CreatedAt,
		UpdatedAt: n.UpdatedAt,
	}, nil
}

func ValidateOwnerFileRoot(n OwnerFileNode) bool {
	return ValidOwnerFileID(n.ID) && ValidOwnerFileID(n.Revision) &&
		n.ParentID == nil && n.Type == "dir" && safeQuotaAmount(n.Size) &&
		len(n.Name) > 0 && len(n.Name) <= 512 && utf8.ValidString(n.Name)
}

func ValidateOwnerFilesPage(p OwnerFilesPage, parentID uint64, limit int, sort, order, cursor string) bool {
	if !ValidOwnerFileID(parentID) || limit < 1 || limit > 200 ||
		!ValidOwnerFileSort(sort, order) || !ValidOwnerFileCursor(cursor) ||
		p.Items == nil || len(p.Items) > limit || p.Sort != sort || p.Order != order ||
		!ValidOwnerFileCursor(p.NextCursor) ||
		(p.HasMore && (len(p.Items) == 0 || p.NextCursor == "" || p.NextCursor == cursor)) ||
		(!p.HasMore && p.NextCursor != "") {
		return false
	}
	seen := make(map[uint64]bool, len(p.Items))
	for _, item := range p.Items {
		if !ValidOwnerFileID(item.ID) || !ValidOwnerFileID(item.Revision) ||
			item.ParentID == nil || *item.ParentID != parentID ||
			!safeQuotaAmount(item.Size) || !utf8.ValidString(item.Name) ||
			len(item.Name) < 1 || len(item.Name) > 512 ||
			(item.Type != "dir" && item.Type != "file") || seen[item.ID] {
			return false
		}
		seen[item.ID] = true
	}
	return true
}

func (c *Client) requireCloudFilesRead() error {
	if c == nil || !hasCapability(c.capabilities, "cloud-files-read") {
		return errors.New("owning Agent does not support Server Owner readonly file browsing")
	}
	return nil
}

func (c *Client) OwnerFileRoot(ctx context.Context) (OwnerFileNode, error) {
	if err := c.requireCloudFilesRead(); err != nil {
		return OwnerFileNode{}, err
	}
	var node client.Node
	if err := c.request(ctx, http.MethodGet, "/v1/cloud/root", nil, &node); err != nil {
		return OwnerFileNode{}, err
	}
	return ownerFileNode(node, nil)
}

func (c *Client) OwnerFilePage(
	ctx context.Context, parentID uint64, limit int, sort, order, cursor string,
) (OwnerFilesPage, error) {
	if err := c.requireCloudFilesRead(); err != nil {
		return OwnerFilesPage{}, err
	}
	if !ValidOwnerFileID(parentID) || limit < 1 || limit > 200 ||
		!ValidOwnerFileSort(sort, order) || !ValidOwnerFileCursor(cursor) {
		return OwnerFilesPage{}, errors.New("invalid Owner cloud folder selector")
	}
	q := url.Values{
		"parent_id": {strconv.FormatUint(parentID, 10)},
		"limit":     {strconv.Itoa(limit)}, "sort": {sort}, "order": {order},
	}
	if cursor != "" {
		q.Set("cursor", cursor)
	}
	var page client.ChildrenPage
	if err := c.request(ctx, http.MethodGet, "/v1/cloud/children?"+q.Encode(), nil, &page); err != nil {
		return OwnerFilesPage{}, err
	}
	if page.Items == nil || len(page.Items) > limit {
		return OwnerFilesPage{}, errors.New("invalid Owner folder page")
	}
	parent := parentID
	out := OwnerFilesPage{
		Items:      make([]OwnerFileNode, 0, len(page.Items)),
		NextCursor: page.NextCursor, HasMore: page.HasMore,
		Sort: page.Sort, Order: page.Order,
	}
	for _, node := range page.Items {
		converted, err := ownerFileNode(node, &parent)
		if err != nil {
			return OwnerFilesPage{}, err
		}
		out.Items = append(out.Items, converted)
	}
	if !ValidateOwnerFilesPage(out, parentID, limit, sort, order, cursor) {
		return OwnerFilesPage{}, errors.New("invalid Owner cloud children cursor or source")
	}
	return out, nil
}
