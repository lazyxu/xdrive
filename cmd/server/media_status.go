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
	"github.com/lazyxu/xdrive/internal/photointelligence"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const mediaStatusAnalyzerTimeout = 5 * time.Second

type mediaFaceStatusDTO struct {
	Configured               bool                                `json:"configured"`
	Reachable                bool                                `json:"reachable"`
	Error                    string                              `json:"error,omitempty"`
	Analyzer                 *photointelligence.FaceAnalyzerInfo `json:"analyzer,omitempty"`
	DetectorAnalyzerVersion  string                              `json:"detector_analyzer_version,omitempty"`
	EmbeddingAnalyzerVersion string                              `json:"embedding_analyzer_version,omitempty"`
}

type mediaSmartStatusDTO struct {
	Configured            bool                                 `json:"configured"`
	Reachable             bool                                 `json:"reachable"`
	Error                 string                               `json:"error,omitempty"`
	Analyzer              *photointelligence.SmartAnalyzerInfo `json:"analyzer,omitempty"`
	VisualAnalyzerVersion string                               `json:"visual_analyzer_version,omitempty"`
	OCRAnalyzerVersion    string                               `json:"ocr_analyzer_version,omitempty"`
}

type mediaPersonStatusDTO struct {
	Enabled         bool   `json:"enabled"`
	AnalyzerVersion string `json:"analyzer_version"`
}

type mediaPlaceStatusDTO struct {
	Configured bool `json:"configured"`
}

type mediaStatusDTO struct {
	Face     mediaFaceStatusDTO                                `json:"face"`
	Smart    mediaSmartStatusDTO                               `json:"smart_search"`
	Person   mediaPersonStatusDTO                              `json:"person"`
	Place    mediaPlaceStatusDTO                               `json:"place"`
	Database photointelligence.PhotoIntelligenceDatabaseStatus `json:"database"`
}

func runMediaStatus(args []string) error {
	fs := flag.NewFlagSet("media status", flag.ContinueOnError)
	asJSON := fs.Bool("json", false, "write machine-readable JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return fmt.Errorf("usage: xdrive-server media status [--json]")
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}

	dbCtx, dbCancel := context.WithTimeout(
		context.Background(),
		mediaStatusAnalyzerTimeout,
	)
	defer dbCancel()
	database, err := photointelligence.LoadPhotoIntelligenceDatabaseStatus(
		dbCtx,
		db,
	)
	if err != nil {
		return err
	}

	report := mediaStatusDTO{
		Face: mediaFaceStatusDTO{
			Configured: strings.TrimSpace(cfg.PhotoFaceAnalyzerSocket) != "",
		},
		Smart: mediaSmartStatusDTO{
			Configured: strings.TrimSpace(cfg.PhotoFaceAnalyzerSocket) != "",
		},
		Person: mediaPersonStatusDTO{
			Enabled:         true,
			AnalyzerVersion: photointelligence.PersonClusterAnalyzerVersion(),
		},
		Place: mediaPlaceStatusDTO{
			Configured: strings.TrimSpace(cfg.PhotoPlaceGeoNamesDir) != "",
		},
		Database: database,
	}

	if report.Face.Configured {
		analyzer, analyzerErr := photointelligence.NewUnixFaceAnalyzer(
			cfg.PhotoFaceAnalyzerSocket,
			cfg.PhotoFaceAnalyzerToken,
			mediaStatusAnalyzerTimeout,
		)
		if analyzerErr != nil {
			report.Face.Error = analyzerErr.Error()
		} else {
			analyzerCtx, analyzerCancel := context.WithTimeout(
				context.Background(),
				mediaStatusAnalyzerTimeout,
			)
			defer analyzerCancel()
			info, infoErr := analyzer.Info(analyzerCtx)
			if infoErr != nil {
				report.Face.Error = infoErr.Error()
			} else {
				report.Face.Reachable = true
				report.Face.Analyzer = &info
				report.Face.DetectorAnalyzerVersion =
					photointelligence.FaceDetectorAnalyzerVersion(info)
				report.Face.EmbeddingAnalyzerVersion =
					photointelligence.FaceEmbeddingAnalyzerVersion(info)
			}
		}
	}

	if report.Smart.Configured {
		analyzer, analyzerErr := photointelligence.NewUnixSmartAnalyzer(
			cfg.PhotoFaceAnalyzerSocket,
			cfg.PhotoFaceAnalyzerToken,
			mediaStatusAnalyzerTimeout,
		)
		if analyzerErr != nil {
			report.Smart.Error = analyzerErr.Error()
		} else {
			analyzerCtx, analyzerCancel := context.WithTimeout(
				context.Background(),
				mediaStatusAnalyzerTimeout,
			)
			defer analyzerCancel()
			info, infoErr := analyzer.Info(analyzerCtx)
			if infoErr != nil {
				report.Smart.Error = infoErr.Error()
			} else {
				report.Smart.Reachable = true
				report.Smart.Analyzer = &info
				report.Smart.VisualAnalyzerVersion =
					photointelligence.SmartVisualAnalyzerVersion(info)
				report.Smart.OCRAnalyzerVersion =
					photointelligence.SmartOCRAnalyzerVersion(info)
			}
		}
	}

	if *asJSON {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(report)
	}

	printMediaStatus(report)
	return nil
}

