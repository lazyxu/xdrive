package maintenance

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/gorm"
)

const (
	mediaDurablePersonKeyPrefix   = "person:v1:"
	mediaAutomaticPersonKeyPrefix = "auto:v1:"
)

type mediaPhotoPersonIntegrityStats struct {
	People              int
	Memberships         int
	SmartAlbums         int
	PersonClusters      int
	PersonClusterFaces  int
	PersonClusterStates int
}

type mediaSmartAlbumPersonQuery struct {
	PersonIdentity string `json:"person_identity,omitempty"`
}

func validMediaDurablePersonKey(value string) bool {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, mediaDurablePersonKeyPrefix) {
		return false
	}
	_, err := uuid.Parse(strings.TrimPrefix(value, mediaDurablePersonKeyPrefix))
	return err == nil
}

func validMediaAutomaticPersonKey(value string) bool {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, mediaAutomaticPersonKeyPrefix) {
		return false
	}
	raw := strings.TrimPrefix(value, mediaAutomaticPersonKeyPrefix)
	if len(raw) != 64 {
		return false
	}
	_, err := hex.DecodeString(raw)
	return err == nil
}

func verifyPhotoPersonIntegrity(
	ctx context.Context,
	db *gorm.DB,
) (mediaPhotoPersonIntegrityStats, []MediaIntegrityIssue, error) {
	var stats mediaPhotoPersonIntegrityStats
	if db == nil {
		return stats, nil, fmt.Errorf("photo person integrity database is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	scoped := db.WithContext(ctx)
	if !scoped.Migrator().HasTable(&meta.PhotoPerson{}) {
		return stats, nil, nil
	}

	var people []meta.PhotoPerson
	if err := db.WithContext(ctx).Order("owner_id ASC, id ASC").Find(&people).Error; err != nil {
		return stats, nil, fmt.Errorf("query durable people: %w", err)
	}
	var memberships []meta.PhotoPersonAsset
	if err := db.WithContext(ctx).Order("person_id ASC, asset_id ASC").Find(&memberships).Error; err != nil {
		return stats, nil, fmt.Errorf("query durable person memberships: %w", err)
	}
	var clusters []meta.PhotoPersonCluster
	if err := db.WithContext(ctx).Order("owner_id ASC, id ASC").Find(&clusters).Error; err != nil {
		return stats, nil, fmt.Errorf("query person clusters: %w", err)
	}
	var clusterFaces []meta.PhotoPersonClusterFace
	if err := db.WithContext(ctx).Order("cluster_id ASC, face_id ASC").Find(&clusterFaces).Error; err != nil {
		return stats, nil, fmt.Errorf("query person cluster faces: %w", err)
	}
	var clusterStates []meta.PhotoPersonClusterState
	if err := db.WithContext(ctx).Order("owner_id ASC").Find(&clusterStates).Error; err != nil {
		return stats, nil, fmt.Errorf("query person cluster states: %w", err)
	}
	var smartAlbums []meta.PhotoCollection
	if err := db.WithContext(ctx).
		Where("kind = ? AND state = ?", meta.PhotoCollectionKindSmart, meta.PhotoCollectionStateActive).
		Order("owner_id ASC, id ASC").
		Find(&smartAlbums).Error; err != nil {
		return stats, nil, fmt.Errorf("query smart albums: %w", err)
	}

	stats.People = len(people)
	stats.Memberships = len(memberships)
	stats.PersonClusters = len(clusters)
	stats.PersonClusterFaces = len(clusterFaces)
	stats.PersonClusterStates = len(clusterStates)
	stats.SmartAlbums = len(smartAlbums)

	faceIDs := make([]uint64, 0, len(clusterFaces))
	seenFaces := make(map[uint64]struct{}, len(clusterFaces))
	for _, row := range clusterFaces {
		if row.FaceID == 0 {
			continue
		}
		if _, ok := seenFaces[row.FaceID]; ok {
			continue
		}
		seenFaces[row.FaceID] = struct{}{}
		faceIDs = append(faceIDs, row.FaceID)
	}
	var faces []meta.PhotoFace
	if err := forSourceVerifyIDBatches(faceIDs, func(batch []uint64) error {
		var rows []meta.PhotoFace
		if err := db.WithContext(ctx).Where("id IN ?", batch).Find(&rows).Error; err != nil {
			return err
		}
		faces = append(faces, rows...)
		return nil
	}); err != nil {
		return stats, nil, fmt.Errorf("query clustered faces: %w", err)
	}

	assetIDSet := make(map[uint64]struct{}, len(memberships)+len(people)+len(faces))
	for _, row := range memberships {
		if row.AssetID != 0 {
			assetIDSet[row.AssetID] = struct{}{}
		}
	}
	for _, person := range people {
		if person.CoverAssetID != nil && *person.CoverAssetID != 0 {
			assetIDSet[*person.CoverAssetID] = struct{}{}
		}
	}
	for _, face := range faces {
		if face.AssetID != 0 {
			assetIDSet[face.AssetID] = struct{}{}
		}
	}
	assetIDs := make([]uint64, 0, len(assetIDSet))
	for id := range assetIDSet {
		assetIDs = append(assetIDs, id)
	}
	sort.Slice(assetIDs, func(i, j int) bool { return assetIDs[i] < assetIDs[j] })
	var assets []meta.PhotoAsset
	if err := forSourceVerifyIDBatches(assetIDs, func(batch []uint64) error {
		var rows []meta.PhotoAsset
		if err := db.WithContext(ctx).Where("id IN ?", batch).Find(&rows).Error; err != nil {
			return err
		}
		assets = append(assets, rows...)
		return nil
	}); err != nil {
		return stats, nil, fmt.Errorf("query photo assets for person integrity: %w", err)
	}

	peopleByID := make(map[uint64]meta.PhotoPerson, len(people))
	peopleByKey := make(map[string]meta.PhotoPerson, len(people))
	for _, person := range people {
		peopleByID[person.ID] = person
		peopleByKey[person.PersonKey] = person
	}
	assetsByID := make(map[uint64]meta.PhotoAsset, len(assets))
	for _, asset := range assets {
		assetsByID[asset.ID] = asset
	}
	facesByID := make(map[uint64]meta.PhotoFace, len(faces))
	for _, face := range faces {
		facesByID[face.ID] = face
	}
	clustersByID := make(map[uint64]meta.PhotoPersonCluster, len(clusters))
	for _, cluster := range clusters {
		clustersByID[cluster.ID] = cluster
	}
	statesByOwner := make(map[uint64]meta.PhotoPersonClusterState, len(clusterStates))
	for _, state := range clusterStates {
		statesByOwner[state.OwnerID] = state
	}
	membershipSet := make(map[[2]uint64]struct{}, len(memberships))
	for _, row := range memberships {
		membershipSet[[2]uint64{row.PersonID, row.AssetID}] = struct{}{}
	}
	clusterFaceCount := make(map[uint64]int, len(clusters))
	for _, row := range clusterFaces {
		clusterFaceCount[row.ClusterID]++
	}

	var issues []MediaIntegrityIssue
	add := func(issue MediaIntegrityIssue) {
		issues = append(issues, issue)
	}

	for _, person := range people {
		if !validMediaDurablePersonKey(person.PersonKey) {
			add(MediaIntegrityIssue{
				OwnerID: person.OwnerID, PersonRowID: person.ID, PersonID: person.PersonKey,
				Reason: "person_key_invalid", Actual: person.PersonKey,
			})
		}
	}

	for _, row := range memberships {
		base := MediaIntegrityIssue{PersonRowID: row.PersonID, AssetID: row.AssetID}
		person, personOK := peopleByID[row.PersonID]
		if !personOK {
			base.Reason = "person_membership_person_missing"
			add(base)
			continue
		}
		base.OwnerID = person.OwnerID
		base.PersonID = person.PersonKey
		asset, assetOK := assetsByID[row.AssetID]
		if !assetOK {
			base.Reason = "person_membership_asset_missing"
			add(base)
			continue
		}
		if asset.OwnerID != person.OwnerID {
			base.Reason = "person_membership_owner_mismatch"
			base.Expected = fmt.Sprintf("%d", person.OwnerID)
			base.Actual = fmt.Sprintf("%d", asset.OwnerID)
			add(base)
		}
	}

	for _, person := range people {
		if person.CoverAssetID == nil || *person.CoverAssetID == 0 {
			continue
		}
		assetID := *person.CoverAssetID
		base := MediaIntegrityIssue{
			OwnerID: person.OwnerID, PersonRowID: person.ID, PersonID: person.PersonKey,
			AssetID: assetID,
		}
		asset, ok := assetsByID[assetID]
		if !ok {
			base.Reason = "person_cover_asset_missing"
			add(base)
			continue
		}
		if asset.OwnerID != person.OwnerID {
			issue := base
			issue.Reason = "person_cover_owner_mismatch"
			issue.Expected = fmt.Sprintf("%d", person.OwnerID)
			issue.Actual = fmt.Sprintf("%d", asset.OwnerID)
			add(issue)
		}
		if _, ok := membershipSet[[2]uint64{person.ID, assetID}]; !ok {
			issue := base
			issue.Reason = "person_cover_not_member"
			add(issue)
		}
	}

	for _, album := range smartAlbums {
		var query mediaSmartAlbumPersonQuery
		if err := json.Unmarshal([]byte(album.QueryJSON), &query); err != nil {
			add(MediaIntegrityIssue{
				OwnerID: album.OwnerID, CollectionID: album.ID,
				Reason: "smart_album_query_invalid",
			})
			continue
		}
		personID := strings.TrimSpace(query.PersonIdentity)
		if personID == "" {
			continue
		}
		base := MediaIntegrityIssue{
			OwnerID: album.OwnerID, CollectionID: album.ID, PersonID: personID,
		}
		if !validMediaDurablePersonKey(personID) {
			base.Reason = "smart_album_person_identity_invalid"
			base.Actual = personID
			add(base)
			continue
		}
		person, ok := peopleByKey[personID]
		if !ok {
			base.Reason = "smart_album_person_identity_missing"
			add(base)
			continue
		}
		base.PersonRowID = person.ID
		if person.OwnerID != album.OwnerID {
			base.Reason = "smart_album_person_identity_owner_mismatch"
			base.Expected = fmt.Sprintf("%d", album.OwnerID)
			base.Actual = fmt.Sprintf("%d", person.OwnerID)
			add(base)
		}
	}

	currentAnalyzer := photointelligence.PersonClusterAnalyzerVersion()
	for _, state := range clusterStates {
		base := MediaIntegrityIssue{OwnerID: state.OwnerID}
		if !meta.ValidPhotoAnalysisState(state.State) {
			base.Reason = "person_cluster_state_invalid"
			base.Actual = state.State
			add(base)
			continue
		}
		if state.State != meta.PhotoAnalysisStateReady {
			continue
		}
		if state.AnalyzerVersion != currentAnalyzer {
			issue := base
			issue.Reason = "person_cluster_state_analyzer_stale"
			issue.Expected = currentAnalyzer
			issue.Actual = state.AnalyzerVersion
			add(issue)
		}
		if state.CompletedAt == nil {
			issue := base
			issue.Reason = "person_cluster_state_ready_incomplete"
			add(issue)
		}
	}

	for _, cluster := range clusters {
		base := MediaIntegrityIssue{OwnerID: cluster.OwnerID, ClusterID: cluster.ID}
		if !validMediaAutomaticPersonKey(cluster.ClusterKey) {
			issue := base
			issue.Reason = "person_cluster_key_invalid"
			issue.Actual = cluster.ClusterKey
			add(issue)
		}
		if clusterFaceCount[cluster.ID] == 0 {
			issue := base
			issue.Reason = "person_cluster_empty"
			add(issue)
		}
		state, ok := statesByOwner[cluster.OwnerID]
		if !ok {
			issue := base
			issue.Reason = "person_cluster_state_missing"
			add(issue)
			continue
		}
		if state.State == meta.PhotoAnalysisStateReady &&
			(cluster.AnalyzerVersion != state.AnalyzerVersion ||
				cluster.EmbeddingVersion != state.EmbeddingVersion) {
			issue := base
			issue.Reason = "person_cluster_version_mismatch"
			issue.Expected = state.AnalyzerVersion + "/" + state.EmbeddingVersion
			issue.Actual = cluster.AnalyzerVersion + "/" + cluster.EmbeddingVersion
			add(issue)
		}
	}

	for _, row := range clusterFaces {
		cluster, clusterOK := clustersByID[row.ClusterID]
		base := MediaIntegrityIssue{ClusterID: row.ClusterID, FaceID: row.FaceID}
		if !clusterOK {
			base.Reason = "person_cluster_face_cluster_missing"
			add(base)
			continue
		}
		base.OwnerID = cluster.OwnerID
		face, faceOK := facesByID[row.FaceID]
		if !faceOK {
			base.Reason = "person_cluster_face_missing"
			add(base)
			continue
		}
		base.AssetID = face.AssetID
		asset, assetOK := assetsByID[face.AssetID]
		if !assetOK {
			base.Reason = "person_cluster_face_asset_missing"
			add(base)
			continue
		}
		if asset.OwnerID != cluster.OwnerID {
			issue := base
			issue.Reason = "person_cluster_face_owner_mismatch"
			issue.Expected = fmt.Sprintf("%d", cluster.OwnerID)
			issue.Actual = fmt.Sprintf("%d", asset.OwnerID)
			add(issue)
		}
		if row.Confidence < 0 || row.Confidence > 1 {
			issue := base
			issue.Reason = "person_cluster_face_confidence_invalid"
			issue.Actual = fmt.Sprintf("%g", row.Confidence)
			add(issue)
		}
	}

	sortMediaIntegrityIssues(issues)
	return stats, issues, nil
}
