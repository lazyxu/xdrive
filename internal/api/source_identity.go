package api

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	sourcepkg "github.com/lazyxu/xdrive/internal/source"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const sourceItemAliasLimit = 8

type normalizedSourceObservation struct {
	item    sourcepkg.DiscoveredItem
	aliases []string
	promote bool
}

func normalizeSourceObservation(raw sourceObservationDTO) (normalizedSourceObservation, error) {
	item := sourcepkg.DiscoveredItem{
		ExternalID:     raw.ExternalID,
		Kind:           raw.Kind,
		Path:           raw.Path,
		Size:           raw.Size,
		ModifiedAt:     raw.ModifiedAt,
		SHA256:         raw.SHA256,
		RemoteRevision: raw.RemoteRevision,
	}
	if err := sourcepkg.ValidateDiscoveredItem(&item); err != nil {
		return normalizedSourceObservation{}, err
	}
	if len(raw.ExternalIDAliases) > sourceItemAliasLimit {
		return normalizedSourceObservation{}, fmt.Errorf("external_id_aliases must contain at most %d entries", sourceItemAliasLimit)
	}
	aliases := make([]string, 0, len(raw.ExternalIDAliases))
	seen := make(map[string]struct{}, len(raw.ExternalIDAliases))
	for _, rawAlias := range raw.ExternalIDAliases {
		alias, err := sourcepkg.ValidateExternalID(rawAlias)
		if err != nil {
			return normalizedSourceObservation{}, fmt.Errorf("invalid external id alias: %w", err)
		}
		if alias == item.ExternalID {
			return normalizedSourceObservation{}, fmt.Errorf("external id alias must differ from external_id")
		}
		if _, exists := seen[alias]; exists {
			return normalizedSourceObservation{}, fmt.Errorf("duplicate external id alias")
		}
		seen[alias] = struct{}{}
		aliases = append(aliases, alias)
	}
	return normalizedSourceObservation{item: item, aliases: aliases, promote: raw.PromoteExternalID}, nil
}

type sourceIdentityIndex struct {
	itemsByID map[uint64]meta.SourceItem
	canonical map[string]uint64
	aliases   map[string]uint64
}

func loadSourceIdentityIndex(tx *gorm.DB, sourceID uint64, identities []string) (*sourceIdentityIndex, error) {
	index := &sourceIdentityIndex{
		itemsByID: make(map[uint64]meta.SourceItem),
		canonical: make(map[string]uint64),
		aliases:   make(map[string]uint64),
	}
	if len(identities) == 0 {
		return index, nil
	}

	unique := make([]string, 0, len(identities))
	seen := make(map[string]struct{}, len(identities))
	for _, identity := range identities {
		if _, exists := seen[identity]; exists {
			continue
		}
		seen[identity] = struct{}{}
		unique = append(unique, identity)
	}

	var items []meta.SourceItem
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("source_id = ? AND external_id IN ?", sourceID, unique).
		Find(&items).Error; err != nil {
		return nil, err
	}
	for _, item := range items {
		index.itemsByID[item.ID] = item
		index.canonical[item.ExternalID] = item.ID
	}

	var aliasRows []meta.SourceItemAlias
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("source_id = ? AND alias_external_id IN ?", sourceID, unique).
		Find(&aliasRows).Error; err != nil {
		return nil, err
	}
	missingItemIDs := make([]uint64, 0, len(aliasRows))
	for _, alias := range aliasRows {
		index.aliases[alias.AliasExternalID] = alias.SourceItemID
		if _, exists := index.itemsByID[alias.SourceItemID]; !exists {
			missingItemIDs = append(missingItemIDs, alias.SourceItemID)
		}
	}
	if len(missingItemIDs) != 0 {
		var aliasedItems []meta.SourceItem
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("source_id = ? AND id IN ?", sourceID, missingItemIDs).
			Find(&aliasedItems).Error; err != nil {
			return nil, err
		}
		for _, item := range aliasedItems {
			index.itemsByID[item.ID] = item
			index.canonical[item.ExternalID] = item.ID
		}
	}
	for _, alias := range aliasRows {
		if _, exists := index.itemsByID[alias.SourceItemID]; !exists {
			return nil, fmt.Errorf("source item alias references missing source item")
		}
	}
	return index, nil
}

