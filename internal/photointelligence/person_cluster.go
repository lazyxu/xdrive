package photointelligence

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	personClusterJoinCentroidThreshold  = 0.55
	personClusterJoinAnchorThreshold    = 0.40
	personClusterMergeCentroidThreshold = 0.60
	personClusterMergeAnchorThreshold   = 0.50
	personClusterMinSize                = 2

	personClusterPendingRetryInterval = 5 * time.Minute
	personClusterFailureRetryInterval = 6 * time.Hour
	personClusterRunningTimeout       = 30 * time.Minute
)

type PersonClusterRunner struct {
	DB  *gorm.DB
	Now func() time.Time
}

type personClusterCandidate struct {
	OwnerID         uint64
	FaceCount       uint64
	SourceUpdatedAt *time.Time
}

type personClusterFaceRow struct {
	FaceID           uint64
	AssetID          uint64
	AssetEvidenceKey string
	DetectionKey     string
	Confidence       float64
	X                float64
	Y                float64
	Width            float64
	Height           float64
	Embedding        []byte
	EmbeddingFormat  string
	EmbeddingVersion string
	UpdatedAt        time.Time
}

type personClusterFace struct {
	row       personClusterFaceRow
	vector    []float64
	stableKey string
	quality   float64
}

type personClusterResult struct {
	key      string
	centroid []float64
	members  []personClusterFace
}

type workingPersonCluster struct {
	members        []personClusterFace
	sum            []float64
	centroid       []float64
	representative int
	assets         map[uint64]struct{}
}

func PersonClusterAnalyzerVersion() string {
	spec := fmt.Sprintf(
		"greedy-centroid:v1:join=%.2f:anchor=%.2f:merge=%.2f:merge-anchor=%.2f:min=%d:same-asset=forbid",
		personClusterJoinCentroidThreshold,
		personClusterJoinAnchorThreshold,
		personClusterMergeCentroidThreshold,
		personClusterMergeAnchorThreshold,
		personClusterMinSize,
	)
	sum := sha256.Sum256([]byte(spec))
	return "person-cluster:v1:" + hex.EncodeToString(sum[:])
}

func (r *PersonClusterRunner) RunBatch(
	ctx context.Context,
	ownerLimit int,
) (int, error) {
	if r == nil || r.DB == nil {
		return 0, fmt.Errorf("photo person cluster runner is not configured")
	}
	if ownerLimit <= 0 {
		ownerLimit = 1
	}
	now := time.Now().UTC()
	if r.Now != nil {
		now = r.Now().UTC()
	}

	candidates, err := r.personClusterCandidates(ctx, now, ownerLimit)
	if err != nil {
		return 0, err
	}
	processed := 0
	var firstError error
	for _, candidate := range candidates {
		if ctx.Err() != nil {
			return processed, ctx.Err()
		}
		if err := r.reconcileOwner(ctx, candidate.OwnerID, now); err != nil {
			if firstError == nil {
				firstError = err
			}
		}
		processed++
	}
	return processed, firstError
}

