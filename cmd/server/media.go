package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/config"
	"github.com/lazyxu/xdrive/internal/maintenance"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func runMediaCommand(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: xdrive-server media <verify|repair> [options]")
	}
	switch args[0] {
	case "verify":
		return runMediaVerify(args[1:])
	case "repair":
		return runMediaRepair(args[1:])
	default:
		return fmt.Errorf("usage: xdrive-server media <verify|repair> [options]")
	}
}

func runMediaVerify(args []string) error {
	fs := flag.NewFlagSet("media verify", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "write machine-readable JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("usage: xdrive-server media verify [--json]")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	report, err := maintenance.VerifyMediaWithStorageRoot(db, cfg.StorageRoot)
	if err != nil {
		return err
	}
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			return err
		}
	} else {
		fmt.Printf("media metadata:    %d\n", report.Metadata)
		fmt.Printf("media groups:      %d\n", report.Groups)
		fmt.Printf("media group items: %d\n", report.GroupItems)
		fmt.Printf("derived resources: %d\n", report.DerivedResources)
		fmt.Printf("thumbnails:        %d\n", report.Thumbnails)
		fmt.Printf("durable people:    %d\n", report.PhotoPeople)
		fmt.Printf("person memberships:%d\n", report.PhotoPersonMemberships)
		fmt.Printf("smart albums:      %d\n", report.SmartAlbums)
		fmt.Printf("person clusters:   %d\n", report.PhotoPersonClusters)
		fmt.Printf("cluster faces:     %d\n", report.PhotoPersonClusterFaces)
		fmt.Printf("cluster states:    %d\n", report.PhotoPersonClusterStates)
		fmt.Printf("issues:            %d\n", len(report.Issues))
		for _, issue := range report.Issues {
			fmt.Printf(
				"MEDIA_INTEGRITY owner=%d node=%d group=%d asset=%d person_row=%d person=%q cluster=%d face=%d collection=%d role=%q storage_key=%q reason=%s",
				issue.OwnerID,
				issue.NodeID,
				issue.GroupID,
				issue.AssetID,
				issue.PersonRowID,
				issue.PersonID,
				issue.ClusterID,
				issue.FaceID,
				issue.CollectionID,
				issue.Role,
				issue.StorageKey,
				issue.Reason,
			)
			if issue.Expected != "" || issue.Actual != "" {
				fmt.Printf(" expected=%q actual=%q", issue.Expected, issue.Actual)
			}
			fmt.Println()
		}
	}
	if !report.OK() {
		return fmt.Errorf("media consistency check failed")
	}
	return nil
}

