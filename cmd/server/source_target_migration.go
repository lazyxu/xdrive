package main

import (
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var errDedicatedSourceMigrationBlocked = errors.New("Source target migration blocked")

const maxDedicatedSourceMigrationNodes = 200000

type sourceMigrationTree struct {
	nodes    map[uint64]meta.Node
	children map[uint64][]uint64
	bound    map[uint64]meta.SourceItem
	stats    map[uint64]sourceMigrationStats
}

type sourceMigrationStats struct {
	managed  bool
	ordinary bool
}

func newSourceMigrationTree() *sourceMigrationTree {
	return &sourceMigrationTree{
		nodes: make(map[uint64]meta.Node),
		children: make(map[uint64][]uint64),
		bound: make(map[uint64]meta.SourceItem),
		stats: make(map[uint64]sourceMigrationStats),
	}
}

func migrateDedicatedSourceTargets(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("database is required")
	}
	var ids []uint64
	if err := db.Model(&meta.Source{}).Where("target_node_id IS NOT NULL").
		Order("id ASC").Pluck("id", &ids).Error; err != nil {
		return err
	}
	for _, sourceID := range ids {
		err := db.Transaction(func(tx *gorm.DB) error {
			var source meta.Source
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("id = ?", sourceID).First(&source).Error; err != nil {
				return err
			}
			if source.TargetNodeID == nil {
				return nil
			}
			return migrateOneDedicatedSourceTx(tx, source)
		})
		if err == nil {
			continue
		}
		if !errors.Is(err, errDedicatedSourceMigrationBlocked) {
			return fmt.Errorf("migrate Source %d target: %w", sourceID, err)
		}
		// A bad legacy Source is quarantined, not treated as successful
		// migration and not allowed to run against an ambiguous target.
		const prefix = "同步目标自动迁移暂停："
		reason := strings.TrimPrefix(err.Error(), errDedicatedSourceMigrationBlocked.Error()+": ")
		reason = strings.ReplaceAll(reason, "\n", " ")
		reason = strings.TrimSpace(reason)
		if len(reason) > 330 {
			reason = reason[:330]
		}
		now := time.Now().UTC()
		if updateErr := db.Model(&meta.Source{}).Where("id = ?", sourceID).
			Updates(map[string]any{
				"status": meta.SourceStatusPaused,
				"run_requested_at": nil,
				"last_error": prefix + reason,
				"revision": gorm.Expr("revision + 1"),
				"updated_at": now,
			}).Error; updateErr != nil {
			return updateErr
		}
		slog.Warn("source_target_migration_quarantined",
			"source_id", sourceID, "reason", reason)
	}
	return nil
}

func sourceMigrationFail(reason string) error {
	return fmt.Errorf("%w: %s", errDedicatedSourceMigrationBlocked, reason)
}

func migrationTargetName(source meta.Source, old meta.Node) (string, error) {
	if source.Kind == "yike_photos" {
		id, ok := legacyYikeTargetAccountID(old.Name)
		if !ok {
			return "", sourceMigrationFail("Yike target lacks reliable account UID")
		}
		return migrationYikeName(id, source.Name), nil
	}
	suffix := " [s" + strconv.FormatUint(source.ID, 10) + "]"
	stem := safeMigrationName(source.Name)
	stem = shrinkMigrationName(stem, 255-len(suffix))
	result := stem + suffix
	if err := meta.ValidateName(result); err != nil {
		return "", sourceMigrationFail("invalid Source directory name")
	}
	return result, nil
}

func migrationYikeName(accountID int64, sourceName string) string {
	prefix := "uid_" + strconv.FormatInt(accountID, 10) + "_"
	return prefix + shrinkMigrationName(safeMigrationName(sourceName), 255-len(prefix))
}

func safeMigrationName(name string) string {
	var out strings.Builder
	for _, r := range strings.TrimSpace(name) {
		if r < 32 || strings.ContainsRune("/\\:*?\"<>|", r) {
			out.WriteRune('_')
		} else {
			out.WriteRune(r)
		}
	}
	value := strings.Trim(out.String(), " .")
	if value == "" {
		return "来源"
	}
	return value
}

func shrinkMigrationName(name string, maxBytes int) string {
	if maxBytes <= 0 {
		return ""
	}
	for len(name) > maxBytes {
		_, length := lastRune(name)
		name = name[:len(name)-length]
	}
	return strings.TrimRight(name, " .")
}

