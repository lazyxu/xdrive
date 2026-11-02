package localbackupipc

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/lazyxu/xdrive/internal/client"
)

const OwnerSearchPageSize = 200

// Search is always a remote Server Owner operation; no NAS path is exposed.
type OwnerSearchCrumb struct {
	ID   uint64 `json:"id"`
	Name string `json:"name"`
}

type OwnerSearchHit struct {
	Node   OwnerFileNode      `json:"node"`
	Crumbs []OwnerSearchCrumb `json:"crumbs"`
}

type OwnerSearchPage struct {
	Items      []OwnerSearchHit `json:"items"`
	NextCursor string           `json:"next_cursor,omitempty"`
	HasMore    bool             `json:"has_more"`
}

func ValidOwnerSearchQuery(query string) bool {
	if query != strings.TrimSpace(query) || !utf8.ValidString(query) || len(query) > 512 {
		return false
	}
	count := utf8.RuneCountInString(query)
	if count < 2 || count > 128 {
		return false
	}
	for _, r := range query {
		if r < 32 || r == 127 {
			return false
		}
	}
	return true
}

func ValidateOwnerSearchPage(page OwnerSearchPage, cursor string) bool {
	if len(page.Items) > OwnerSearchPageSize ||
		!ValidOwnerFileCursor(cursor) || !ValidOwnerFileCursor(page.NextCursor) ||
		page.HasMore != (page.NextCursor != "") ||
		(page.HasMore && (len(page.Items) == 0 || page.NextCursor == cursor)) {
		return false
	}
	seen := map[uint64]bool{}
	for _, hit := range page.Items {
		node := hit.Node
		if !ValidOwnerFileID(node.ID) || !ValidOwnerFileID(node.Revision) ||
			node.ParentID == nil || !ValidOwnerFileID(*node.ParentID) ||
			node.Type != "file" && node.Type != "dir" ||
			len(node.Name) == 0 || len(node.Name) > 512 ||
			!utf8.ValidString(node.Name) || !safeQuotaAmount(node.Size) ||
			node.CreatedAt.IsZero() || node.UpdatedAt.IsZero() ||
			len(hit.Crumbs) == 0 || len(hit.Crumbs) > 48 || seen[node.ID] {
			return false
		}
		seen[node.ID] = true
		visited := map[uint64]bool{}
		for index, crumb := range hit.Crumbs {
			if !ValidOwnerFileID(crumb.ID) || visited[crumb.ID] ||
				!utf8.ValidString(crumb.Name) || len(crumb.Name) > 512 ||
				(index != 0 && crumb.Name == "") ||
				strings.ContainsAny(crumb.Name, "\x00\r\n") {
				return false
			}
			visited[crumb.ID] = true
		}
		if hit.Crumbs[len(hit.Crumbs)-1].ID != *node.ParentID ||
			visited[node.ID] {
			return false
		}
	}
	return true
}

// OwnerSearchPage asks the original owning Agent for one bounded cursor page.
// Desktop's full search filters, source paths, and tokens are never forwarded.
func (c *Client) OwnerSearchPage(ctx context.Context, query, cursor string) (OwnerSearchPage, error) {
	if c == nil || !hasCapability(c.capabilities, "cloud-owner-search-read") {
		return OwnerSearchPage{}, errors.New("owning Agent has no Owner search capability")
	}
	if !ValidOwnerSearchQuery(query) || !ValidOwnerFileCursor(cursor) {
		return OwnerSearchPage{}, errors.New("invalid Owner search selector")
	}
	args := url.Values{"q": {query}}
	if cursor != "" {
		args.Set("cursor", cursor)
	}
	var page client.SearchPage
	if err := c.request(ctx, http.MethodGet, "/v1/cloud/owner-search?"+args.Encode(), nil, &page); err != nil {
		return OwnerSearchPage{}, err
	}
	if len(page.Items) > OwnerSearchPageSize {
		return OwnerSearchPage{}, errors.New("unbounded Owner search page")
	}
	result := OwnerSearchPage{
		Items: make([]OwnerSearchHit, 0, len(page.Items)),
		NextCursor: page.NextCursor,
		HasMore: page.NextCursor != "",
	}
	for _, item := range page.Items {
		if item.Node.ParentID == nil || !ValidOwnerFileID(*item.Node.ParentID) {
			return OwnerSearchPage{}, errors.New("unbound Owner search result")
		}
		parentID := *item.Node.ParentID
		node, err := ownerFileNode(item.Node, &parentID)
		if err != nil {
			return OwnerSearchPage{}, err
		}
		crumbs := make([]OwnerSearchCrumb, 0, len(item.Breadcrumbs))
		for _, crumb := range item.Breadcrumbs {
			crumbs = append(crumbs, OwnerSearchCrumb{ID: crumb.ID, Name: crumb.Name})
		}
		result.Items = append(result.Items, OwnerSearchHit{Node: node, Crumbs: crumbs})
	}
	if !ValidateOwnerSearchPage(result, cursor) {
		return OwnerSearchPage{}, errors.New("unverified Owner search page")
	}
	return result, nil
}
