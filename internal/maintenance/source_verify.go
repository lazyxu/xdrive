package maintenance

import (
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"gorm.io/gorm"
)

type SourceBindingIssue struct {
	SourceID     uint64 `json:"source_id"`
	SourceItemID uint64 `json:"source_item_id,omitempty"`
	RunID        string `json:"run_id,omitempty"`
	ExternalID   string `json:"external_id,omitempty"`
	NodeID       uint64 `json:"node_id,omitempty"`
	Reason       string `json:"reason"`
	Expected     string `json:"expected,omitempty"`
	Actual       string `json:"actual,omitempty"`
}

type SourceVerifyReport struct {
	Sources     int                  `json:"sources"`
	Items       int                  `json:"items"`
	BoundItems  int                  `json:"bound_items"`
	RunningRuns int                  `json:"running_runs"`
	Issues      []SourceBindingIssue `json:"issues"`
}

const sourceVerifyQueryBatchSize = 1000

func (r SourceVerifyReport) OK() bool {
	return len(r.Issues) == 0
}

// VerifySources checks deterministic Source -> SourceItem -> Node/File binding
// invariants. It is deliberately read-only: repair belongs in a separate,
// explicit workflow after each issue type has a proven idempotent action.
func VerifySources(db *gorm.DB) (SourceVerifyReport, error) {
	var report SourceVerifyReport
	if db == nil {
		return report, fmt.Errorf("source verify database is unavailable")
	}

	var sources []meta.Source
	if err := db.Order("id ASC").Find(&sources).Error; err != nil {
		return report, fmt.Errorf("query sources: %w", err)
	}
	var items []meta.SourceItem
	if err := db.Order("source_id ASC, id ASC").Find(&items).Error; err != nil {
		return report, fmt.Errorf("query source items: %w", err)
	}
	var aliases []meta.SourceItemAlias
	if err := db.Order("source_id ASC, id ASC").Find(&aliases).Error; err != nil {
		return report, fmt.Errorf("query source item aliases: %w", err)
	}
	var collections []meta.SourceCollection
	if err := db.Order("source_id ASC, id ASC").Find(&collections).Error; err != nil {
		return report, fmt.Errorf("query source collections: %w", err)
	}
	var collectionItems []meta.SourceCollectionItem
	if err := db.Order("collection_id ASC, id ASC").Find(&collectionItems).Error; err != nil {
		return report, fmt.Errorf("query source collection items: %w", err)
	}
	var itemMetadata []meta.SourceItemMetadata
	if err := db.Order("source_id ASC, source_item_id ASC").Find(&itemMetadata).Error; err != nil {
		return report, fmt.Errorf("query source item metadata: %w", err)
	}
	var runningRuns []meta.SyncRun
	if err := db.Where("status = ?", meta.SyncRunStatusRunning).
		Order("source_id ASC, started_at ASC, id ASC").
		Find(&runningRuns).Error; err != nil {
		return report, fmt.Errorf("query running source runs: %w", err)
	}

	nodeIDs := make(map[uint64]struct{})
	for _, source := range sources {
		if source.TargetNodeID != nil && *source.TargetNodeID != 0 {
			nodeIDs[*source.TargetNodeID] = struct{}{}
		}
	}
	for _, item := range items {
		if item.NodeID != nil && *item.NodeID != 0 {
			nodeIDs[*item.NodeID] = struct{}{}
		}
	}

	ids := make([]uint64, 0, len(nodeIDs))
	for id := range nodeIDs {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })

	var nodes []meta.Node
	var files []meta.File
	if err := forSourceVerifyIDBatches(ids, func(batch []uint64) error {
		var batchNodes []meta.Node
		if err := db.Where("id IN ?", batch).Find(&batchNodes).Error; err != nil {
			return fmt.Errorf("query source-bound nodes: %w", err)
		}
		nodes = append(nodes, batchNodes...)

		var batchFiles []meta.File
		if err := db.Where("node_id IN ?", batch).Find(&batchFiles).Error; err != nil {
			return fmt.Errorf("query source-bound files: %w", err)
		}
		files = append(files, batchFiles...)
		return nil
	}); err != nil {
		return report, err
	}
	report = verifySourceState(
		sources,
		items,
		aliases,
		collections,
		collectionItems,
		itemMetadata,
		nodes,
		files,
	)
	verifySourceRuns(&report, runningRuns, time.Now().UTC())
	sortSourceBindingIssues(report.Issues)
	return report, nil
}

