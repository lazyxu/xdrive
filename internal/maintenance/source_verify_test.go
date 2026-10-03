package maintenance

import (
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestVerifySourceBindingsAcceptsHealthyBinding(t *testing.T) {
	targetID := uint64(100)
	nodeID := uint64(101)
	hash := strings.Repeat("a", 64)
	report := verifySourceBindings(
		[]meta.Source{{
			ID: 1, OwnerID: 7, Status: meta.SourceStatusActive, TargetNodeID: &targetID,
		}},
		[]meta.SourceItem{{
			ID: 10, SourceID: 1, ExternalID: "remote:1", NodeID: &nodeID,
			Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced, Size: 12, SHA256: hash,
		}},
		[]meta.Node{
			{ID: targetID, OwnerID: 7, Type: meta.NodeTypeDir},
			{ID: nodeID, OwnerID: 7, Type: meta.NodeTypeFile},
		},
		[]meta.File{{NodeID: nodeID, Size: 12, SHA256: hash}},
	)
	if !report.OK() || report.BoundItems != 1 {
		t.Fatalf("healthy source bindings reported issues: %+v", report)
	}
}

func TestVerifySourceBindingsReportsDeterministicBreakage(t *testing.T) {
	targetID := uint64(100)
	wrongTargetID := uint64(101)
	dirAsFileID := uint64(102)
	missingFileID := uint64(103)
	sizeID := uint64(104)
	hashID := uint64(105)
	foreignID := uint64(106)
	dirWithFileID := uint64(107)
	deletedID := uint64(108)
	deletedAt := time.Now().UTC()
	hashA := strings.Repeat("a", 64)
	hashB := strings.Repeat("b", 64)

	sources := []meta.Source{
		{ID: 1, OwnerID: 7, Status: meta.SourceStatusActive, TargetNodeID: &targetID},
		{ID: 2, OwnerID: 7, Status: meta.SourceStatusActive},
		{ID: 3, OwnerID: 7, Status: meta.SourceStatusActive, TargetNodeID: &wrongTargetID},
	}
	items := []meta.SourceItem{
		{ID: 20, SourceID: 1, ExternalID: "no-node", Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced},
		{ID: 21, SourceID: 1, ExternalID: "wrong-type", NodeID: &dirAsFileID, Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced},
		{ID: 22, SourceID: 1, ExternalID: "no-file", NodeID: &missingFileID, Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced},
		{ID: 23, SourceID: 1, ExternalID: "size", NodeID: &sizeID, Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced, Size: 10},
		{ID: 24, SourceID: 1, ExternalID: "hash", NodeID: &hashID, Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced, Size: 10, SHA256: hashA},
		{ID: 25, SourceID: 1, ExternalID: "foreign", NodeID: &foreignID, Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced, Size: 10},
		{ID: 26, SourceID: 1, ExternalID: "dir-file", NodeID: &dirWithFileID, Kind: meta.SourceItemKindDirectory, State: meta.SourceItemStateSynced},
		{ID: 27, SourceID: 1, ExternalID: "deleted", NodeID: &deletedID, Kind: meta.SourceItemKindFile, State: meta.SourceItemStateSynced, Size: 10},
	}
	nodes := []meta.Node{
		{ID: targetID, OwnerID: 7, Type: meta.NodeTypeDir},
		{ID: wrongTargetID, OwnerID: 7, Type: meta.NodeTypeFile},
		{ID: dirAsFileID, OwnerID: 7, Type: meta.NodeTypeDir},
		{ID: missingFileID, OwnerID: 7, Type: meta.NodeTypeFile},
		{ID: sizeID, OwnerID: 7, Type: meta.NodeTypeFile},
		{ID: hashID, OwnerID: 7, Type: meta.NodeTypeFile},
		{ID: foreignID, OwnerID: 8, Type: meta.NodeTypeFile},
		{ID: dirWithFileID, OwnerID: 7, Type: meta.NodeTypeDir},
		{ID: deletedID, OwnerID: 7, Type: meta.NodeTypeFile, DeletedAt: &deletedAt},
	}
	files := []meta.File{
		{NodeID: sizeID, Size: 11},
		{NodeID: hashID, Size: 10, SHA256: hashB},
		{NodeID: foreignID, Size: 10},
		{NodeID: dirWithFileID, Size: 0},
		{NodeID: deletedID, Size: 10},
	}

	report := verifySourceBindings(sources, items, nodes, files)
	if report.OK() {
		t.Fatalf("broken source bindings reported OK: %+v", report)
	}
	reasons := map[string]bool{}
	for _, issue := range report.Issues {
		reasons[issue.Reason] = true
	}
	for _, want := range []string{
		"active_target_missing",
		"target_type_mismatch",
		"synced_without_node",
		"node_type_mismatch",
		"file_metadata_missing",
		"file_size_mismatch",
		"file_sha256_mismatch",
		"node_owner_mismatch",
		"directory_has_file_metadata",
		"node_deleted",
	} {
		if !reasons[want] {
			t.Fatalf("missing issue reason %q: %+v", want, report.Issues)
		}
	}
}

func TestSourceVerifyIDBatchesStayBounded(t *testing.T) {
	ids := make([]uint64, sourceVerifyQueryBatchSize*2+17)
	for i := range ids {
		ids[i] = uint64(i + 1)
	}
	batches := 0
	seen := 0
	if err := forSourceVerifyIDBatches(ids, func(batch []uint64) error {
		batches++
		if len(batch) == 0 || len(batch) > sourceVerifyQueryBatchSize {
			t.Fatalf("batch size=%d", len(batch))
		}
		for i, id := range batch {
			want := uint64(seen + i + 1)
			if id != want {
				t.Fatalf("id=%d want=%d", id, want)
			}
		}
		seen += len(batch)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if batches != 3 {
		t.Fatalf("batches=%d want=3", batches)
	}
	if seen != len(ids) {
		t.Fatalf("seen=%d want=%d", seen, len(ids))
	}
}

func TestVerifySourceRelationsReportsDeterministicBreakage(t *testing.T) {
	sources := []meta.Source{
		{ID: 1, OwnerID: 7, Status: meta.SourceStatusPaused},
		{ID: 2, OwnerID: 7, Status: meta.SourceStatusPaused},
	}
	items := []meta.SourceItem{
		{ID: 10, SourceID: 1, ExternalID: "canon-a", Kind: meta.SourceItemKindFile, State: meta.SourceItemStatePending},
		{ID: 11, SourceID: 1, ExternalID: "canon-b", Kind: meta.SourceItemKindFile, State: meta.SourceItemStatePending},
		{ID: 20, SourceID: 2, ExternalID: "canon-x", Kind: meta.SourceItemKindFile, State: meta.SourceItemStatePending},
	}
	aliases := []meta.SourceItemAlias{
		{ID: 1, SourceID: 1, SourceItemID: 10, AliasExternalID: "canon-a", AliasKind: meta.SourceItemAliasKindExternalID},
		{ID: 2, SourceID: 1, SourceItemID: 10, AliasExternalID: "canon-b", AliasKind: meta.SourceItemAliasKindExternalID},
		{ID: 3, SourceID: 1, SourceItemID: 20, AliasExternalID: "cross-source", AliasKind: meta.SourceItemAliasKindExternalID},
		{ID: 4, SourceID: 1, SourceItemID: 10, AliasExternalID: "legacy-a", AliasKind: "invalid"},
	}
	collections := []meta.SourceCollection{
		{ID: 100, SourceID: 1, ExternalID: "album-a", State: meta.SourceCollectionStateActive},
		{ID: 101, SourceID: 1, ExternalID: "album-old", State: meta.SourceCollectionStateMissing},
	}
	collectionItems := []meta.SourceCollectionItem{
		{ID: 1000, CollectionID: 100, SourceItemID: 20, Position: 0},
		{ID: 1001, CollectionID: 101, SourceItemID: 10, Position: 0},
		{ID: 1002, CollectionID: 100, SourceItemID: 10, Position: -1},
		{ID: 1003, CollectionID: 999, SourceItemID: 10, Position: 0},
	}
	itemMetadata := []meta.SourceItemMetadata{
		{SourceItemID: 20, SourceID: 1, ContentMD5: "not-md5"},
	}

	report := verifySourceState(
		sources,
		items,
		aliases,
		collections,
		collectionItems,
		itemMetadata,
		nil,
		nil,
	)
	if report.OK() {
		t.Fatalf("broken source relations reported OK: %+v", report)
	}
	reasons := map[string]bool{}
	for _, issue := range report.Issues {
		reasons[issue.Reason] = true
	}
	for _, want := range []string{
		"alias_matches_canonical",
		"alias_canonical_conflict",
		"alias_item_source_mismatch",
		"alias_kind_invalid",
		"collection_item_source_mismatch",
		"missing_collection_has_membership",
		"collection_item_position_invalid",
		"collection_item_collection_missing",
		"metadata_source_mismatch",
		"metadata_md5_invalid",
	} {
		if !reasons[want] {
			t.Fatalf("missing issue reason %q: %+v", want, report.Issues)
		}
	}
}
