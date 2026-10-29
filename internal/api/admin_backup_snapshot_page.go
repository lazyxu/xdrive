package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// Optional read-only Host index, separate from the newest-100 management
// inventory. Identities only: it is never a recovery or deletion grant.
type backupAdminSnapshotIndex struct {
	Protocol         string   `json:"protocol"`
	GeneratedAt      string   `json:"generated_at"`
	PolicyRevision   string   `json:"policy_revision"`
	TotalSnapshots   int      `json:"total_snapshots"`
	IndexedSnapshots int      `json:"indexed_snapshots"`
	Truncated        bool     `json:"truncated"`
	SnapshotIDs      []string `json:"snapshot_ids"`
}

type backupAdminSnapshotPageResponse struct {
	Protocol         string   `json:"protocol"`
	Scope            string   `json:"scope"`
	TotalSnapshots   int      `json:"total_snapshots"`
	IndexedSnapshots int      `json:"indexed_snapshots"`
	Truncated        bool     `json:"truncated"`
	Offset           int      `json:"offset"`
	Limit            int      `json:"limit"`
	NextOffset       *int     `json:"next_offset,omitempty"`
	SnapshotIDs      []string `json:"snapshot_ids"`
}

func validBackupSnapshotIndex(index backupAdminSnapshotIndex, inventory backupAdminInventory) bool {
	maxIndexed := 1000 // Legacy Host Controller v1 index cap.
	switch index.Protocol {
	case "xdrive-backup-snapshot-index-v1":
	case "xdrive-backup-snapshot-index-v2":
		maxIndexed = 10_000
	default:
		return false
	}
	if inventory.TotalSnapshots == nil ||
		index.PolicyRevision != inventory.Policy.Revision ||
		index.TotalSnapshots != *inventory.TotalSnapshots ||
		index.TotalSnapshots < 0 || index.TotalSnapshots > 1_000_000 ||
		index.IndexedSnapshots < 0 || index.IndexedSnapshots > maxIndexed ||
		index.IndexedSnapshots != len(index.SnapshotIDs) ||
		index.Truncated != (index.TotalSnapshots > index.IndexedSnapshots) {
		return false
	}
	expected := index.TotalSnapshots
	if expected > maxIndexed {
		expected = maxIndexed
	}
	if index.IndexedSnapshots != expected {
		return false
	}
	created, err := time.Parse(time.RFC3339, index.GeneratedAt)
	if err != nil || time.Since(created) > 120*time.Second ||
		time.Until(created) > 15*time.Second {
		return false
	}
	inventoryAt, err := time.Parse(time.RFC3339, inventory.GeneratedAt)
	if err != nil || created.Sub(inventoryAt) > 15*time.Second ||
		inventoryAt.Sub(created) > 15*time.Second {
		return false
	}
	last := ""
	seen := make(map[string]struct{}, len(index.SnapshotIDs))
	for i, id := range index.SnapshotIDs {
		if !backupAdminSnapshotID.MatchString(id) {
			return false
		}
		parts := strings.SplitN(id, ":", 2)
		// The Host sorts "snapshot-name<TAB>namespace" in descending order.
		key := parts[1] + "\t" + parts[0]
		if last != "" && last <= key {
			return false
		}
		last = key
		if _, found := seen[id]; found {
			return false
		}
		seen[id] = struct{}{}
		if i < len(inventory.Snapshots) && inventory.Snapshots[i].ID != id {
			return false
		}
	}
	// The newest-100 proof cannot legitimately reference an entry absent
	// from the index; older indexed identities have no state/size proof.
	return len(inventory.Snapshots) <= len(index.SnapshotIDs)
}

// backupAdminOlderSnapshotInCurrentIndex authorizes only a read-only VERIFY
// request for a Host-discovered older identity. The newest-100 inventory
// remains the *only* source for restore, drill and deletion admission.
// Index entries carry no integrity/restore proof: the Host must re-resolve
// the allowlisted namespace and perform real verification under its lock.
func backupAdminOlderSnapshotInCurrentIndex(dir string, inventory backupAdminInventory, id string) bool {
	if !backupAdminSnapshotID.MatchString(id) ||
		inventory.TotalSnapshots == nil || *inventory.TotalSnapshots <= 100 ||
		len(inventory.Snapshots) != 100 {
		return false
	}
	var index backupAdminSnapshotIndex
	if err := readSafeBackupAdminJSON(dir, "backup-admin-snapshot-index.json", 1<<20, &index); err != nil ||
		!validBackupSnapshotIndex(index, inventory) {
		return false
	}
	// The first 100 are covered by the richer, current Host inventory. Only
	// indices 100..999 (legacy) or 100..9999 (v2) can use this opt-in path; a truncated index does not
	// authorize any older identity that it did not actually enumerate.
	for i := 100; i < len(index.SnapshotIDs); i++ {
		if index.SnapshotIDs[i] == id {
			return true
		}
	}
	return false
}

func adminBackupPageNumber(raw string, fallback, max int) (int, bool) {
	if raw == "" {
		return fallback, true
	}
	if len(raw) > 5 {
		return 0, false
	}
	for _, c := range raw {
		if c < '0' || c > '9' {
			return 0, false
		}
	}
	value, err := strconv.Atoi(raw)
	return value, err == nil && value >= 0 && value <= max
}

func (s *Server) adminBackupSnapshotPage(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	query := c.Request.URL.Query()
	for key, values := range query {
		if (key != "offset" && key != "limit") || len(values) != 1 || values[0] == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_backup_snapshot_page"})
			return
		}
	}
	offset, okOffset := adminBackupPageNumber(c.Query("offset"), 0, 10_000)
	limit, okLimit := adminBackupPageNumber(c.Query("limit"), 50, 100)
	if !okOffset || !okLimit || limit < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_backup_snapshot_page"})
		return
	}
	state := s.backupAdminState()
	if !state.Supported {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "backup_host_unavailable"})
		return
	}
	var index backupAdminSnapshotIndex
	if err := readSafeBackupAdminJSON(s.HostControlDir, "backup-admin-snapshot-index.json", 1<<20, &index); err != nil ||
		!validBackupSnapshotIndex(index, state.Inventory) {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "backup_snapshot_index_unavailable"})
		return
	}
	if index.Truncated && offset >= index.IndexedSnapshots {
		c.JSON(http.StatusConflict, gin.H{"error": "backup_snapshot_index_truncated"})
		return
	}
	begin := offset
	if begin > len(index.SnapshotIDs) {
		begin = len(index.SnapshotIDs)
	}
	end := begin + limit
	if end > len(index.SnapshotIDs) {
		end = len(index.SnapshotIDs)
	}
	ids := append([]string{}, index.SnapshotIDs[begin:end]...)
	var nextOffset *int
	if end < len(index.SnapshotIDs) {
		next := end
		nextOffset = &next
	}
	c.JSON(http.StatusOK, backupAdminSnapshotPageResponse{
		Protocol:         "xdrive-backup-snapshot-page-v1",
		Scope:            "unverified_identity_only",
		TotalSnapshots:   index.TotalSnapshots,
		IndexedSnapshots: index.IndexedSnapshots,
		Truncated:        index.Truncated,
		Offset:           offset,
		Limit:            limit,
		NextOffset:       nextOffset,
		SnapshotIDs:      ids,
	})
}