func (i *sourceIdentityIndex) resolve(externalID string, aliases []string) (meta.SourceItem, bool, error) {
	if i == nil {
		return meta.SourceItem{}, false, nil
	}
	candidates := make(map[uint64]struct{})
	add := func(identity string) {
		if id, ok := i.canonical[identity]; ok {
			candidates[id] = struct{}{}
		}
		if id, ok := i.aliases[identity]; ok {
			candidates[id] = struct{}{}
		}
	}
	add(externalID)
	for _, alias := range aliases {
		add(alias)
	}
	if len(candidates) == 0 {
		return meta.SourceItem{}, false, nil
	}
	if len(candidates) != 1 {
		return meta.SourceItem{}, false, errSourceIdentityConflict
	}
	var id uint64
	for candidate := range candidates {
		id = candidate
	}
	item, ok := i.itemsByID[id]
	if !ok {
		return meta.SourceItem{}, false, errSourceIdentityConflict
	}
	return item, true, nil
}

func (i *sourceIdentityIndex) bindAlias(
	tx *gorm.DB,
	sourceID uint64,
	item meta.SourceItem,
	alias string,
	now time.Time,
) error {
	alias = strings.TrimSpace(alias)
	if alias == "" || alias == item.ExternalID {
		return nil
	}
	if id, exists := i.canonical[alias]; exists {
		if id == item.ID {
			return nil
		}
		return errSourceIdentityConflict
	}
	if id, exists := i.aliases[alias]; exists {
		if id == item.ID {
			return nil
		}
		return errSourceIdentityConflict
	}
	row := meta.SourceItemAlias{
		SourceID:        sourceID,
		SourceItemID:    item.ID,
		AliasExternalID: alias,
		AliasKind:       meta.SourceItemAliasKindExternalID,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := tx.Create(&row).Error; err != nil {
		return err
	}
	i.aliases[alias] = item.ID
	return nil
}

func (i *sourceIdentityIndex) prepareExisting(
	tx *gorm.DB,
	sourceID uint64,
	item *meta.SourceItem,
	observedExternalID string,
	aliases []string,
	promote bool,
	now time.Time,
) error {
	if item == nil {
		return errSourceIdentityConflict
	}
	if promote && item.ExternalID != observedExternalID {
		if id, exists := i.canonical[observedExternalID]; exists && id != item.ID {
			return errSourceIdentityConflict
		}
		if id, exists := i.aliases[observedExternalID]; exists && id != item.ID {
			return errSourceIdentityConflict
		}
		oldCanonical := item.ExternalID
		if id, exists := i.aliases[observedExternalID]; exists && id == item.ID {
			if err := tx.Where("source_id = ? AND source_item_id = ? AND alias_external_id = ?",
				sourceID, item.ID, observedExternalID).Delete(&meta.SourceItemAlias{}).Error; err != nil {
				return err
			}
			delete(i.aliases, observedExternalID)
		}
		if err := tx.Model(&meta.SourceItem{}).Where("id = ? AND source_id = ?", item.ID, sourceID).
			Update("external_id", observedExternalID).Error; err != nil {
			return err
		}
		delete(i.canonical, oldCanonical)
		i.canonical[observedExternalID] = item.ID
		item.ExternalID = observedExternalID
		i.itemsByID[item.ID] = *item
		if err := i.bindAlias(tx, sourceID, *item, oldCanonical, now); err != nil {
			return err
		}
	} else if item.ExternalID != observedExternalID {
		if err := i.bindAlias(tx, sourceID, *item, observedExternalID, now); err != nil {
			return err
		}
	}
	for _, alias := range aliases {
		if err := i.bindAlias(tx, sourceID, *item, alias, now); err != nil {
			return err
		}
	}
	return nil
}

func (i *sourceIdentityIndex) registerCreated(
	tx *gorm.DB,
	sourceID uint64,
	externalID string,
	aliases []string,
	now time.Time,
) error {
	var item meta.SourceItem
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("source_id = ? AND external_id = ?", sourceID, externalID).
		First(&item).Error; err != nil {
		return err
	}
	i.itemsByID[item.ID] = item
	i.canonical[item.ExternalID] = item.ID
	for _, alias := range aliases {
		if err := i.bindAlias(tx, sourceID, item, alias, now); err != nil {
			return err
		}
	}
	return nil
}

func findSourceItemByIdentity(tx *gorm.DB, sourceID uint64, externalID string) (meta.SourceItem, error) {
	var item meta.SourceItem
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("source_id = ? AND external_id = ?", sourceID, externalID).
		First(&item).Error
	if err == nil {
		return item, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return meta.SourceItem{}, err
	}
	var alias meta.SourceItemAlias
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("source_id = ? AND alias_external_id = ?", sourceID, externalID).
		First(&alias).Error; err != nil {
		return meta.SourceItem{}, err
	}
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("source_id = ? AND id = ?", sourceID, alias.SourceItemID).
		First(&item).Error; err != nil {
		return meta.SourceItem{}, err
	}
	return item, nil
}