func (r *PersonClusterRunner) personClusterCandidates(
	ctx context.Context,
	now time.Time,
	limit int,
) ([]personClusterCandidate, error) {
	eligible := r.DB.WithContext(ctx).
		Table("xd_photo_faces AS pf").
		Select(
			"pa.owner_id AS owner_id, COUNT(pf.id) AS face_count, "+
				"MAX(pf.updated_at) AS source_updated_at",
		).
		Joins("JOIN xd_photo_assets AS pa ON pa.id = pf.asset_id").
		Joins(
			"JOIN xd_photo_analysis_states AS fe ON fe.asset_id = pf.asset_id "+
				"AND fe.kind = ? AND fe.state = ? "+
				"AND fe.analyzer_version = pf.embedding_version",
			meta.PhotoAnalysisKindFaceEmbedding,
			meta.PhotoAnalysisStateReady,
		).
		Where(
			"pf.embedding_format = ? AND octet_length(pf.embedding) > 0",
			"f32le",
		).
		Group("pa.owner_id")

	var candidates []personClusterCandidate
	err := r.DB.WithContext(ctx).
		Table("xd_users AS u").
		Select(
			"u.id AS owner_id, COALESCE(es.face_count, 0) AS face_count, "+
				"es.source_updated_at AS source_updated_at",
		).
		Joins(
			"LEFT JOIN (?) AS es ON es.owner_id = u.id",
			eligible,
		).
		Joins(
			"LEFT JOIN xd_photo_person_cluster_states AS pcs ON pcs.owner_id = u.id",
		).
		Where("u.disabled_at IS NULL AND u.must_change_password = false").
		Where("es.owner_id IS NOT NULL OR pcs.owner_id IS NOT NULL").
		Where(
			"pcs.owner_id IS NULL OR "+
				"pcs.analyzer_version <> ? OR "+
				"pcs.state = ? OR "+
				"(pcs.state = ? AND pcs.updated_at <= ?) OR "+
				"(pcs.state = ? AND pcs.updated_at <= ?) OR "+
				"(pcs.state = ? AND pcs.updated_at <= ?) OR "+
				"COALESCE(pcs.face_count, 0) <> COALESCE(es.face_count, 0) OR "+
				"(es.source_updated_at IS NOT NULL AND "+
				"(pcs.source_updated_at IS NULL OR es.source_updated_at > pcs.source_updated_at))",
			PersonClusterAnalyzerVersion(),
			meta.PhotoAnalysisStateStale,
			meta.PhotoAnalysisStatePending,
			now.Add(-personClusterPendingRetryInterval),
			meta.PhotoAnalysisStateFailed,
			now.Add(-personClusterFailureRetryInterval),
			meta.PhotoAnalysisStateRunning,
			now.Add(-personClusterRunningTimeout),
		).
		Order(
			"COALESCE(pcs.updated_at, TIMESTAMP '1970-01-01') ASC, u.id ASC",
		).
		Limit(limit).
		Scan(&candidates).Error
	return candidates, err
}

func (r *PersonClusterRunner) reconcileOwner(
	ctx context.Context,
	ownerID uint64,
	now time.Time,
) error {
	faces, embeddingVersion, sourceUpdatedAt, mixed, err :=
		r.loadOwnerClusterFaces(ctx, ownerID)
	if err != nil {
		return err
	}
	fingerprint := personClusterInputFingerprint(faces, embeddingVersion)
	analyzerVersion := PersonClusterAnalyzerVersion()

	if mixed {
		return r.markPersonClusterPending(
			ctx,
			ownerID,
			analyzerVersion,
			fingerprint,
			uint64(len(faces)),
			sourceUpdatedAt,
			now,
		)
	}

	var state meta.PhotoPersonClusterState
	stateErr := r.DB.WithContext(ctx).
		First(&state, "owner_id = ?", ownerID).Error
	if stateErr == nil &&
		state.State == meta.PhotoAnalysisStateReady &&
		state.AnalyzerVersion == analyzerVersion &&
		state.EmbeddingVersion == embeddingVersion &&
		state.InputFingerprint == fingerprint {
		return r.updatePersonClusterSourceSnapshot(
			ctx,
			ownerID,
			uint64(len(faces)),
			sourceUpdatedAt,
			now,
		)
	}
	if stateErr != nil && stateErr != gorm.ErrRecordNotFound {
		return stateErr
	}

	if err := r.markPersonClusterRunning(
		ctx,
		ownerID,
		analyzerVersion,
		embeddingVersion,
		fingerprint,
		uint64(len(faces)),
		sourceUpdatedAt,
		now,
	); err != nil {
		return err
	}

	results, err := clusterPersonFaces(faces)
	if err != nil {
		r.failPersonCluster(ctx, ownerID, err, now)
		return err
	}
	if err := r.finishPersonCluster(
		ctx,
		ownerID,
		results,
		analyzerVersion,
		embeddingVersion,
		fingerprint,
		uint64(len(faces)),
		sourceUpdatedAt,
		now,
	); err != nil {
		r.failPersonCluster(ctx, ownerID, err, now)
		return err
	}
	return nil
}

