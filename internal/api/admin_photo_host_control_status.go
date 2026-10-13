package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const (
	photoHostControlStatusName = "photo-host-control-status.json"
	photoHostControlFreshness  = 45 * time.Second
)

var photoHostControlRequestID = regexp.MustCompile(`^[0-9a-f]{24}$`)

type photoHostControlStatus struct {
	Supported             bool   `json:"supported"`
	State                 string `json:"state"`
	Revision              uint64 `json:"revision"`
	AppliedRevision       uint64 `json:"applied_revision"`
	Enabled               bool   `json:"enabled"`
	ProfileVerified       bool   `json:"profile_verified"`
	ObservedHostState     string `json:"observed_host_state"`
	RequestID             string `json:"request_id"`
	UpdatedAt             string `json:"updated_at"`
	AppliedInstanceDigest string `json:"-"`
	ModelAckAtApply       bool   `json:"-"`
}

func validPhotoHostControlState(state string) bool {
	switch state {
	case "idle", "queued", "running", "success", "failed":
		return true
	default:
		return false
	}
}

// Host Manager is the only trusted observation source. A revision printed by
// this reader is host-side evidence only; it is not a Server-audited admin
// apply or permission to claim the saved desired revision is effective.
func (s *Server) readPhotoHostControlStatus() (photoHostControlStatus, bool) {
	if s == nil || strings.TrimSpace(s.HostControlDir) == "" {
		return photoHostControlStatus{}, false
	}
	for _, filename := range []string{"heartbeat", photoHostControlStatusName} {
		info, err := os.Lstat(filepath.Join(s.HostControlDir, filename))
		if err != nil || !info.Mode().IsRegular() || info.Size() > 1024 ||
			time.Since(info.ModTime()) > photoHostControlFreshness ||
			time.Until(info.ModTime()) > 15*time.Second {
			return photoHostControlStatus{}, false
		}
	}
	data, err := os.ReadFile(filepath.Join(s.HostControlDir, photoHostControlStatusName))
	if err != nil || len(data) == 0 || len(data) > 1024 {
		return photoHostControlStatus{}, false
	}
	var status photoHostControlStatus
	// The action-time digest is private to Server-side proof checks. Never
	// export it through this status object's JSON or any admin DTO.
	var sealed struct {
		Digest string `json:"applied_instance_digest"`
		Ack    *bool  `json:"model_ack_at_apply"`
	}
	if json.Unmarshal(data, &status) != nil || json.Unmarshal(data, &sealed) != nil || !status.Supported ||
		!validPhotoHostControlState(status.State) ||
		!validPhotoIntelligenceHostState(status.ObservedHostState) ||
		status.Revision >= 1<<60 || status.AppliedRevision > status.Revision ||
		(status.RequestID != "" && !photoHostControlRequestID.MatchString(status.RequestID)) {
		return photoHostControlStatus{}, false
	}
	if sealed.Digest != "" && (status.State != "success" ||
		!validPhotoIntelligenceHealthDigest(sealed.Digest)) {
		return photoHostControlStatus{}, false
	}
	// Legacy Host Managers have no model receipt. A true action-time receipt
	// without an exact successful host request and pinned generation is invalid,
	// not permission to create a public application/effect claim.
	if sealed.Ack != nil && *sealed.Ack &&
		(status.State != "success" || sealed.Digest == "" ||
			status.RequestID == "" || status.AppliedRevision == 0) {
		return photoHostControlStatus{}, false
	}
	status.AppliedInstanceDigest = sealed.Digest
	status.ModelAckAtApply = sealed.Ack != nil && *sealed.Ack
	if status.State == "idle" && (status.Revision != 0 || status.AppliedRevision != 0 ||
		status.Enabled || status.RequestID != "") {
		return photoHostControlStatus{}, false
	}
	if (status.State == "queued" || status.State == "running" || status.State == "success") &&
		(status.Revision == 0 || status.RequestID == "" || !status.Enabled) {
		return photoHostControlStatus{}, false
	}
	if status.State == "success" && (!status.ProfileVerified ||
		status.ObservedHostState != "healthy" ||
		status.AppliedRevision != status.Revision) {
		return photoHostControlStatus{}, false
	}
	if strings.TrimSpace(status.UpdatedAt) == "" {
		return photoHostControlStatus{}, false
	}
	at, err := time.Parse(time.RFC3339, status.UpdatedAt)
	if err != nil || time.Since(at) > photoHostControlFreshness ||
		time.Until(at) > 15*time.Second {
		return photoHostControlStatus{}, false
	}
	return status, true
}
