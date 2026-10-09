package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

const (
	mediaSelectionMaxItems = 100000
	mediaSelectionPageMax  = 200
	mediaSelectionTTL      = 15 * time.Minute
	mediaSelectionMaxTotal = 24
)

type mediaSelectionNode struct {
	ID       uint64
	Revision uint64
}

type mediaSelectionSnapshot struct {
	ownerID   uint64
	nodes     []mediaSelectionNode
	memberIDs map[uint64]struct{}
	excluded  map[uint64]struct{}
	version   uint64
	createdAt time.Time
	expiresAt time.Time
	day       string
}

var (
	errMediaSelectionConflict = errors.New("selection version changed")
	errMediaSelectionOutside  = errors.New("node is outside the frozen selection")
)

func (session *mediaSelectionSnapshot) selectedCount() int {
	return len(session.nodes) - len(session.excluded)
}

func (session *mediaSelectionSnapshot) page(offset, limit int) []mediaSelectionNode {
	page := make([]mediaSelectionNode, 0, limit)
	cursor := 0
	for _, node := range session.nodes {
		if _, excluded := session.excluded[node.ID]; excluded {
			continue
		}
		if cursor >= offset && len(page) < limit {
			page = append(page, node)
		}
		cursor++
		if len(page) >= limit {
			break
		}
	}
	return page
}

func (session *mediaSelectionSnapshot) setExcluded(nodeID uint64, excluded bool, version uint64) error {
	if session.version != version {
		return errMediaSelectionConflict
	}
	if _, ok := session.memberIDs[nodeID]; !ok {
		return errMediaSelectionOutside
	}
	_, present := session.excluded[nodeID]
	if excluded && !present {
		session.excluded[nodeID] = struct{}{}
		session.version++
	} else if !excluded && present {
		delete(session.excluded, nodeID)
		session.version++
	}
	return nil
}

func mediaSelectionDayBounds(options mediaQueryOptions, day string) (time.Time, time.Time, error) {
	date, err := time.Parse("2006-01-02", day)
	if err != nil || date.Format("2006-01-02") != day {
		return time.Time{}, time.Time{}, errors.New("day must be YYYY-MM-DD")
	}
	location, _, err := mediaIANAZone(options.TimeZone)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	y, m, d := date.Date()
	start := time.Date(y, m, d, 0, 0, 0, 0, location)
	return start.UTC(), start.AddDate(0, 0, 1).UTC(), nil
}

func (s *Server) createMediaSelectionSnapshot(c *gin.Context) {
	options, ok := mediaQueryFromRequest(c)
	if !ok {
		return
	}
	albumID := strings.TrimSpace(c.Query("album_id"))
	day := strings.TrimSpace(c.Query("day"))
	if options.FoldDuplicates || len(options.FoldMemberIDs) > 0 {
		fail(c, http.StatusBadRequest, "query-wide selection requires unfolded media; turn off duplicate folding")
		return
	}
	if albumID != "" && !validMediaAlbumKey(albumID) {
		fail(c, http.StatusBadRequest, "album_id is invalid")
		return
	}
	query, err := s.mediaItemsBaseQuery(c.Request.Context(), userID(c), options, albumID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			fail(c, http.StatusNotFound, "media album not found")
		} else {
			fail(c, http.StatusInternalServerError, "resolve selection query failed")
		}
		return
	}
	if day != "" {
		start, end, err := mediaSelectionDayBounds(options, day)
		if err != nil {
			fail(c, http.StatusBadRequest, err.Error())
			return
		}
		column := "xd_media_metadata.captured_at"
		if options.SortBy == "added" {
			column = "n.created_at"
		}
		query = query.Where(column+" >= ? AND "+column+" < ?", start, end)
	}
	// One owner-authorized PostgreSQL SELECT freezes the exact displayed Node
	// identities and revisions. It does not hydrate 100k MediaItem objects or
	// read thumbnails/originals. LIMIT+1 prevents dishonest partial selection.
	var nodes []mediaSelectionNode
	if err := query.Select("n.id AS id, n.revision AS revision").
		Order("n.id ASC").Limit(mediaSelectionMaxItems + 1).Scan(&nodes).Error; err != nil {
		fail(c, http.StatusInternalServerError, "create selection snapshot failed")
		return
	}
	if len(nodes) > mediaSelectionMaxItems {
		fail(c, http.StatusRequestEntityTooLarge, "selection exceeds 100000 items; narrow the query")
		return
	}
	if c.Request.Context().Err() != nil {
		return
	}
	members := make(map[uint64]struct{}, len(nodes))
	unique := make([]mediaSelectionNode, 0, len(nodes))
	for _, entry := range nodes {
		if _, exists := members[entry.ID]; exists {
			continue
		}
		members[entry.ID] = struct{}{}
		unique = append(unique, entry)
	}
	nodes = unique
	now := time.Now().UTC()
	session := &mediaSelectionSnapshot{
		ownerID: userID(c), nodes: nodes, memberIDs: members,
		excluded: make(map[uint64]struct{}), version: 1,
		createdAt: now, expiresAt: now.Add(mediaSelectionTTL), day: day,
	}
	token := uuid.NewString()
	s.mediaSelectionMu.Lock()
	if s.mediaSelections == nil {
		s.mediaSelections = make(map[string]*mediaSelectionSnapshot)
	}
	for key, old := range s.mediaSelections {
		if now.After(old.expiresAt) || old.ownerID == session.ownerID {
			delete(s.mediaSelections, key)
		}
	}
	if len(s.mediaSelections) >= mediaSelectionMaxTotal {
		var oldestKey string
		var oldest time.Time
		for key, old := range s.mediaSelections {
			if oldestKey == "" || old.createdAt.Before(oldest) {
				oldestKey, oldest = key, old.createdAt
			}
		}
		delete(s.mediaSelections, oldestKey)
	}
	s.mediaSelections[token] = session
	s.mediaSelectionMu.Unlock()
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusCreated, gin.H{
		"token": token, "version": session.version,
		"total": len(nodes), "selected": len(nodes), "excluded": 0,
		"day": day, "scope": "known_photo_assets",
		"created_at": now, "expires_at": session.expiresAt,
	})
}