func forSourceVerifyIDBatches(ids []uint64, fn func([]uint64) error) error {
	for start := 0; start < len(ids); start += sourceVerifyQueryBatchSize {
		end := start + sourceVerifyQueryBatchSize
		if end > len(ids) {
			end = len(ids)
		}
		if err := fn(ids[start:end]); err != nil {
			return err
		}
	}
	return nil
}

func verifySourceBindings(
	sources []meta.Source,
	items []meta.SourceItem,
	nodes []meta.Node,
	files []meta.File,
) SourceVerifyReport {
	report := SourceVerifyReport{Sources: len(sources), Items: len(items)}
	sourceByID := make(map[uint64]meta.Source, len(sources))
	for _, source := range sources {
		sourceByID[source.ID] = source
	}
	nodeByID := make(map[uint64]meta.Node, len(nodes))
	for _, node := range nodes {
		nodeByID[node.ID] = node
	}
	fileByNodeID := make(map[uint64]meta.File, len(files))
	for _, file := range files {
		fileByNodeID[file.NodeID] = file
	}

	add := func(issue SourceBindingIssue) {
		report.Issues = append(report.Issues, issue)
	}

	for _, source := range sources {
		if source.Status != meta.SourceStatusActive {
			continue
		}
		if source.TargetNodeID == nil || *source.TargetNodeID == 0 {
			add(SourceBindingIssue{SourceID: source.ID, Reason: "active_target_missing"})
			continue
		}
		targetID := *source.TargetNodeID
		target, ok := nodeByID[targetID]
		if !ok {
			add(SourceBindingIssue{SourceID: source.ID, NodeID: targetID, Reason: "target_node_missing"})
			continue
		}
		if target.OwnerID != source.OwnerID {
			add(SourceBindingIssue{
				SourceID: source.ID, NodeID: targetID, Reason: "target_owner_mismatch",
				Expected: strconv.FormatUint(source.OwnerID, 10), Actual: strconv.FormatUint(target.OwnerID, 10),
			})
		}
		if target.DeletedAt != nil {
			add(SourceBindingIssue{SourceID: source.ID, NodeID: targetID, Reason: "target_deleted"})
		}
		if target.Type != meta.NodeTypeDir {
			add(SourceBindingIssue{
				SourceID: source.ID, NodeID: targetID, Reason: "target_type_mismatch",
				Expected: meta.NodeTypeDir, Actual: target.Type,
			})
		}
	}

	for _, item := range items {
		source, sourceExists := sourceByID[item.SourceID]
		if !sourceExists {
			add(SourceBindingIssue{
				SourceID: item.SourceID, SourceItemID: item.ID, ExternalID: item.ExternalID,
				Reason: "source_missing",
			})
			continue
		}
		if item.NodeID == nil || *item.NodeID == 0 {
			if item.State == meta.SourceItemStateSynced {
				add(SourceBindingIssue{
					SourceID: source.ID, SourceItemID: item.ID, ExternalID: item.ExternalID,
					Reason: "synced_without_node",
				})
			}
			continue
		}
		report.BoundItems++
		nodeID := *item.NodeID
		node, ok := nodeByID[nodeID]
		base := SourceBindingIssue{
			SourceID: source.ID, SourceItemID: item.ID, ExternalID: item.ExternalID, NodeID: nodeID,
		}
		if !ok {
			base.Reason = "bound_node_missing"
			add(base)
			continue
		}
		if node.OwnerID != source.OwnerID {
			issue := base
			issue.Reason = "node_owner_mismatch"
			issue.Expected = strconv.FormatUint(source.OwnerID, 10)
			issue.Actual = strconv.FormatUint(node.OwnerID, 10)
			add(issue)
		}
		if node.DeletedAt != nil {
			issue := base
			issue.Reason = "node_deleted"
			add(issue)
		}
		expectedType := meta.NodeTypeFile
		if item.Kind == meta.SourceItemKindDirectory {
			expectedType = meta.NodeTypeDir
		}
		if node.Type != expectedType {
			issue := base
			issue.Reason = "node_type_mismatch"
			issue.Expected = expectedType
			issue.Actual = node.Type
			add(issue)
			continue
		}

		file, hasFile := fileByNodeID[nodeID]
		if item.Kind == meta.SourceItemKindDirectory {
			if hasFile {
				issue := base
				issue.Reason = "directory_has_file_metadata"
				add(issue)
			}
			continue
		}
		if !hasFile {
			issue := base
			issue.Reason = "file_metadata_missing"
			add(issue)
			continue
		}
		if file.Size != item.Size {
			issue := base
			issue.Reason = "file_size_mismatch"
			issue.Expected = strconv.FormatInt(item.Size, 10)
			issue.Actual = strconv.FormatInt(file.Size, 10)
			add(issue)
		}
		if expected := strings.ToLower(strings.TrimSpace(item.SHA256)); expected != "" {
			actual := strings.ToLower(strings.TrimSpace(file.SHA256))
			if actual != expected {
				issue := base
				issue.Reason = "file_sha256_mismatch"
				issue.Expected = expected
				issue.Actual = actual
				add(issue)
			}
		}
	}

	sortSourceBindingIssues(report.Issues)
	return report
}