func printMediaStatus(report mediaStatusDTO) {
	if !report.Face.Configured {
		fmt.Println("face analysis: disabled")
	} else if !report.Face.Reachable {
		fmt.Println("face analysis: configured, analyzer unreachable")
		if report.Face.Error != "" {
			fmt.Printf("face analyzer error: %s\n", report.Face.Error)
		}
	} else {
		fmt.Println("face analysis: enabled")
		info := report.Face.Analyzer
		fmt.Printf("face analyzer: %s\n", info.Name)
		fmt.Printf("pipeline: %s\n", info.PipelineVersion)
		if info.Runtime != nil {
			runtime := strings.TrimSpace(info.Runtime.Framework)
			if version := strings.TrimSpace(info.Runtime.Version); version != "" {
				runtime += " " + version
			}
			if device := strings.TrimSpace(info.Runtime.Device); device != "" {
				runtime += " / " + device
			}
			fmt.Printf("runtime: %s\n", runtime)
		}
		fmt.Printf(
			"detector: %s %s sha256=%s license=%s\n",
			info.Detector.Name,
			info.Detector.Version,
			info.Detector.SHA256,
			info.Detector.License,
		)
		fmt.Printf(
			"embedding: %s %s sha256=%s license=%s format=%s dimensions=%d\n",
			info.Embedding.Name,
			info.Embedding.Version,
			info.Embedding.SHA256,
			info.Embedding.License,
			info.EmbeddingFormat,
			info.EmbeddingDimensions,
		)
		fmt.Printf(
			"detector analyzer version: %s\n",
			report.Face.DetectorAnalyzerVersion,
		)
		fmt.Printf(
			"embedding analyzer version: %s\n",
			report.Face.EmbeddingAnalyzerVersion,
		)
	}
	fmt.Printf(
		"face detection states: %s\n",
		formatAnalysisStateCounts(report.Database.FaceDetection),
	)
	fmt.Printf(
		"face embedding states: %s\n",
		formatAnalysisStateCounts(report.Database.FaceEmbedding),
	)
	fmt.Printf("detected face rows: %d\n", report.Database.FaceRows)

	if !report.Smart.Configured {
		fmt.Println("smart search analysis: disabled")
	} else if !report.Smart.Reachable {
		fmt.Println("smart search analysis: configured, analyzer unreachable")
		if report.Smart.Error != "" {
			fmt.Printf("smart analyzer error: %s\n", report.Smart.Error)
		}
	} else {
		fmt.Println("smart search analysis: enabled")
		info := report.Smart.Analyzer
		fmt.Printf("smart analyzer: %s\n", info.Name)
		fmt.Printf("smart pipeline: %s\n", info.PipelineVersion)
		fmt.Printf(
			"classifier: %s %s sha256=%s license=%s\n",
			info.Classifier.Name,
			info.Classifier.Version,
			info.Classifier.SHA256,
			info.Classifier.License,
		)
		fmt.Printf(
			"OCR: %s %s + %s %s language=%s\n",
			info.TextDetector.Name,
			info.TextDetector.Version,
			info.TextRecognizer.Name,
			info.TextRecognizer.Version,
			info.OCRLanguage,
		)
		fmt.Printf(
			"visual analyzer version: %s\n",
			report.Smart.VisualAnalyzerVersion,
		)
		fmt.Printf(
			"OCR analyzer version: %s\n",
			report.Smart.OCRAnalyzerVersion,
		)
	}
	fmt.Printf(
		"visual analysis states: %s\n",
		formatAnalysisStateCounts(report.Database.VisualAnalysis),
	)
	fmt.Printf(
		"OCR analysis states: %s\n",
		formatAnalysisStateCounts(report.Database.OCRAnalysis),
	)
	fmt.Printf(
		"visual labels: %d OCR documents=%d\n",
		report.Database.VisualLabels,
		report.Database.OCRDocuments,
	)

	fmt.Println("person clustering: enabled")
	fmt.Printf("person cluster analyzer: %s\n", report.Person.AnalyzerVersion)
	fmt.Printf(
		"person cluster states: %s\n",
		formatAnalysisStateCounts(report.Database.PersonClustering),
	)
	fmt.Printf(
		"automatic clusters: %d faces=%d\n",
		report.Database.AutomaticClusters,
		report.Database.AutomaticClusterFaces,
	)
	fmt.Printf(
		"durable people: %d memberships=%d\n",
		report.Database.DurablePeople,
		report.Database.DurablePersonMemberships,
	)

	if report.Place.Configured {
		fmt.Println("place resolver: configured")
	} else {
		fmt.Println("place resolver: disabled")
	}
	fmt.Printf(
		"place analysis states: %s\n",
		formatAnalysisStateCounts(report.Database.PlaceAnalysis),
	)
	fmt.Printf("place labels: %d\n", report.Database.PlaceLabels)
	fmt.Printf("photo assets: %d\n", report.Database.PhotoAssets)
}

func formatAnalysisStateCounts(
	counts photointelligence.AnalysisStateCounts,
) string {
	return fmt.Sprintf(
		"pending=%d running=%d ready=%d failed=%d stale=%d",
		counts.Pending,
		counts.Running,
		counts.Ready,
		counts.Failed,
		counts.Stale,
	)
}