func (r *PersonClusterRunner) loadOwnerClusterFaces(
	ctx context.Context,
	ownerID uint64,
) ([]personClusterFace, string, *time.Time, bool, error) {
	var rows []personClusterFaceRow
	err := r.DB.WithContext(ctx).
		Table("xd_photo_faces AS pf").
		Select(
			"pf.id AS face_id, pf.asset_id, pa.evidence_key AS asset_evidence_key, "+
				"pf.detection_key, pf.confidence, pf.x, pf.y, pf.width, pf.height, "+
				"pf.embedding, pf.embedding_format, pf.embedding_version, pf.updated_at",
		).
		Joins(
			"JOIN xd_photo_assets AS pa ON pa.id = pf.asset_id AND pa.owner_id = ?",
			ownerID,
		).
		Joins(
			"JOIN xd_photo_analysis_states AS fe ON fe.asset_id = pf.asset_id "+
				"AND fe.kind = ? AND fe.state = ? "+
				"AND fe.analyzer_version = pf.embedding_version",
			meta.PhotoAnalysisKindFaceEmbedding,
			meta.PhotoAnalysisStateReady,
		).
		Where(
			"pf.embedding_format = ? AND octet_length(pf.embedding) > 0",
			"f32le",
		).
		Order("pa.id ASC, pf.detection_key ASC, pf.id ASC").
		Scan(&rows).Error
	if err != nil {
		return nil, "", nil, false, err
	}

	versions := make(map[string]struct{})
	var sourceUpdatedAt *time.Time
	for _, row := range rows {
		version := strings.TrimSpace(row.EmbeddingVersion)
		if version == "" {
			return nil, "", nil, false, fmt.Errorf(
				"photo face %d is missing embedding version",
				row.FaceID,
			)
		}
		versions[version] = struct{}{}
		if sourceUpdatedAt == nil || row.UpdatedAt.After(*sourceUpdatedAt) {
			value := row.UpdatedAt.UTC()
			sourceUpdatedAt = &value
		}
	}

	faces := make([]personClusterFace, 0, len(rows))
	if len(versions) > 1 {
		for _, row := range rows {
			stableKey := strings.TrimSpace(row.AssetEvidenceKey)
			if stableKey == "" {
				stableKey = fmt.Sprintf("asset:%020d", row.AssetID)
			}
			stableKey += "\x00" + strings.TrimSpace(row.DetectionKey)
			faces = append(faces, personClusterFace{
				row:       row,
				stableKey: stableKey,
				quality:   row.Confidence * math.Max(row.Width*row.Height, 0),
			})
		}
		return faces, "", sourceUpdatedAt, true, nil
	}

	embeddingVersion := ""
	for version := range versions {
		embeddingVersion = version
	}
	dimensions := -1
	for _, row := range rows {
		vector, err := decodeNormalizedF32LE(row.Embedding)
		if err != nil {
			return nil, "", nil, false, fmt.Errorf(
				"photo face %d embedding: %w",
				row.FaceID,
				err,
			)
		}
		if dimensions < 0 {
			dimensions = len(vector)
		} else if len(vector) != dimensions {
			return nil, "", nil, false, fmt.Errorf(
				"photo face %d embedding dimensions %d do not match %d",
				row.FaceID,
				len(vector),
				dimensions,
			)
		}
		stableKey := strings.TrimSpace(row.AssetEvidenceKey)
		if stableKey == "" {
			stableKey = fmt.Sprintf("asset:%020d", row.AssetID)
		}
		stableKey += "\x00" + strings.TrimSpace(row.DetectionKey)
		faces = append(faces, personClusterFace{
			row:       row,
			vector:    vector,
			stableKey: stableKey,
			quality:   row.Confidence * math.Max(row.Width*row.Height, 0),
		})
	}
	return faces, embeddingVersion, sourceUpdatedAt, false, nil
}

