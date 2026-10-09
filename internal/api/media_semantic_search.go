package api

import (
	"context"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/gorm"
)

const (
	photoSemanticIndexTTL      = 30 * time.Second
	photoSemanticQueryTTL      = 5 * time.Minute
	photoSemanticQueryCacheMax = 128
	photoSemanticResultLimit   = 2000
	photoSemanticLexicalBoost  = 2.0
)

type photoSemanticIndexRow struct {
	AssetID   uint64
	NodeID    uint64
	Embedding []byte
}

type photoSemanticOwnerIndex struct {
	Version    string
	Format     string
	Dimensions int
	LoadedAt   time.Time
	Rows       []photoSemanticIndexRow
}

type photoSemanticQueryEntry struct {
	Embedding []byte
	ExpiresAt time.Time
}

type photoSemanticSearchEngine struct {
	mu      sync.Mutex
	owners  map[uint64]photoSemanticOwnerIndex
	queries map[string]photoSemanticQueryEntry
}

func newPhotoSemanticSearchEngine() *photoSemanticSearchEngine {
	return &photoSemanticSearchEngine{
		owners:  make(map[uint64]photoSemanticOwnerIndex),
		queries: make(map[string]photoSemanticQueryEntry),
	}
}

func (e *photoSemanticSearchEngine) InvalidateOwner(ownerID uint64) {
	if e == nil || ownerID == 0 {
		return
	}
	e.mu.Lock()
	delete(e.owners, ownerID)
	e.mu.Unlock()
}

func (e *photoSemanticSearchEngine) queryEmbedding(
	ctx context.Context,
	analyzer photointelligence.SemanticAnalyzer,
	info photointelligence.SemanticAnalyzerInfo,
	text string,
) ([]byte, error) {
	version := photointelligence.SemanticAnalyzerVersion(info)
	key := version + "\x00" + text
	now := time.Now().UTC()

	e.mu.Lock()
	if entry, ok := e.queries[key]; ok && entry.ExpiresAt.After(now) {
		value := append([]byte(nil), entry.Embedding...)
		e.mu.Unlock()
		return value, nil
	}
	e.mu.Unlock()

	raw, err := analyzer.EmbedText(ctx, text)
	if err != nil {
		return nil, err
	}
	raw, err = photointelligence.ValidateSemanticEmbedding(info, raw)
	if err != nil {
		return nil, err
	}
	value := append([]byte(nil), raw.Embedding...)

	e.mu.Lock()
	if len(e.queries) >= photoSemanticQueryCacheMax {
		var oldestKey string
		var oldest time.Time
		for candidateKey, entry := range e.queries {
			if oldestKey == "" || entry.ExpiresAt.Before(oldest) {
				oldestKey = candidateKey
				oldest = entry.ExpiresAt
			}
		}
		if oldestKey != "" {
			delete(e.queries, oldestKey)
		}
	}
	e.queries[key] = photoSemanticQueryEntry{
		Embedding: append([]byte(nil), value...),
		ExpiresAt: now.Add(photoSemanticQueryTTL),
	}
	e.mu.Unlock()
	return value, nil
}

