package api

// Explicit, bounded maintenance for offline update transport sessions. No
// candidate is trusted or executed by this endpoint.
import (
	"errors"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const offlineImportCleanupRetention = 30 * 24 * time.Hour

type offlineImportCleanupCandidate struct {
	id           string
	lastActivity time.Time
	bytes        int64
}

// Only canonical, flat, regular managed entries are eligible. Directory mtime
// alone is insufficient: chunk writes update the .part file but not its parent.
func offlineImportCleanupInspect(root *os.Root, id string, cutoff time.Time) (offlineImportCleanupCandidate, bool, error) {
	var result offlineImportCleanupCandidate
	if !offlineImportIDPattern.MatchString(id) {
		return result, false, nil
	}
	dirInfo, err := root.Lstat(id)
	if err != nil {
		return result, false, err
	}
	if !dirInfo.IsDir() || dirInfo.Mode()&os.ModeSymlink != 0 {
		return result, false, nil
	}
	session, err := openOfflineImport(root, id)
	if err != nil {
		return result, false, err
	}
	defer session.Close()
	entries, err := offlineImportReadDir(session)
	if err != nil {
		return result, false, err
	}
	if len(entries) > offlineImportMaxFiles*3 {
		return result, false, nil
	}
	latest := dirInfo.ModTime()
	var total int64
	for _, entry := range entries {
		name := entry.Name()
		base := name
		if strings.HasSuffix(name, ".upload.json") {
			base = strings.TrimSuffix(name, ".upload.json")
		} else if strings.HasSuffix(name, ".part") {
			base = strings.TrimSuffix(name, ".part")
		}
		if !offlineImportAllowedFile(base) || entry.IsDir() {
			return result, false, nil
		}
		info, err := session.Lstat(name)
		if err != nil {
			return result, false, err
		}
		if !info.Mode().IsRegular() || info.Size() < 0 ||
			info.Size() > offlineImportSizeLimit(base) ||
			total > offlineImportTotalMax*2-info.Size() {
			return result, false, nil
		}
		total += info.Size()
		if info.ModTime().After(latest) {
			latest = info.ModTime()
		}
	}
	result = offlineImportCleanupCandidate{id: id, lastActivity: latest.UTC(), bytes: total}
	return result, latest.Before(cutoff), nil
}

func offlineImportCleanupRemove(root *os.Root, id string) error {
	session, err := openOfflineImport(root, id)
	if err != nil {
		return err
	}
	defer session.Close()
	entries, err := offlineImportReadDir(session)
	if err != nil {
		return err
	}
	// Refuse to traverse nested directories or delete any unrecognised entry.
	for _, entry := range entries {
		name := entry.Name()
		base := name
		if strings.HasSuffix(name, ".upload.json") {
			base = strings.TrimSuffix(name, ".upload.json")
		} else if strings.HasSuffix(name, ".part") {
			base = strings.TrimSuffix(name, ".part")
		}
		info, err := session.Lstat(name)
		if err != nil {
			return err
		}
		if !offlineImportAllowedFile(base) || !info.Mode().IsRegular() {
			return errors.New("offline import contains unmanaged entries")
		}
	}
	for _, entry := range entries {
		if err := root.Remove(id + "/" + entry.Name()); err != nil {
			return err
		}
	}
	return root.Remove(id)
}

// GET previews sessions inactive for 30 days. POST requires {"confirm":true}
// and rechecks activity before deletion. It never touches CAS, backups, active
// updates, or sessions with unknown entries; no automatic expiry is enabled.
func (s *Server) adminCleanupOfflineUpdateImports(c *gin.Context) {
	apply := c.Request.Method == http.MethodPost
	if apply {
		var input struct{ Confirm bool }
		if err := c.ShouldBindJSON(&input); err != nil || !input.Confirm {
			c.JSON(http.StatusBadRequest, gin.H{"error": "offline_cleanup_confirmation_required"})
			return
		}
	}
	s.offlineUpdateImportMu.Lock()
	defer s.offlineUpdateImportMu.Unlock()
	if apply && offlineImportBusy(s) {
		c.JSON(http.StatusConflict, gin.H{"error": "update_in_progress"})
		return
	}
	root, err := s.offlineUpdateImportRoot()
	if err != nil {
		offlineImportError(c, err)
		return
	}
	defer root.Close()
	entries, err := offlineImportReadDir(root)
	if err != nil {
		offlineImportError(c, err)
		return
	}
	cutoff := time.Now().UTC().Add(-offlineImportCleanupRetention)
	candidates := make([]offlineImportCleanupCandidate, 0)
	for _, entry := range entries {
		id := entry.Name()
		if !offlineImportIDPattern.MatchString(id) {
			continue
		}
		candidate, eligible, err := offlineImportCleanupInspect(root, id, cutoff)
		if err != nil {
			offlineImportError(c, err)
			return
		}
		if eligible {
			candidates = append(candidates, candidate)
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].id < candidates[j].id })
	eligibleItems := make([]gin.H, 0, len(candidates))
	var estimatedBytes int64
	removed := 0
	for _, candidate := range candidates {
		eligibleItems = append(eligibleItems, gin.H{
			"id": candidate.id, "last_activity_at": candidate.lastActivity,
			"estimated_reclaim_bytes": candidate.bytes,
		})
		estimatedBytes += candidate.bytes
		if !apply {
			continue
		}
		if offlineImportBusy(s) {
			c.JSON(http.StatusConflict, gin.H{"error": "update_in_progress"})
			return
		}
		fresh, eligible, err := offlineImportCleanupInspect(root, candidate.id, cutoff)
		if err != nil {
			offlineImportError(c, err)
			return
		}
		if !eligible || fresh.lastActivity != candidate.lastActivity || fresh.bytes != candidate.bytes {
			continue
		}
		if err := offlineImportCleanupRemove(root, candidate.id); err != nil {
			offlineImportError(c, err)
			return
		}
		removed++
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"retention_days":          30,
		"eligible":                eligibleItems,
		"eligible_count":          len(candidates),
		"estimated_reclaim_bytes": estimatedBytes,
		"removed_count":           removed,
		"applied":                 apply,
	})
}