func verifySourceState(
	sources []meta.Source,
	items []meta.SourceItem,
	aliases []meta.SourceItemAlias,
	collections []meta.SourceCollection,
	collectionItems []meta.SourceCollectionItem,
	itemMetadata []meta.SourceItemMetadata,
	nodes []meta.Node,
	files []meta.File,
) SourceVerifyReport {
	report := verifySourceBindings(sources, items, nodes, files)
	verifySourceRelations(
		&report,
		sources,
		items,
		aliases,
		collections,
		collectionItems,
		itemMetadata,
	)
	sortSourceBindingIssues(report.Issues)
	return report
}

func verifySourceRelations(
	report *SourceVerifyReport,
	sources []meta.Source,
	items []meta.SourceItem,
	aliases []meta.SourceItemAlias,
	collections []meta.SourceCollection,
	collectionItems []meta.SourceCollectionItem,
	itemMetadata []meta.SourceItemMetadata,
) {
	if report == nil {
		return
	}
	add := func(issue SourceBindingIssue) {
		report.Issues = append(report.Issues, issue)
	}

	sourceByID := make(map[uint64]meta.Source, len(sources))
	for _, row := range sources {
		sourceByID[row.ID] = row
	}
	itemByID := make(map[uint64]meta.SourceItem, len(items))
	canonicalBySource := make(map[uint64]map[string]uint64)
	for _, item := range items {
		itemByID[item.ID] = item
		identity := strings.TrimSpace(item.ExternalID)
		if identity == "" || identity != item.ExternalID || len([]byte(identity)) > 512 {
			add(SourceBindingIssue{
				SourceID: item.SourceID, SourceItemID: item.ID, ExternalID: item.ExternalID,
				Reason: "external_id_invalid",
			})
		}
		if !meta.ValidSourceItemKind(item.Kind) {
			add(SourceBindingIssue{
				SourceID: item.SourceID, SourceItemID: item.ID, ExternalID: item.ExternalID,
				Reason: "item_kind_invalid", Actual: item.Kind,
			})
		}
		if !meta.ValidSourceItemState(item.State) {
			add(SourceBindingIssue{
				SourceID: item.SourceID, SourceItemID: item.ID, ExternalID: item.ExternalID,
				Reason: "item_state_invalid", Actual: item.State,
			})
		}
		if item.Size < 0 {
			add(SourceBindingIssue{
				SourceID: item.SourceID, SourceItemID: item.ID, ExternalID: item.ExternalID,
				Reason: "item_size_invalid", Expected: ">=0", Actual: strconv.FormatInt(item.Size, 10),
			})
		}
		if canonicalBySource[item.SourceID] == nil {
			canonicalBySource[item.SourceID] = make(map[string]uint64)
		}
		if identity != "" {
			if existing, duplicate := canonicalBySource[item.SourceID][identity]; duplicate && existing != item.ID {
				add(SourceBindingIssue{
					SourceID: item.SourceID, SourceItemID: item.ID, ExternalID: identity,
					Reason: "external_id_duplicate", Expected: strconv.FormatUint(existing, 10),
					Actual: strconv.FormatUint(item.ID, 10),
				})
			} else {
				canonicalBySource[item.SourceID][identity] = item.ID
			}
		}
	}

	aliasesBySource := make(map[uint64]map[string]uint64)
	for _, alias := range aliases {
		base := SourceBindingIssue{
			SourceID: alias.SourceID, SourceItemID: alias.SourceItemID,
			ExternalID: alias.AliasExternalID,
		}
		if _, ok := sourceByID[alias.SourceID]; !ok {
			issue := base
			issue.Reason = "alias_source_missing"
			add(issue)
		}
		item, itemOK := itemByID[alias.SourceItemID]
		if !itemOK {
			issue := base
			issue.Reason = "alias_item_missing"
			add(issue)
		} else if item.SourceID != alias.SourceID {
			issue := base
			issue.Reason = "alias_item_source_mismatch"
			issue.Expected = strconv.FormatUint(item.SourceID, 10)
			issue.Actual = strconv.FormatUint(alias.SourceID, 10)
			add(issue)
		}
		if alias.AliasKind != meta.SourceItemAliasKindExternalID {
			issue := base
			issue.Reason = "alias_kind_invalid"
			issue.Expected = meta.SourceItemAliasKindExternalID
			issue.Actual = alias.AliasKind
			add(issue)
		}
		identity := strings.TrimSpace(alias.AliasExternalID)
		if identity == "" || identity != alias.AliasExternalID || len([]byte(identity)) > 512 {
			issue := base
			issue.Reason = "alias_external_id_invalid"
			add(issue)
		}
		if aliasesBySource[alias.SourceID] == nil {
			aliasesBySource[alias.SourceID] = make(map[string]uint64)
		}
		if identity != "" {
			if previous, duplicate := aliasesBySource[alias.SourceID][identity]; duplicate &&
				previous != alias.SourceItemID {
				issue := base
				issue.Reason = "alias_duplicate"
				issue.Expected = strconv.FormatUint(previous, 10)
				issue.Actual = strconv.FormatUint(alias.SourceItemID, 10)
				add(issue)
			} else {
				aliasesBySource[alias.SourceID][identity] = alias.SourceItemID
			}
			if canonicalID, exists := canonicalBySource[alias.SourceID][identity]; exists {
				issue := base
				if canonicalID == alias.SourceItemID {
					issue.Reason = "alias_matches_canonical"
				} else {
					issue.Reason = "alias_canonical_conflict"
					issue.Expected = strconv.FormatUint(canonicalID, 10)
					issue.Actual = strconv.FormatUint(alias.SourceItemID, 10)
				}
				add(issue)
			}
		}
	}

	collectionByID := make(map[uint64]meta.SourceCollection, len(collections))
	for _, collection := range collections {
		collectionByID[collection.ID] = collection
		base := SourceBindingIssue{SourceID: collection.SourceID, ExternalID: collection.ExternalID}
		if _, ok := sourceByID[collection.SourceID]; !ok {
			issue := base
			issue.Reason = "collection_source_missing"
			add(issue)
		}
		if !meta.ValidSourceCollectionState(collection.State) {
			issue := base
			issue.Reason = "collection_state_invalid"
			issue.Actual = collection.State
			add(issue)
		}
		identity := strings.TrimSpace(collection.ExternalID)
		if identity == "" || identity != collection.ExternalID || len([]byte(identity)) > 512 {
			issue := base
			issue.Reason = "collection_external_id_invalid"
			add(issue)
		}
	}
	for _, membership := range collectionItems {
		collection, collectionOK := collectionByID[membership.CollectionID]
		sourceID := uint64(0)
		externalID := fmt.Sprintf("collection:%d", membership.CollectionID)
		if collectionOK {
			sourceID = collection.SourceID
			externalID = collection.ExternalID
		}
		base := SourceBindingIssue{
			SourceID: sourceID, SourceItemID: membership.SourceItemID, ExternalID: externalID,
		}
		if !collectionOK {
			issue := base
			issue.Reason = "collection_item_collection_missing"
			add(issue)
		}
		item, itemOK := itemByID[membership.SourceItemID]
		if !itemOK {
			issue := base
			issue.Reason = "collection_item_source_item_missing"
			add(issue)
		} else if collectionOK && item.SourceID != collection.SourceID {
			issue := base
			issue.Reason = "collection_item_source_mismatch"
			issue.Expected = strconv.FormatUint(collection.SourceID, 10)
			issue.Actual = strconv.FormatUint(item.SourceID, 10)
			add(issue)
		}
		if collectionOK && collection.State == meta.SourceCollectionStateMissing {
			issue := base
			issue.Reason = "missing_collection_has_membership"
			add(issue)
		}
		if membership.Position < 0 {
			issue := base
			issue.Reason = "collection_item_position_invalid"
			issue.Expected = ">=0"
			issue.Actual = strconv.FormatInt(membership.Position, 10)
			add(issue)
		}
	}

	for _, metadata := range itemMetadata {
		base := SourceBindingIssue{
			SourceID: metadata.SourceID, SourceItemID: metadata.SourceItemID,
		}
		if _, ok := sourceByID[metadata.SourceID]; !ok {
			issue := base
			issue.Reason = "metadata_source_missing"
			add(issue)
		}
		item, itemOK := itemByID[metadata.SourceItemID]
		if !itemOK {
			issue := base
			issue.Reason = "metadata_source_item_missing"
			add(issue)
		} else {
			base.ExternalID = item.ExternalID
			if item.SourceID != metadata.SourceID {
				issue := base
				issue.Reason = "metadata_source_mismatch"
				issue.Expected = strconv.FormatUint(item.SourceID, 10)
				issue.Actual = strconv.FormatUint(metadata.SourceID, 10)
				add(issue)
			}
		}
		md5 := strings.ToLower(strings.TrimSpace(metadata.ContentMD5))
		if md5 != "" {
			if len(md5) != 32 {
				issue := base
				issue.Reason = "metadata_md5_invalid"
				issue.Actual = metadata.ContentMD5
				add(issue)
			} else if _, err := hex.DecodeString(md5); err != nil {
				issue := base
				issue.Reason = "metadata_md5_invalid"
				issue.Actual = metadata.ContentMD5
				add(issue)
			}
		}
	}
}