func (e *photoSemanticSearchEngine) ownerIndex(
	ctx context.Context,
	db *gorm.DB,
	ownerID uint64,
	info photointelligence.SemanticAnalyzerInfo,
) (photoSemanticOwnerIndex, error) {
	version := photointelligence.SemanticAnalyzerVersion(info)
	now := time.Now().UTC()

	e.mu.Lock()
	if cached, ok := e.owners[ownerID]; ok &&
		cached.Version == version &&
		cached.Format == info.EmbeddingFormat &&
		cached.Dimensions == info.EmbeddingDimensions &&
		now.Sub(cached.LoadedAt) < photoSemanticIndexTTL {
		out := cached
		out.Rows = append([]photoSemanticIndexRow(nil), cached.Rows...)
		e.mu.Unlock()
		return out, nil
	}
	e.mu.Unlock()

	type row struct {
		AssetID   uint64
		NodeID    uint64
		Embedding []byte
	}
	var rows []row
	err := db.WithContext(ctx).
		Table("xd_photo_semantic_embeddings AS se").
		Select("se.asset_id, pa.primary_node_id AS node_id, se.embedding").
		Joins("JOIN xd_photo_assets AS pa ON pa.id = se.asset_id AND pa.owner_id = se.owner_id").
		Joins("JOIN xd_nodes AS n ON n.id = pa.primary_node_id AND n.deleted_at IS NULL").
		Joins(
			"JOIN xd_photo_analysis_states AS state ON state.asset_id = se.asset_id "+
				"AND state.kind = ? AND state.state = ? AND state.analyzer_version = ?",
			meta.PhotoAnalysisKindSemanticEmbedding,
			meta.PhotoAnalysisStateReady,
			version,
		).
		Where(
			"se.owner_id = ? AND se.analyzer_version = ? AND "+
				"se.embedding_format = ? AND se.dimensions = ?",
			ownerID,
			version,
			info.EmbeddingFormat,
			info.EmbeddingDimensions,
		).
		Order("se.asset_id ASC").
		Scan(&rows).Error
	if err != nil {
		return photoSemanticOwnerIndex{}, err
	}
	index := photoSemanticOwnerIndex{
		Version:    version,
		Format:     info.EmbeddingFormat,
		Dimensions: info.EmbeddingDimensions,
		LoadedAt:   now,
		Rows:       make([]photoSemanticIndexRow, 0, len(rows)),
	}
	for _, row := range rows {
		if len(row.Embedding) != info.EmbeddingDimensions {
			continue
		}
		index.Rows = append(index.Rows, photoSemanticIndexRow{
			AssetID:   row.AssetID,
			NodeID:    row.NodeID,
			Embedding: append([]byte(nil), row.Embedding...),
		})
	}

	e.mu.Lock()
	e.owners[ownerID] = index
	e.mu.Unlock()
	return index, nil
}

func cosineI8Normalized(left, right []byte) float64 {
	if len(left) == 0 || len(left) != len(right) {
		return -1
	}
	var dot, leftNorm, rightNorm int64
	for index := range left {
		a := int64(int8(left[index]))
		b := int64(int8(right[index]))
		dot += a * b
		leftNorm += a * a
		rightNorm += b * b
	}
	if leftNorm == 0 || rightNorm == 0 {
		return -1
	}
	return float64(dot) / math.Sqrt(float64(leftNorm)*float64(rightNorm))
}

type photoSemanticRank struct {
	NodeID uint64
	Score  float64
}