func lastRune(name string) (rune, int) {
	// Avoid slicing a multi-byte rune when enforcing Meta Node.Name limits.
	// Source.Name was validated as UTF-8 when the Source was created.
	runes := []rune(name)
	if len(runes) == 0 {
		return 0, 0
	}
	last := runes[len(runes)-1]
	return last, len(string(last))
}

func dedicatedMigrationParentTx(tx *gorm.DB, source meta.Source) (meta.Node, error) {
	var root meta.Node
	if err := tx.Where("owner_id = ? AND parent_id IS NULL AND type = ? AND deleted_at IS NULL",
		source.OwnerID, meta.NodeTypeDir).First(&root).Error; err != nil {
		return meta.Node{}, err
	}
	dirs := []string{"同步文件夹"}
	if source.Direction == meta.SourceDirectionPush {
		dirs = append(dirs, "设备备份")
		deviceName := "NAS"
		if source.Kind == meta.SourceKindLocalFolder {
			deviceName = "设备"
			deviceID := source.LocalCreatorDeviceID
			if deviceID == nil {
				var binding meta.LocalSourceBinding
				if err := tx.Where("source_id = ? AND owner_id = ?",
					source.ID, source.OwnerID).Take(&binding).Error; err == nil {
					deviceID = &binding.DeviceID
				}
			}
			if deviceID != nil {
				var device meta.ClientDevice
				if err := tx.Where("id = ? AND owner_id = ?", *deviceID, source.OwnerID).
					First(&device).Error; err == nil && strings.TrimSpace(device.Name) != "" {
					deviceName = device.Name
				}
			}
		}
		dirs = append(dirs, safeMigrationName(deviceName))
	} else {
		dirs = append(dirs, "远程拉取")
		kind := "其他来源"
		switch source.Kind {
		case "yike_photos":
			kind = "一刻相册"
		case "synology_photos":
			kind = "Synology Photos"
		case "synology_files":
			kind = "Synology Files"
		}
		dirs = append(dirs, kind)
	}
	current := root
	for _, name := range dirs {
		next, err := ensureMigrationDirectory(tx, source.OwnerID, current.ID, name)
		if err != nil {
			return meta.Node{}, err
		}
		current = next
	}
	return current, nil
}

func (tree *sourceMigrationTree) addSubtree(tx *gorm.DB, ownerID uint64, root meta.Node) error {
	tree.nodes[root.ID] = root
	stack := []uint64{root.ID}
	for len(stack) != 0 {
		parentID := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		var nodes []meta.Node
		if err := tx.Where("owner_id = ? AND parent_id = ? AND deleted_at IS NULL",
			ownerID, parentID).Order("id ASC").Find(&nodes).Error; err != nil {
			return err
		}
		for _, node := range nodes {
			if len(tree.nodes) >= maxDedicatedSourceMigrationNodes {
				return sourceMigrationFail("Source target tree exceeds bounded migration budget")
			}
			if _, duplicate := tree.nodes[node.ID]; duplicate {
				return sourceMigrationFail("Source directory contains a cycle")
			}
			tree.nodes[node.ID] = node
			tree.children[parentID] = append(tree.children[parentID], node.ID)
			stack = append(stack, node.ID)
		}
	}
	return nil
}

func (tree *sourceMigrationTree) relativePath(nodeID, rootID uint64) (string, error) {
	if nodeID == rootID {
		return "", nil
	}
	parts := make([]string, 0, 8)
	seen := make(map[uint64]bool)
	for current := nodeID; current != rootID; {
		n, ok := tree.nodes[current]
		if !ok || n.ParentID == nil || seen[current] {
			return "", sourceMigrationFail("SourceItem is outside the bound target")
		}
		seen[current] = true
		parts = append(parts, n.Name)
		current = *n.ParentID
	}
	for i, j := 0, len(parts)-1; i < j; i, j = i+1, j-1 {
		parts[i], parts[j] = parts[j], parts[i]
	}
	return strings.Join(parts, "/"), nil
}

func (tree *sourceMigrationTree) calculate(id uint64) sourceMigrationStats {
	node := tree.nodes[id]
	_, direct := tree.bound[id]
	stats := sourceMigrationStats{managed: direct}
	if node.Type == meta.NodeTypeFile {
		stats.ordinary = !direct
	} else {
		children := tree.children[id]
		if len(children) == 0 && !direct {
			stats.ordinary = true
		}
		for _, child := range children {
			sub := tree.calculate(child)
			stats.managed = stats.managed || sub.managed
			stats.ordinary = stats.ordinary || sub.ordinary
		}
	}
	tree.stats[id] = stats
	return stats
}

