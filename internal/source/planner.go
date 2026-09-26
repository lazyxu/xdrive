package source

import (
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

type PlanAction string

const (
	ActionIgnore     PlanAction = "ignore"
	ActionUnchanged  PlanAction = "unchanged"
	ActionCreate     PlanAction = "create"
	ActionUpdate     PlanAction = "update"
	ActionMove       PlanAction = "move"
	ActionMoveUpdate PlanAction = "move_update"
)

type DiscoveredItem struct {
	ExternalID     string
	Kind           string
	Path           string
	Size           int64
	ModifiedAt     *time.Time
	SHA256         string
	RemoteRevision string
}

type PlanResult struct {
	Action PlanAction
	Item   DiscoveredItem
}

type Summary struct {
	ScannedItems         int64 `json:"scanned_items"`
	ScannedBytes         int64 `json:"scanned_bytes"`
	IgnoredItems         int64 `json:"ignored_items"`
	IgnoredBytes         int64 `json:"ignored_bytes"`
	NewItems             int64 `json:"new_items"`
	NewBytes             int64 `json:"new_bytes"`
	ChangedItems         int64 `json:"changed_items"`
	ChangedBytes         int64 `json:"changed_bytes"`
	MovedItems           int64 `json:"moved_items"`
	UnchangedItems       int64 `json:"unchanged_items"`
	UnchangedBytes       int64 `json:"unchanged_bytes"`
	MissingItems         int64 `json:"missing_items"`
	MissingBytes         int64 `json:"missing_bytes"`
	PlannedTransferItems int64 `json:"planned_transfer_items"`
	PlannedTransferBytes int64 `json:"planned_transfer_bytes"`
	FailedItems          int64 `json:"failed_items"`
}

func Plan(current *meta.SourceItem, item DiscoveredItem, matcher *IgnoreMatcher) (PlanResult, error) {
	if err := ValidateDiscoveredItem(&item); err != nil {
		return PlanResult{}, err
	}
	if current != nil && current.ExternalID != item.ExternalID {
		return PlanResult{}, fmt.Errorf("source item external id mismatch")
	}
	if matcher != nil && matcher.Ignored(item.Path, item.Kind == meta.SourceItemKindDirectory) {
		return PlanResult{Action: ActionIgnore, Item: item}, nil
	}
	if current == nil || current.NodeID == nil {
		return PlanResult{Action: ActionCreate, Item: item}, nil
	}

	moved := current.Path != item.Path
	changed := sourceContentChanged(*current, item)
	switch {
	case moved && changed:
		return PlanResult{Action: ActionMoveUpdate, Item: item}, nil
	case moved:
		return PlanResult{Action: ActionMove, Item: item}, nil
	case changed:
		return PlanResult{Action: ActionUpdate, Item: item}, nil
	default:
		return PlanResult{Action: ActionUnchanged, Item: item}, nil
	}
}

func ValidateDiscoveredItem(item *DiscoveredItem) error {
	if item == nil {
		return fmt.Errorf("discovered item is required")
	}
	item.ExternalID = strings.TrimSpace(item.ExternalID)
	if item.ExternalID == "" || len([]byte(item.ExternalID)) > 512 {
		return fmt.Errorf("external id is required and must be at most 512 bytes")
	}
	if !meta.ValidSourceItemKind(item.Kind) {
		return fmt.Errorf("invalid source item kind")
	}
	clean, err := NormalizeRelativePath(item.Path)
	if err != nil {
		return err
	}
	item.Path = clean
	if item.Size < 0 {
		return fmt.Errorf("source item size must be zero or greater")
	}
	item.SHA256 = strings.ToLower(strings.TrimSpace(item.SHA256))
	if item.SHA256 != "" {
		if len(item.SHA256) != 64 {
			return fmt.Errorf("invalid sha256")
		}
		if _, err := hex.DecodeString(item.SHA256); err != nil {
			return fmt.Errorf("invalid sha256")
		}
	}
	item.RemoteRevision = strings.TrimSpace(item.RemoteRevision)
	if len([]byte(item.RemoteRevision)) > 255 {
		return fmt.Errorf("remote revision is too long")
	}
	return nil
}

func sourceContentChanged(current meta.SourceItem, next DiscoveredItem) bool {
	if current.Kind != next.Kind || current.Size != next.Size {
		return true
	}
	if current.SHA256 != "" && next.SHA256 != "" {
		return !strings.EqualFold(current.SHA256, next.SHA256)
	}
	if current.RemoteRevision != "" && next.RemoteRevision != "" {
		return current.RemoteRevision != next.RemoteRevision
	}
	return !sameOptionalTime(current.ModifiedAt, next.ModifiedAt)
}

func sameOptionalTime(a, b *time.Time) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return a.Equal(*b)
}

func (s *Summary) Add(result PlanResult) {
	s.ScannedItems++
	s.ScannedBytes += result.Item.Size
	switch result.Action {
	case ActionIgnore:
		s.IgnoredItems++
		s.IgnoredBytes += result.Item.Size
	case ActionCreate:
		s.NewItems++
		s.NewBytes += result.Item.Size
		s.addPlannedTransfer(result.Item)
	case ActionUpdate:
		s.ChangedItems++
		s.ChangedBytes += result.Item.Size
		s.addPlannedTransfer(result.Item)
	case ActionMove:
		s.MovedItems++
	case ActionMoveUpdate:
		s.MovedItems++
		s.ChangedItems++
		s.ChangedBytes += result.Item.Size
		s.addPlannedTransfer(result.Item)
	case ActionUnchanged:
		s.UnchangedItems++
		s.UnchangedBytes += result.Item.Size
	}
}

func (s *Summary) AddMissing(item meta.SourceItem) {
	s.MissingItems++
	s.MissingBytes += item.Size
}

func (s *Summary) AddFailure() {
	s.FailedItems++
}

func (s *Summary) addPlannedTransfer(item DiscoveredItem) {
	if item.Kind != meta.SourceItemKindFile {
		return
	}
	s.PlannedTransferItems++
	s.PlannedTransferBytes += item.Size
}

func (s Summary) ApplyToSyncRun(run *meta.SyncRun) {
	if run == nil {
		return
	}
	run.ScannedItems = s.ScannedItems
	run.ScannedBytes = s.ScannedBytes
	run.IgnoredItems = s.IgnoredItems
	run.IgnoredBytes = s.IgnoredBytes
	run.NewItems = s.NewItems
	run.NewBytes = s.NewBytes
	run.ChangedItems = s.ChangedItems
	run.ChangedBytes = s.ChangedBytes
	run.MovedItems = s.MovedItems
	run.UnchangedItems = s.UnchangedItems
	run.UnchangedBytes = s.UnchangedBytes
	run.MissingItems = s.MissingItems
	run.MissingBytes = s.MissingBytes
	run.PlannedTransferItems = s.PlannedTransferItems
	run.PlannedTransferBytes = s.PlannedTransferBytes
	run.SkippedItems = s.IgnoredItems + s.UnchangedItems
	run.FailedItems = s.FailedItems
}