func decodeNormalizedF32LE(raw []byte) ([]float64, error) {
	if len(raw) == 0 || len(raw)%4 != 0 {
		return nil, fmt.Errorf("invalid f32le byte length %d", len(raw))
	}
	dimensions := len(raw) / 4
	if dimensions > 4096 {
		return nil, fmt.Errorf("embedding dimensions %d exceed limit", dimensions)
	}
	vector := make([]float64, dimensions)
	normSquared := 0.0
	for index := 0; index < dimensions; index++ {
		value := float64(math.Float32frombits(
			binary.LittleEndian.Uint32(raw[index*4 : index*4+4]),
		))
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, fmt.Errorf("embedding contains non-finite value")
		}
		vector[index] = value
		normSquared += value * value
	}
	if normSquared <= 1e-12 {
		return nil, fmt.Errorf("embedding has zero norm")
	}
	norm := math.Sqrt(normSquared)
	for index := range vector {
		vector[index] /= norm
	}
	return vector, nil
}

func personClusterInputFingerprint(
	faces []personClusterFace,
	embeddingVersion string,
) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte("person-cluster-input:v1\n"))
	_, _ = hash.Write([]byte(embeddingVersion))
	_, _ = hash.Write([]byte{'\n'})
	for _, face := range faces {
		_, _ = fmt.Fprintf(
			hash,
			"%020d	%020d	%s	",
			face.row.FaceID,
			face.row.AssetID,
			face.stableKey,
		)
		_, _ = hash.Write(face.row.Embedding)
		_, _ = hash.Write([]byte{'\n'})
	}
	return "person-input:v1:" + hex.EncodeToString(hash.Sum(nil))
}

func clusterPersonFaces(
	input []personClusterFace,
) ([]personClusterResult, error) {
	if len(input) == 0 {
		return nil, nil
	}
	faces := append([]personClusterFace(nil), input...)
	sort.SliceStable(faces, func(i, j int) bool {
		if faces[i].quality != faces[j].quality {
			return faces[i].quality > faces[j].quality
		}
		if faces[i].stableKey != faces[j].stableKey {
			return faces[i].stableKey < faces[j].stableKey
		}
		return faces[i].row.FaceID < faces[j].row.FaceID
	})

	clusters := make([]*workingPersonCluster, 0, len(faces))
	for _, face := range faces {
		best := -1
		bestScore := -2.0
		for index, cluster := range clusters {
			if _, exists := cluster.assets[face.row.AssetID]; exists {
				continue
			}
			centroidScore := cosine(face.vector, cluster.centroid)
			anchorScore := cosine(
				face.vector,
				cluster.members[cluster.representative].vector,
			)
			if centroidScore < personClusterJoinCentroidThreshold ||
				anchorScore < personClusterJoinAnchorThreshold {
				continue
			}
			if best < 0 ||
				centroidScore > bestScore+1e-12 ||
				(math.Abs(centroidScore-bestScore) <= 1e-12 &&
					clusterSortKey(cluster) < clusterSortKey(clusters[best])) {
				best = index
				bestScore = centroidScore
			}
		}
		if best < 0 {
			cluster := newWorkingPersonCluster(face)
			clusters = append(clusters, cluster)
			continue
		}
		addFaceToWorkingCluster(clusters[best], face)
	}

	for {
		bestI, bestJ := -1, -1
		bestScore := -2.0
		for i := 0; i < len(clusters); i++ {
			for j := i + 1; j < len(clusters); j++ {
				if len(clusters[i].members) == 1 &&
					len(clusters[j].members) == 1 {
					continue
				}
				if clustersShareAsset(clusters[i], clusters[j]) {
					continue
				}
				centroidScore := cosine(
					clusters[i].centroid,
					clusters[j].centroid,
				)
				if centroidScore < personClusterMergeCentroidThreshold {
					continue
				}
				anchorScore := cosine(
					clusters[i].members[clusters[i].representative].vector,
					clusters[j].members[clusters[j].representative].vector,
				)
				if anchorScore < personClusterMergeAnchorThreshold {
					continue
				}
				if bestI < 0 ||
					centroidScore > bestScore+1e-12 ||
					(math.Abs(centroidScore-bestScore) <= 1e-12 &&
						clusterPairSortKey(clusters[i], clusters[j]) <
							clusterPairSortKey(clusters[bestI], clusters[bestJ])) {
					bestI, bestJ = i, j
					bestScore = centroidScore
				}
			}
		}
		if bestI < 0 {
			break
		}
		mergeWorkingPersonClusters(clusters[bestI], clusters[bestJ])
		clusters = append(clusters[:bestJ], clusters[bestJ+1:]...)
	}

	results := make([]personClusterResult, 0, len(clusters))
	for _, cluster := range clusters {
		if len(cluster.members) < personClusterMinSize {
			continue
		}
		members := append([]personClusterFace(nil), cluster.members...)
		sort.Slice(members, func(i, j int) bool {
			if members[i].stableKey != members[j].stableKey {
				return members[i].stableKey < members[j].stableKey
			}
			return members[i].row.FaceID < members[j].row.FaceID
		})
		results = append(results, personClusterResult{
			key:      personClusterKey(members),
			centroid: append([]float64(nil), cluster.centroid...),
			members:  members,
		})
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].key < results[j].key
	})
	return results, nil
}