func (tree *sourceMigrationTree) validateBindings(
	tx *gorm.DB, source meta.Source, root meta.Node,
) error {
	var items []meta.SourceItem
	if err := tx.Where("source_id = ? AND node_id IS NOT NULL", source.ID).
		Find(&items).Error; err != nil {
		return err
	}
	for _, item := range items {
		id := *item.NodeID
		node, ok := tree.nodes[id]
		if !ok || node.DeletedAt != nil || node.Type != item.Kind {
			return sourceMigrationFail("SourceItem Node identity or kind is invalid")
		}
		if item.NodeRevision != 0 && item.NodeRevision != node.Revision {
			return sourceMigrationFail("SourceItem Node revision has drifted")
		}
		if _, duplicate := tree.bound[id]; duplicate {
			return sourceMigrationFail("multiple SourceItems bind the same Node")
		}
		relative, err := tree.relativePath(id, root.ID)
		if err != nil || relative != item.Path {
			return sourceMigrationFail("SourceItem path does not match the real Node tree")
		}
		tree.bound[id] = item
	}
	ids := make([]uint64, 0, len(tree.nodes))
	for id := range tree.nodes {
		ids = append(ids, id)
	}
	// Source targets must be independent. Compare all target/SourceItem
	// references using bounded batches, never an unbounded SQL IN list.
	for start := 0; start < len(ids); start += 500 {
		end := start + 500
		if end > len(ids) {
			end = len(ids)
		}
		var overlaps int64
		if err := tx.Model(&meta.SourceItem{}).Where(
			"source_id <> ? AND node_id IN ?", source.ID, ids[start:end],
		).Count(&overlaps).Error; err != nil {
			return err
		}
		if overlaps != 0 {
			return sourceMigrationFail("another SourceItem references this target subtree")
		}
	}
	return nil
}

func migrateOneDedicatedSourceTx(tx *gorm.DB, source meta.Source) error {
	if source.TargetNodeID == nil {
		return nil
	}
	var target meta.Node
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where(
		"id = ? AND owner_id = ? AND type = ? AND deleted_at IS NULL",
		*source.TargetNodeID, source.OwnerID, meta.NodeTypeDir,
	).First(&target).Error; err != nil {
		return sourceMigrationFail("current Source target is not a valid directory")
	}
	if target.ParentID == nil {
		return sourceMigrationFail("Owner file root cannot be a Source target")
	}
	var activeRuns int64
	if err := tx.Model(&meta.SyncRun{}).Where(
		"source_id = ? AND status = ?", source.ID, meta.SyncRunStatusRunning,
	).Count(&activeRuns).Error; err != nil {
		return err
	}
	if activeRuns != 0 {
		return sourceMigrationFail("Source has active or unresolved sync runs")
	}

	tree := newSourceMigrationTree()
	if err := tree.addSubtree(tx, source.OwnerID, target); err != nil {
		return err
	}
	if err := tree.validateBindings(tx, source, target); err != nil {
		return err
	}
	var otherSources []meta.Source
	if err := tx.Where("owner_id = ? AND id <> ? AND target_node_id IS NOT NULL",
		source.OwnerID, source.ID).Find(&otherSources).Error; err != nil {
		return err
	}
	for _, other := range otherSources {
		if other.TargetNodeID == nil {
			continue
		}
		if _, inside := tree.nodes[*other.TargetNodeID]; inside {
			return sourceMigrationFail("another Source target is nested inside the current target")
		}
		for current := target.ID; current != 0; {
			if current == *other.TargetNodeID {
				return sourceMigrationFail("current target is inside another Source target")
			}
			var n meta.Node
			if err := tx.Where("id = ? AND owner_id = ?", current, source.OwnerID).
				First(&n).Error; err != nil {
				return err
			}
			if n.ParentID == nil {
				break
			}
			current = *n.ParentID
		}
	}

	// Prefix categories can be shared by Sources, but a Source leaf is never
	// adopted from a user-created same-name folder with existing content.
	parent, err := dedicatedMigrationParentTx(tx, source)
	if err != nil {
		return sourceMigrationFail("canonical Source parent cannot be created")
	}
	if _, nested := tree.nodes[parent.ID]; nested {
		return sourceMigrationFail("canonical parent is inside the old target")
	}
	leaf, err := migrationTargetName(source, target)
	if err != nil {
		return err
	}
	if target.ParentID != nil && *target.ParentID == parent.ID && target.Name == leaf {
		return nil // already in the canonical location; restart is idempotent
	}
	var conflicting int64
	if err := tx.Model(&meta.Node{}).Where(
		"owner_id = ? AND parent_id = ? AND id <> ? AND deleted_at IS NULL AND lower(name) = lower(?)",
		source.OwnerID, parent.ID, target.ID, leaf,
	).Count(&conflicting).Error; err != nil {
		return err
	}
	if conflicting != 0 {
		return sourceMigrationFail("canonical Source leaf name already occupied")
	}

	stats := tree.calculate(target.ID)
	var newTargetID uint64
	if !stats.ordinary {
		// All active subtree content belongs to this Source. This is a
		// metadata-only move: every Node, FileVersion, share and CAS survives.
		if err := migrateMoveSourceNodeTx(tx, &tree.nodes[target.ID], parent.ID, leaf, tree.bound); err != nil {
			return err
		}
		newTargetID = target.ID
	} else {
		// A historical ordinary directory must keep its plain content and
		// shares. Only Source-bound files / clean Source subtrees move out.
		created := meta.Node{OwnerID: source.OwnerID, ParentID: &parent.ID,
			Name: leaf, Type: meta.NodeTypeDir, Revision: 1}
		if err := tx.Create(&created).Error; err != nil {
			return err
		}
		for _, child := range tree.children[target.ID] {
			if err := tree.migrateMixedNodeTx(tx, child, created.ID, source); err != nil {
				return err
			}
		}
		newTargetID = created.ID
	}
	now := time.Now().UTC()
	return tx.Model(&meta.Source{}).Where("id = ? AND owner_id = ? AND revision = ?",
		source.ID, source.OwnerID, source.Revision).
		Updates(map[string]any{
			"target_node_id": newTargetID,
			"revision": gorm.Expr("revision + 1"),
			"updated_at": now,
		}).Error
}