func verifySourceRuns(
	report *SourceVerifyReport,
	runs []meta.SyncRun,
	now time.Time,
) {
	if report == nil {
		return
	}
	report.RunningRuns = len(runs)
	for _, run := range runs {
		if !sourcepkg.SyncRunStale(run, now) {
			continue
		}
		heartbeat := sourcepkg.SyncRunHeartbeatAt(run)
		actual := ""
		if !heartbeat.IsZero() {
			actual = heartbeat.UTC().Format(time.RFC3339Nano)
		}
		report.Issues = append(report.Issues, SourceBindingIssue{
			SourceID: run.SourceID,
			RunID:    run.ID,
			Reason:   "stale_running_run",
			Expected: "heartbeat within " + sourcepkg.SyncRunStaleAfter.String(),
			Actual:   actual,
		})
	}
}

func sortSourceBindingIssues(issues []SourceBindingIssue) {
	sort.SliceStable(issues, func(i, j int) bool {
		left, right := issues[i], issues[j]
		if left.SourceID != right.SourceID {
			return left.SourceID < right.SourceID
		}
		if left.SourceItemID != right.SourceItemID {
			return left.SourceItemID < right.SourceItemID
		}
		if left.RunID != right.RunID {
			return left.RunID < right.RunID
		}
		if left.ExternalID != right.ExternalID {
			return left.ExternalID < right.ExternalID
		}
		if left.NodeID != right.NodeID {
			return left.NodeID < right.NodeID
		}
		return left.Reason < right.Reason
	})
}