func runMediaRepair(args []string) error {
	fs := flag.NewFlagSet("media repair", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "write machine-readable JSON")
	dryRun := fs.Bool("dry-run", false, "show deterministic repairs without changing metadata")
	gcThumbnails := fs.Bool(
		"gc-thumbnails",
		false,
		"remove unreferenced thumbnail-cache files older than 24 hours",
	)
	gcIntelligence := fs.Bool(
		"gc-intelligence",
		false,
		"remove old non-authoritative automatic person clusters",
	)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("usage: xdrive-server media repair [--json] [--dry-run] [--gc-thumbnails] [--gc-intelligence]")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	report, err := maintenance.RepairMedia(
		context.Background(),
		db,
		cfg.StorageRoot,
		*dryRun,
	)
	if err != nil {
		return err
	}
	if *gcThumbnails {
		gcReport, gcErr := maintenance.GarbageCollectMediaThumbnails(
			context.Background(),
			db,
			cfg.StorageRoot,
			*dryRun,
		)
		if gcErr != nil {
			return gcErr
		}
		report.ThumbnailGC = &gcReport
	}
	if *gcIntelligence {
		gcReport, gcErr := maintenance.GarbageCollectPhotoIntelligence(
			context.Background(),
			db,
			*dryRun,
		)
		if gcErr != nil {
			return gcErr
		}
		report.IntelligenceGC = &gcReport
	}
	if *asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			return err
		}
	} else {
		fmt.Printf(
			"media repair: dry_run=%t thumbnail_actions=%d relation_actions=%d derived_actions=%d person_membership_actions=%d person_cover_actions=%d person_cluster_actions=%d skipped=%d before_issues=%d after_issues=%d\n",
			report.DryRun,
			len(report.Actions),
			len(report.RelationActions),
			len(report.DerivedActions),
			len(report.PersonMembershipActions),
			len(report.PersonCoverActions),
			len(report.PersonClusterActions),
			len(report.Skipped),
			len(report.Before.Issues),
			len(report.After.Issues),
		)
		if report.ThumbnailGC != nil {
			fmt.Printf(
				"thumbnail gc: min_age=%ds scanned=%d/%dB candidates=%d/%dB deleted=%d/%dB\n",
				report.ThumbnailGC.MinAgeSeconds,
				report.ThumbnailGC.ScannedFiles,
				report.ThumbnailGC.ScannedBytes,
				report.ThumbnailGC.CandidateFiles,
				report.ThumbnailGC.CandidateBytes,
				report.ThumbnailGC.DeletedFiles,
				report.ThumbnailGC.DeletedBytes,
			)
			for _, action := range report.ThumbnailGC.Actions {
				fmt.Printf(
					"GC_MEDIA_THUMBNAIL storage_key=%q size=%d modified_at=%s applied=%t skipped=%q\n",
					action.StorageKey,
					action.Size,
					action.ModifiedAt.UTC().Format(time.RFC3339),
					action.Applied,
					action.SkippedReason,
				)
			}
		}
		if report.IntelligenceGC != nil {
			fmt.Printf(
				"photo intelligence gc: min_age=%ds scanned=%d candidates=%d deleted=%d\n",
				report.IntelligenceGC.MinAgeSeconds,
				report.IntelligenceGC.ScannedClusters,
				report.IntelligenceGC.CandidateClusters,
				report.IntelligenceGC.DeletedClusters,
			)
			for _, action := range report.IntelligenceGC.Actions {
				fmt.Printf(
					"GC_PERSON_CLUSTER owner=%d cluster=%d key=%q reason=%s updated_at=%s applied=%t skipped=%q\n",
					action.OwnerID,
					action.ClusterID,
					action.ClusterKey,
					action.Reason,
					action.UpdatedAt.UTC().Format(time.RFC3339),
					action.Applied,
					action.SkippedReason,
				)
			}
		}
		for _, action := range report.Actions {
			fmt.Printf(
				"REPAIR_MEDIA_THUMBNAIL owner=%d node=%d storage_key=%q reasons=%q applied=%t\n",
				action.OwnerID,
				action.NodeID,
				action.StorageKey,
				strings.Join(action.Reasons, ","),
				action.Applied,
			)
		}
		for _, action := range report.RelationActions {
			fmt.Printf(
				"REPAIR_MEDIA_RELATIONS owner=%d groups=%v reasons=%q applied=%t\n",
				action.OwnerID,
				action.GroupIDs,
				strings.Join(action.Reasons, ","),
				action.Applied,
			)
		}
		for _, action := range report.DerivedActions {
			fmt.Printf(
				"REPAIR_MEDIA_DERIVED owner=%d node=%d mode=%s reasons=%q applied=%t\n",
				action.OwnerID,
				action.NodeID,
				action.Mode,
				strings.Join(action.Reasons, ","),
				action.Applied,
			)
		}
		for _, action := range report.PersonMembershipActions {
			fmt.Printf(
				"REPAIR_PERSON_MEMBERSHIP owner=%d person_row=%d person=%q asset=%d reason=%s applied=%t\n",
				action.OwnerID,
				action.PersonRowID,
				action.PersonID,
				action.AssetID,
				action.Reason,
				action.Applied,
			)
		}
		for _, action := range report.PersonCoverActions {
			fmt.Printf(
				"REPAIR_PERSON_COVER owner=%d person_row=%d person=%q previous_asset=%d reasons=%q applied=%t\n",
				action.OwnerID,
				action.PersonRowID,
				action.PersonID,
				action.PreviousAssetID,
				strings.Join(action.Reasons, ","),
				action.Applied,
			)
		}
		for _, action := range report.PersonClusterActions {
			fmt.Printf(
				"REPAIR_PERSON_CLUSTER owner=%d clusters=%v reset=%t reasons=%q applied=%t\n",
				action.OwnerID,
				action.ClusterIDs,
				action.ResetProjection,
				strings.Join(action.Reasons, ","),
				action.Applied,
			)
		}
		for _, issue := range report.Skipped {
			fmt.Printf(
				"SKIP_MEDIA_REPAIR owner=%d node=%d group=%d asset=%d person=%q cluster=%d collection=%d role=%q reason=%s\n",
				issue.OwnerID,
				issue.NodeID,
				issue.GroupID,
				issue.AssetID,
				issue.PersonID,
				issue.ClusterID,
				issue.CollectionID,
				issue.Role,
				issue.Reason,
			)
		}
	}
	if !*dryRun && !report.After.OK() {
		return fmt.Errorf("media consistency remains inconsistent after repair")
	}
	return nil
}