func migrateMoveSourceNodeTx(
	tx *gorm.DB, node *meta.Node, newParentID uint64, name string,
	bound map[uint64]meta.SourceItem,
) error {
	if node == nil || node.ParentID == nil {
		return sourceMigrationFail("invalid Source migration Node")
	}
	if node.ID == newParentID {
		return sourceMigrationFail("invalid Source migration cycle")
	}
	now := time.Now().UTC()
	result := tx.Model(&meta.Node{}).Where(
		"id = ? AND owner_id = ? AND revision = ? AND deleted_at IS NULL",
		node.ID, node.OwnerID, node.Revision,
	).Updates(map[string]any{
		"parent_id": newParentID, "name": name,
		"revision": gorm.Expr("revision + 1"),
		"updated_at": now,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return sourceMigrationFail("Source Node revision changed during migration")
	}
	if item, exists := bound[node.ID]; exists {
		if err := tx.Model(&meta.SourceItem{}).
			Where("id = ? AND source_id = ?", item.ID, item.SourceID).
			Update("node_revision", node.Revision+1).Error; err != nil {
			return err
		}
	}
	return nil
}

func (tree *sourceMigrationTree) migrateMixedNodeTx(
	tx *gorm.DB, id, newParent uint64, source meta.Source,
) error {
	stats := tree.stats[id]
	if !stats.managed {
		return nil // Leave ordinary content, untouched, at the old location.
	}
	node := tree.nodes[id]
	if !stats.ordinary {
		return migrateMoveSourceNodeTx(tx, &node, newParent, node.Name, tree.bound)
	}
	if node.Type != meta.NodeTypeDir {
		return sourceMigrationFail("Source file has ambiguous mixed ownership")
	}
	if _, bound := tree.bound[id]; bound {
		// A directly Source-owned directory with ordinary descendants also
		// has SourceItem/Share/Version bindings. Refuse unsafe adoption.
		return sourceMigrationFail("managed directory mixes unowned children")
	}
	var existing int64
	if err := tx.Model(&meta.Node{}).Where(
		"owner_id = ? AND parent_id = ? AND lower(name) = lower(?) AND deleted_at IS NULL",
		source.OwnerID, newParent, node.Name,
	).Count(&existing).Error; err != nil {
		return err
	}
	if existing != 0 {
		return sourceMigrationFail("migration destination name collision")
	}
	newDir := meta.Node{OwnerID: source.OwnerID, ParentID: &newParent,
		Type: meta.NodeTypeDir, Name: node.Name, Revision: 1}
	if err := tx.Create(&newDir).Error; err != nil {
		return err
	}
	for _, child := range tree.children[id] {
		if err := tree.migrateMixedNodeTx(tx, child, newDir.ID, source); err != nil {
			return err
		}
	}
	return nil
}
