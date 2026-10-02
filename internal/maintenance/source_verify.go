package maintenance

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
)

type SourceBindingIssue struct {
	SourceID     uint64 `json:"source_id"`
	SourceItemID uint64 `json:"source_item_id,omitempty"`
	ExternalID   string `json:"external_id,omitempty"`
	NodeID       uint64 `json:"node_id,omitempty"`
	Reason       string `json:"reason"`
	Expected     string `json:"expected,omitempty"`
	Actual       string `json:"actual,omitempty"`
}

type SourceVerifyReport struct {
	Sources    int                  `json:"sources"`
	Items      int                  `json:"items"`
	BoundItems int                  `json:"bound_items"`
	Issues     []SourceBindingIssue `json:"issues"`
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
	return verifySourceBindings(sources, items, nodes, files), nil
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

	sort.SliceStable(report.Issues, func(i, j int) bool {
		left, right := report.Issues[i], report.Issues[j]
		if left.SourceID != right.SourceID {
			return left.SourceID < right.SourceID
		}
		if left.SourceItemID != right.SourceItemID {
			return left.SourceItemID < right.SourceItemID
		}
		if left.NodeID != right.NodeID {
			return left.NodeID < right.NodeID
		}
		return left.Reason < right.Reason
	})
	return report
}