func newWorkingPersonCluster(face personClusterFace) *workingPersonCluster {
	vector := append([]float64(nil), face.vector...)
	return &workingPersonCluster{
		members:        []personClusterFace{face},
		sum:            append([]float64(nil), vector...),
		centroid:       vector,
		representative: 0,
		assets:         map[uint64]struct{}{face.row.AssetID: {}},
	}
}

func addFaceToWorkingCluster(
	cluster *workingPersonCluster,
	face personClusterFace,
) {
	cluster.members = append(cluster.members, face)
	cluster.assets[face.row.AssetID] = struct{}{}
	for index, value := range face.vector {
		cluster.sum[index] += value
	}
	recomputeWorkingCluster(cluster)
}

func mergeWorkingPersonClusters(
	target, source *workingPersonCluster,
) {
	for _, face := range source.members {
		target.members = append(target.members, face)
		target.assets[face.row.AssetID] = struct{}{}
	}
	for index, value := range source.sum {
		target.sum[index] += value
	}
	recomputeWorkingCluster(target)
}

func recomputeWorkingCluster(cluster *workingPersonCluster) {
	cluster.centroid = normalizeVector(cluster.sum)
	best := 0
	bestScore := -2.0
	for index, face := range cluster.members {
		score := cosine(face.vector, cluster.centroid)
		if index == 0 ||
			score > bestScore+1e-12 ||
			(math.Abs(score-bestScore) <= 1e-12 &&
				face.stableKey < cluster.members[best].stableKey) {
			best = index
			bestScore = score
		}
	}
	cluster.representative = best
}

func normalizeVector(values []float64) []float64 {
	out := append([]float64(nil), values...)
	normSquared := 0.0
	for _, value := range out {
		normSquared += value * value
	}
	if normSquared <= 1e-12 {
		return out
	}
	norm := math.Sqrt(normSquared)
	for index := range out {
		out[index] /= norm
	}
	return out
}