func (e *photoSemanticSearchEngine) Rank(
	ctx context.Context,
	db *gorm.DB,
	analyzer photointelligence.SemanticAnalyzer,
	ownerID uint64,
	base *gorm.DB,
	search string,
) ([]uint64, bool, error) {
	if e == nil || db == nil || analyzer == nil || ownerID == 0 {
		return nil, false, nil
	}
	search, err := photointelligence.NormalizeSemanticSearchText(search)
	if err != nil {
		return nil, false, nil
	}
	info, err := analyzer.Info(ctx)
	if err != nil {
		return nil, false, nil
	}
	if err := photointelligence.ValidateSemanticAnalyzerInfo(info); err != nil {
		return nil, false, nil
	}
	queryEmbedding, err := e.queryEmbedding(ctx, analyzer, info, search)
	if err != nil {
		return nil, false, nil
	}
	index, err := e.ownerIndex(ctx, db, ownerID, info)
	if err != nil {
		return nil, false, err
	}
	if len(index.Rows) == 0 {
		return nil, false, nil
	}

	type candidateRow struct {
		AssetID uint64
		NodeID  uint64
	}
	var candidates []candidateRow
	if err := base.Session(&gorm.Session{}).
		Select("pa.id AS asset_id, n.id AS node_id").
		Distinct().
		Scan(&candidates).Error; err != nil {
		return nil, false, err
	}
	eligibleByAsset := make(map[uint64]uint64, len(candidates))
	eligibleNodes := make(map[uint64]struct{}, len(candidates))
	for _, candidate := range candidates {
		eligibleByAsset[candidate.AssetID] = candidate.NodeID
		eligibleNodes[candidate.NodeID] = struct{}{}
	}

	semantic := make([]photoSemanticRank, 0, len(index.Rows))
	for _, row := range index.Rows {
		nodeID, ok := eligibleByAsset[row.AssetID]
		if !ok {
			continue
		}
		semantic = append(semantic, photoSemanticRank{
			NodeID: nodeID,
			Score:  cosineI8Normalized(queryEmbedding, row.Embedding),
		})
	}
	sort.Slice(semantic, func(i, j int) bool {
		if semantic[i].Score != semantic[j].Score {
			return semantic[i].Score > semantic[j].Score
		}
		return semantic[i].NodeID > semantic[j].NodeID
	})
	if len(semantic) > photoSemanticResultLimit {
		semantic = semantic[:photoSemanticResultLimit]
	}

	scores := make(map[uint64]float64, len(semantic))
	for _, row := range semantic {
		scores[row.NodeID] = row.Score
	}

	var lexicalNodeIDs []uint64
	if err := applyMediaSearchFilter(
		base.Session(&gorm.Session{}),
		search,
	).Select("n.id").
		Distinct().
		Scan(&lexicalNodeIDs).Error; err != nil {
		return nil, false, err
	}
	for _, nodeID := range lexicalNodeIDs {
		if _, ok := eligibleNodes[nodeID]; !ok {
			continue
		}
		score := scores[nodeID]
		if score < 0 {
			score = 0
		}
		scores[nodeID] = photoSemanticLexicalBoost + score
	}

	ranked := make([]photoSemanticRank, 0, len(scores))
	for nodeID, score := range scores {
		ranked = append(ranked, photoSemanticRank{NodeID: nodeID, Score: score})
	}
	sort.Slice(ranked, func(i, j int) bool {
		if ranked[i].Score != ranked[j].Score {
			return ranked[i].Score > ranked[j].Score
		}
		return ranked[i].NodeID > ranked[j].NodeID
	})
	nodeIDs := make([]uint64, 0, len(ranked))
	for _, row := range ranked {
		nodeIDs = append(nodeIDs, row.NodeID)
	}
	return nodeIDs, true, nil
}

func (s *Server) semanticRankedMediaNodeIDs(
	ctx context.Context,
	uid uint64,
	options mediaQueryOptions,
	albumKey string,
) ([]uint64, bool, error) {
	if strings.TrimSpace(options.Search) == "" || s.PhotoSemanticAnalyzer == nil {
		return nil, false, nil
	}
	s.photoIntelligenceMu.Lock()
	if s.photoSemanticSearch == nil {
		s.photoSemanticSearch = newPhotoSemanticSearchEngine()
	}
	engine := s.photoSemanticSearch
	s.photoIntelligenceMu.Unlock()

	queryOptions := options.withoutSearch()
	queryOptions.foldIndex = nil // Rank all search matches before folding.
	base, err := s.mediaItemsBaseQuery(
		ctx,
		uid,
		queryOptions,
		albumKey,
	)
	if err != nil {
		return nil, false, err
	}
	ranked, handled, err := engine.Rank(
		ctx,
		s.DB,
		s.PhotoSemanticAnalyzer,
		uid,
		base,
		options.Search,
	)
	if err != nil || !handled || options.foldIndex == nil {
		return ranked, handled, err
	}
	return options.foldIndex.foldRankedIDs(ranked), handled, nil
}

func semanticPage(nodeIDs []uint64, limit, offset int) []uint64 {
	if offset < 0 || limit <= 0 || offset >= len(nodeIDs) {
		return []uint64{}
	}
	end := offset + limit
	if end > len(nodeIDs) {
		end = len(nodeIDs)
	}
	return append([]uint64(nil), nodeIDs[offset:end]...)
}
