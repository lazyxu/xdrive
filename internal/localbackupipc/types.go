package localbackupipc

import (
	"errors"
	"time"
)

// Shared owner-Agent backup projections. Desktop and xd observe the SAME
// durable Runner; neither protocol is allowed to authorize an upload from
// a client-provided pathname or to claim Source-wide physical completion.
const MaxSafeSourceID uint64 = 9007199254740991

var ErrAgentUnavailable = errors.New("owning xdrive-agent is not running")

type Summary struct {
	SourceID           uint64 `json:"source_id"`
	Revision           uint64 `json:"revision"`
	State              string `json:"state"`
	Running            bool   `json:"running"`
	InspectedFiles     int64  `json:"inspected_files"`
	ConfirmedFiles     int64  `json:"confirmed_files"`
	SkippedFiles       int64  `json:"skipped_files"`
	UnsupportedFiles   int64  `json:"unsupported_files"`
	UncertainFiles     int64  `json:"uncertain_files"`
	ConfirmedBytes     int64  `json:"confirmed_bytes"`
	StopRequested      string `json:"stop_requested,omitempty"`
	BackupComplete     bool   `json:"backup_complete"`
	RetirementSafe     bool   `json:"retirement_safe"`
	CurrentCASVerified bool   `json:"current_cas_verified"`
}

func ValidSourceID(id uint64) bool { return id > 0 && id <= MaxSafeSourceID }

// ValidateSummary is a conservative CLI defense against forged or stale IPC
// replies. The Agent remains the sole authority and performs its own checks.
func ValidateSummary(s Summary, sourceID uint64) bool {
	if !ValidSourceID(sourceID) || s.SourceID != sourceID ||
		s.BackupComplete || s.RetirementSafe || s.CurrentCASVerified ||
		s.Running != (s.State == "running") ||
		(!s.Running && s.Revision == 0) ||
		s.InspectedFiles < 0 || s.ConfirmedFiles < 0 || s.SkippedFiles < 0 ||
		s.UnsupportedFiles < 0 || s.UncertainFiles < 0 || s.ConfirmedBytes < 0 ||
		s.ConfirmedFiles > s.InspectedFiles ||
		s.SkippedFiles > s.InspectedFiles-s.ConfirmedFiles ||
		s.UnsupportedFiles > s.InspectedFiles-s.ConfirmedFiles-s.SkippedFiles {
		return false
	}
	switch s.State {
	case "running", "partial", "uncertain", "paused", "cancelled":
	default:
		return false
	}
	return s.StopRequested == "" || (s.Running &&
		(s.StopRequested == "pause" || s.StopRequested == "cancel"))
}

type HistoryItem struct {
	RunID            string    `json:"run_id"`
	SourceID         uint64    `json:"source_id"`
	Revision         uint64    `json:"revision"`
	State            string    `json:"state"`
	InspectedFiles   int64     `json:"inspected_files"`
	ConfirmedFiles   int64     `json:"confirmed_files"`
	SkippedFiles     int64     `json:"skipped_files"`
	UnsupportedFiles int64     `json:"unsupported_files"`
	UncertainFiles   int64     `json:"uncertain_files"`
	ConfirmedBytes   int64     `json:"confirmed_bytes"`
	StartedAt        time.Time `json:"started_at"`
	FinishedAt       time.Time `json:"finished_at"`
}

type HistoryPage struct {
	SourceID uint64        `json:"source_id"`
	Items    []HistoryItem `json:"items"`
}

func ValidateHistory(page HistoryPage, sourceID uint64) bool {
	if !ValidSourceID(sourceID) || page.SourceID != sourceID || len(page.Items) > 20 {
		return false
	}
	for _, item := range page.Items {
		if item.RunID == "" || item.SourceID != sourceID || item.Revision == 0 ||
			item.InspectedFiles < 0 || item.ConfirmedFiles < 0 || item.SkippedFiles < 0 ||
			item.UnsupportedFiles < 0 || item.UncertainFiles < 0 || item.ConfirmedBytes < 0 ||
			item.ConfirmedFiles > item.InspectedFiles ||
			item.SkippedFiles > item.InspectedFiles-item.ConfirmedFiles ||
			item.UnsupportedFiles > item.InspectedFiles-item.ConfirmedFiles-item.SkippedFiles ||
			item.StartedAt.IsZero() || item.FinishedAt.IsZero() ||
			item.FinishedAt.Before(item.StartedAt) {
			return false
		}
		switch item.State {
		case "partial", "uncertain", "paused", "cancelled":
		default:
			return false
		}
	}
	return true
}

type Schedule struct {
	SourceID           uint64 `json:"source_id"`
	Revision           uint64 `json:"revision"`
	ScheduleType       string `json:"schedule_type"`
	ScheduleExpression string `json:"schedule_expression"`
	ScheduleTimezone   string `json:"schedule_timezone"`
}

func ValidateSchedule(s Schedule, sourceID uint64) bool {
	if !ValidSourceID(sourceID) || s.SourceID != sourceID || s.Revision == 0 {
		return false
	}
	switch s.ScheduleType {
	case "", "manual", "interval", "cron":
		return true
	}
	return false
}