func cosine(left, right []float64) float64 {
	if len(left) == 0 || len(left) != len(right) {
		return -1
	}
	score := 0.0
	for index := range left {
		score += left[index] * right[index]
	}
	if score > 1 {
		return 1
	}
	if score < -1 {
		return -1
	}
	return score
}

func clustersShareAsset(
	left, right *workingPersonCluster,
) bool {
	if len(left.assets) > len(right.assets) {
		left, right = right, left
	}
	for assetID := range left.assets {
		if _, exists := right.assets[assetID]; exists {
			return true
		}
	}
	return false
}

func clusterSortKey(cluster *workingPersonCluster) string {
	keys := make([]string, 0, len(cluster.members))
	for _, face := range cluster.members {
		keys = append(keys, face.stableKey)
	}
	sort.Strings(keys)
	return strings.Join(keys, "\n")
}

func clusterPairSortKey(
	left, right *workingPersonCluster,
) string {
	leftKey := clusterSortKey(left)
	rightKey := clusterSortKey(right)
	if leftKey > rightKey {
		leftKey, rightKey = rightKey, leftKey
	}
	return leftKey + "\x00" + rightKey
}

func personClusterKey(members []personClusterFace) string {
	hash := sha256.New()
	_, _ = hash.Write([]byte("person-auto-cluster:v1\n"))
	for _, face := range members {
		_, _ = hash.Write([]byte(face.stableKey))
		_, _ = hash.Write([]byte{'\n'})
	}
	return "auto:v1:" + hex.EncodeToString(hash.Sum(nil))
}

func encodeNormalizedF32LE(vector []float64) ([]byte, error) {
	normalized := normalizeVector(vector)
	if len(normalized) == 0 || len(normalized) > 4096 {
		return nil, fmt.Errorf("invalid centroid dimensions %d", len(normalized))
	}
	out := make([]byte, len(normalized)*4)
	for index, value := range normalized {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, fmt.Errorf("centroid contains non-finite value")
		}
		binary.LittleEndian.PutUint32(
			out[index*4:index*4+4],
			math.Float32bits(float32(value)),
		)
	}
	return out, nil
}

func (r *PersonClusterRunner) markPersonClusterPending(
	ctx context.Context,
	ownerID uint64,
	analyzerVersion, fingerprint string,
	faceCount uint64,
	sourceUpdatedAt *time.Time,
	now time.Time,
) error {
	row := meta.PhotoPersonClusterState{
		OwnerID:          ownerID,
		AnalyzerVersion:  analyzerVersion,
		InputFingerprint: fingerprint,
		FaceCount:        faceCount,
		SourceUpdatedAt:  sourceUpdatedAt,
		State:            meta.PhotoAnalysisStatePending,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	return r.DB.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "owner_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"analyzer_version":  analyzerVersion,
				"embedding_version": "",
				"input_fingerprint": fingerprint,
				"face_count":        faceCount,
				"source_updated_at": sourceUpdatedAt,
				"state":             meta.PhotoAnalysisStatePending,
				"last_error":        "",
				"completed_at":      nil,
				"updated_at":        now,
			}),
		}).
		Create(&row).Error
}

func (r *PersonClusterRunner) markPersonClusterRunning(
	ctx context.Context,
	ownerID uint64,
	analyzerVersion, embeddingVersion, fingerprint string,
	faceCount uint64,
	sourceUpdatedAt *time.Time,
	now time.Time,
) error {
	row := meta.PhotoPersonClusterState{
		OwnerID:          ownerID,
		AnalyzerVersion:  analyzerVersion,
		EmbeddingVersion: embeddingVersion,
		InputFingerprint: fingerprint,
		FaceCount:        faceCount,
		SourceUpdatedAt:  sourceUpdatedAt,
		State:            meta.PhotoAnalysisStateRunning,
		Attempt:          1,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	return r.DB.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "owner_id"}},
			DoUpdates: clause.Assignments(map[string]any{
				"analyzer_version":  analyzerVersion,
				"embedding_version": embeddingVersion,
				"input_fingerprint": fingerprint,
				"face_count":        faceCount,
				"source_updated_at": sourceUpdatedAt,
				"state":             meta.PhotoAnalysisStateRunning,
				"attempt": gorm.Expr(
					"\"xd_photo_person_cluster_states\".\"attempt\" + 1",
				),
				"last_error":   "",
				"completed_at": nil,
				"updated_at":   now,
			}),
		}).
		Create(&row).Error
}

