package localbackupipc

import (
 "context"
 "errors"
 "net/http"
 "strconv"
 "strings"
 "unicode/utf8"
)

// OwnerClipboardFileReference is a *fresh Files-read proof*, not a Clipboard
// authority or a raw Agent/Server NodeLocation with source paths.
type OwnerClipboardFileReference struct {
 Node OwnerFileNode `json:"node"`
 Crumbs []OwnerSearchCrumb `json:"crumbs"`
}

func ValidateOwnerClipboardFileReference(value OwnerClipboardFileReference, requested uint64) bool {
 n := value.Node
 if !ValidOwnerFileID(requested) || n.ID != requested ||
  !ValidOwnerFileID(n.Revision) || n.ParentID == nil ||
  !ValidOwnerFileID(*n.ParentID) || n.Type != "file" ||
  !safeQuotaAmount(n.Size) || !utf8.ValidString(n.Name) ||
  n.Name == "" || len(n.Name) > 512 || strings.ContainsAny(n.Name, "\x00\r\n") ||
  n.CreatedAt.IsZero() || n.UpdatedAt.IsZero() ||
  len(value.Crumbs) < 2 || len(value.Crumbs) > 48 {
  return false
 }
 seen := map[uint64]bool{}
 for i, crumb := range value.Crumbs {
  if !ValidOwnerFileID(crumb.ID) || seen[crumb.ID] ||
   !utf8.ValidString(crumb.Name) || crumb.Name == "" ||
   len(crumb.Name) > 512 || strings.ContainsAny(crumb.Name, "\x00\r\n") {
   return false
  }
  seen[crumb.ID] = true
  if i == 0 && crumb.ID == n.ID { return false }
 }
 return value.Crumbs[len(value.Crumbs)-1].ID == n.ID &&
  value.Crumbs[len(value.Crumbs)-1].Name == n.Name &&
  value.Crumbs[len(value.Crumbs)-2].ID == *n.ParentID
}

// The same locally authenticated Agent can only read the canonical Server
// Owner's current Node+location with its separate file-read capability.
func (c *Client) OwnerClipboardFileReference(ctx context.Context, nodeID uint64) (OwnerClipboardFileReference, error) {
 if err := c.requireClipboard(); err != nil { return OwnerClipboardFileReference{}, err }
 if err := c.requireCloudFilesRead(); err != nil { return OwnerClipboardFileReference{}, err }
 if !hasCapability(c.capabilities, "node-location") || !ValidOwnerFileID(nodeID) {
  return OwnerClipboardFileReference{}, errors.New("Owner file-location capability unavailable")
 }
 var out OwnerClipboardFileReference
 err := c.request(ctx, http.MethodGet,
  "/v1/cloud/clipboard-file?node_id="+strconv.FormatUint(nodeID,10), nil, &out)
 if err != nil { return OwnerClipboardFileReference{}, err }
 if !ValidateOwnerClipboardFileReference(out, nodeID) {
  return OwnerClipboardFileReference{}, errors.New("Owner Clipboard Files reference not verified")
 }
 return out, nil
}
