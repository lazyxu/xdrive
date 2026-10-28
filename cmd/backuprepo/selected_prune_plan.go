package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
)

// A source-owned preview for selecting exactly one committed v2 generation.
// It never grants deletion rights, takes a destructive lock, or mutates a
// repository; the later operation must perform its own exclusive deep audit.
type selectedPrunePlan struct {
	Protocol              string `json:"protocol"`
	Mode                  string `json:"mode"`
	Validation            string `json:"validation"`
	Snapshot              string `json:"snapshot"`
	CommittedSnapshots    int    `json:"committed_snapshots"`
	SurvivingSnapshots    int    `json:"surviving_snapshots"`
	SelectedSnapshotBytes int64  `json:"selected_snapshot_bytes"`
	SelectedCASObjects    int    `json:"selected_cas_objects"`
	SharedCASObjects      int    `json:"shared_cas_objects"`
	ExclusiveCASObjects   int    `json:"exclusive_cas_objects"`
	ExclusiveCASBytes     int64  `json:"exclusive_cas_bytes"`
	UnreferencedObjects   int    `json:"unreferenced_objects"`
	UnreferencedBytes     int64  `json:"unreferenced_bytes"`
	PotentialLogicalBytes int64  `json:"potential_logical_bytes"`
	HashedObjects         int    `json:"hashed_objects"`
	HashedBytes           int64  `json:"hashed_bytes"`
	DeleteEnabled         bool   `json:"delete_enabled"`
}

func planSelectedPrune(repo, snapshot, casMode string) (selectedPrunePlan, error) {
	result := selectedPrunePlan{
		Protocol:      "xdrive-backup-selected-prune-plan-v1",
		Mode:          "read_only",
		Snapshot:      snapshot,
		DeleteEnabled: false,
	}
	if !canonicalPruneSnapshotName(snapshot) {
		return result, errors.New("preview requires a canonical committed v2 generation name")
	}
	if casMode != "fast" && casMode != "deep" {
		return result, errors.New("preview requires fast or deep mode")
	}
	// The shared preview validates checksums and CAS size/content across ALL
	// committed generations, not just the selected one. For an explicit deep
	// audit the Host wrapper also holds a shared repository writer lease.
	plan, err := planRetentionWithMode(repo, 1, casMode)
	if err != nil {
		return result, err
	}
	if plan.CommittedSnapshots < 2 {
		return result, errors.New("selected deletion preview requires a surviving recovery point")
	}
	pending, err := pendingPruneTransactions(filepath.Join(repo, pruneRetiredDirName))
	if err != nil {
		return result, err
	}
	if len(pending) != 0 {
		return result, errors.New("pending prune transactions require an explicit operator recovery before new preview")
	}
	allSnapshots := append(append([]string{}, plan.DropCandidates...), plan.KeepSnapshots...)
	retained := make([]string, 0, len(allSnapshots)-1)
	found := false
	for _, name := range allSnapshots {
		if name == snapshot {
			found = true
			continue
		}
		retained = append(retained, name)
	}
	if !found {
		return result, errors.New("selected snapshot not committed in repository")
	}
	// An intact SHA256SUMS does not establish that the restored tar is safe to
	// expand. Refuse to describe a deletion as eligible when survivor archives
	// cannot follow the same read-only restore path/type restrictions as prune.
	if err := validatePruneRetainedArchives(repo, retained); err != nil {
		return result, err
	}
	referencedElsewhere := make(map[string]bool)
	for _, name := range retained {
		if err := readIndex(filepath.Join(repo, "snapshots", name), func(e entry) error {
			referencedElsewhere[e.hash] = true
			return nil
		}); err != nil {
			return result, fmt.Errorf("retained v2 index invalid: %w", err)
		}
	}
	selectedObjects := make(map[string]int64)
	if err := readIndex(filepath.Join(repo, "snapshots", snapshot), func(e entry) error {
		if previous, exists := selectedObjects[e.hash]; exists && previous != e.size {
			return errors.New("inconsistent selected CAS object size")
		}
		selectedObjects[e.hash] = e.size
		return nil
	}); err != nil {
		return result, fmt.Errorf("selected v2 index invalid: %w", err)
	}
	selectedBytes, err := validateCommittedSnapshot(filepath.Join(repo, "snapshots", snapshot))
	if err != nil {
		return result, err
	}
	result.Validation = plan.Validation
	result.CommittedSnapshots = plan.CommittedSnapshots
	result.SurvivingSnapshots = len(retained)
	result.SelectedSnapshotBytes = selectedBytes
	result.SelectedCASObjects = len(selectedObjects)
	result.UnreferencedObjects = plan.UnreferencedObjects
	result.UnreferencedBytes = plan.UnreferencedBytes
	result.HashedObjects = plan.HashedObjects
	result.HashedBytes = plan.HashedBytes
	for hash, size := range selectedObjects {
		if referencedElsewhere[hash] {
			result.SharedCASObjects++
		} else {
			result.ExclusiveCASObjects++
			if err := addPlanBytes(&result.ExclusiveCASBytes, size); err != nil {
				return result, err
			}
		}
	}
	for _, amount := range []int64{selectedBytes, result.ExclusiveCASBytes, plan.UnreferencedBytes} {
		if err := addPlanBytes(&result.PotentialLogicalBytes, amount); err != nil {
			return result, err
		}
	}
	return result, nil
}

func writeSelectedPrunePlan(writer io.Writer, plan selectedPrunePlan) error {
	encoder := json.NewEncoder(writer)
	encoder.SetIndent("", "  ")
	return encoder.Encode(plan)
}