func (r *PersonClusterRunner) finishPersonCluster(
	ctx context.Context,
	ownerID uint64,
	results []personClusterResult,
	analyzerVersion, embeddingVersion, fingerprint string,
	faceCount uint64,
	sourceUpdatedAt *time.Time,
	now time.Time,
) error {
	return r.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("owner_id = ?", ownerID).
			Delete(&meta.PhotoPersonCluster{}).Error; err != nil {
			return err
		}

		for _, result := range results {
			centroid, err := encodeNormalizedF32LE(result.centroid)
			if err != nil {
				return err
			}
			cluster := meta.PhotoPersonCluster{
				OwnerID:          ownerID,
				ClusterKey:       result.key,
				AnalyzerVersion:  analyzerVersion,
				Embedding:        centroid,
				EmbeddingFormat:  "f32le",
				EmbeddingVersion: embeddingVersion,
				CreatedAt:        now,
				UpdatedAt:        now,
			}
			if err := tx.Create(&cluster).Error; err != nil {
				return err
			}
			memberships := make([]meta.PhotoPersonClusterFace, 0, len(result.members))
			for _, member := range result.members {
				confidence := cosine(member.vector, result.centroid)
				if confidence < 0 {
					confidence = 0
				}
				if confidence > 1 {
					confidence = 1
				}
				memberships = append(memberships, meta.PhotoPersonClusterFace{
					ClusterID:  cluster.ID,
					FaceID:     member.row.FaceID,
					Confidence: confidence,
					CreatedAt:  now,
					UpdatedAt:  now,
				})
			}
			if len(memberships) != 0 {
				if err := tx.Create(&memberships).Error; err != nil {
					return err
				}
			}
		}

		completed := now
		result := tx.Model(&meta.PhotoPersonClusterState{}).
			Where("owner_id = ?", ownerID).
			Updates(map[string]any{
				"analyzer_version":  analyzerVersion,
				"embedding_version": embeddingVersion,
				"input_fingerprint": fingerprint,
				"face_count":        faceCount,
				"source_updated_at": sourceUpdatedAt,
				"state":             meta.PhotoAnalysisStateReady,
				"last_error":        "",
				"completed_at":      &completed,
				"updated_at":        now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return fmt.Errorf("photo person cluster state is missing")
		}
		return nil
	})
}

func (r *PersonClusterRunner) failPersonCluster(
	ctx context.Context,
	ownerID uint64,
	cause error,
	now time.Time,
) {
	message := strings.TrimSpace(cause.Error())
	if len(message) > 2000 {
		message = message[:2000]
	}
	_ = r.DB.WithContext(ctx).
		Model(&meta.PhotoPersonClusterState{}).
		Where("owner_id = ?", ownerID).
		Updates(map[string]any{
			"state":        meta.PhotoAnalysisStateFailed,
			"last_error":   message,
			"completed_at": nil,
			"updated_at":   now,
		}).Error
}

func (r *PersonClusterRunner) updatePersonClusterSourceSnapshot(
	ctx context.Context,
	ownerID, faceCount uint64,
	sourceUpdatedAt *time.Time,
	now time.Time,
) error {
	return r.DB.WithContext(ctx).
		Model(&meta.PhotoPersonClusterState{}).
		Where("owner_id = ?", ownerID).
		Updates(map[string]any{
			"face_count":        faceCount,
			"source_updated_at": sourceUpdatedAt,
			"updated_at":        now,
		}).Error
}