func (s *Server) mediaSelectionByTokenLocked(c *gin.Context, token string) (*mediaSelectionSnapshot, bool) {
	if _, err := uuid.Parse(token); err != nil {
		return nil, false
	}
	session := s.mediaSelections[token]
	if session == nil || session.ownerID != userID(c) {
		return nil, false
	}
	if !time.Now().Before(session.expiresAt) {
		delete(s.mediaSelections, token)
		return nil, false
	}
	return session, true
}

func (s *Server) getMediaSelectionSnapshot(c *gin.Context) {
	token := c.Param("token")
	offset, limit := 0, 100
	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			fail(c, http.StatusBadRequest, "offset must be nonnegative")
			return
		}
		offset = value
	}
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > mediaSelectionPageMax {
			fail(c, http.StatusBadRequest, "limit must be 1..200")
			return
		}
		limit = value
	}
	s.mediaSelectionMu.Lock()
	session, ok := s.mediaSelectionByTokenLocked(c, token)
	if !ok {
		s.mediaSelectionMu.Unlock()
		fail(c, http.StatusNotFound, "selection expired or not found")
		return
	}
	total, selected, version, expiry, day := len(session.nodes), session.selectedCount(), session.version, session.expiresAt, session.day
	window := session.page(offset, limit)
	s.mediaSelectionMu.Unlock()
	ids := make([]uint64, len(window))
	for i, entry := range window {
		ids[i] = entry.ID
	}
	type activeNode struct {
		ID       uint64
		Name     string
		Revision uint64
	}
	active := make(map[uint64]activeNode, len(ids))
	if len(ids) > 0 {
		var rows []activeNode
		if err := s.DB.WithContext(c.Request.Context()).Model(&meta.Node{}).
			Select("id, name, revision").
			Where("id IN ? AND owner_id = ? AND deleted_at IS NULL", ids, userID(c)).
			Find(&rows).Error; err != nil {
			fail(c, http.StatusInternalServerError, "load selected page failed")
			return
		}
		for _, node := range rows {
			active[node.ID] = node
		}
	}
	items := make([]gin.H, 0, len(window))
	for _, selectedNode := range window {
		live, exists := active[selectedNode.ID]
		stale := !exists || live.Revision != selectedNode.Revision
		name := ""
		if exists {
			name = live.Name
		}
		items = append(items, gin.H{
			"node_id": selectedNode.ID, "revision": selectedNode.Revision,
			"name": name, "stale": stale,
		})
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"token": token, "version": version, "total": total,
		"selected": selected, "excluded": total - selected, "day": day,
		"expires_at": expiry, "offset": offset, "limit": limit,
		"items": items, "has_more": offset+len(window) < selected,
	})
}

func (s *Server) updateMediaSelectionExclusion(c *gin.Context) {
	var input struct {
		NodeID   uint64 `json:"node_id"`
		Excluded *bool  `json:"excluded"`
		Version  uint64 `json:"version"`
	}
	if err := c.ShouldBindJSON(&input); err != nil || input.NodeID == 0 || input.Excluded == nil || input.Version == 0 {
		fail(c, http.StatusBadRequest, "node_id, excluded and version are required")
		return
	}
	s.mediaSelectionMu.Lock()
	session, ok := s.mediaSelectionByTokenLocked(c, c.Param("token"))
	if !ok {
		s.mediaSelectionMu.Unlock()
		fail(c, http.StatusNotFound, "selection expired or not found")
		return
	}
	if err := session.setExcluded(input.NodeID, *input.Excluded, input.Version); err != nil {
		s.mediaSelectionMu.Unlock()
		if errors.Is(err, errMediaSelectionConflict) {
			fail(c, http.StatusConflict, "selection version changed; refresh before editing")
		} else {
			fail(c, http.StatusBadRequest, "node is outside the frozen selection")
		}
		return
	}
	data := gin.H{
		"token": c.Param("token"), "version": session.version,
		"total": len(session.nodes), "selected": len(session.nodes) - len(session.excluded),
		"excluded": len(session.excluded), "expires_at": session.expiresAt,
	}
	s.mediaSelectionMu.Unlock()
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, data)
}

func (s *Server) deleteMediaSelectionSnapshot(c *gin.Context) {
	s.mediaSelectionMu.Lock()
	_, ok := s.mediaSelectionByTokenLocked(c, c.Param("token"))
	if ok {
		delete(s.mediaSelections, c.Param("token"))
	}
	s.mediaSelectionMu.Unlock()
	if !ok {
		fail(c, http.StatusNotFound, "selection expired or not found")
		return
	}
	c.Status(http.StatusNoContent)
}
