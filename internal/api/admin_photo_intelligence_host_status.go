package api

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// The Host Manager observes only the fixed xdrive-photo-face container.
// ProfileConfigured is an operator deployment request, NOT an applied change.
// This is neither a container control API nor proof of any model capability.
const (
	photoIntelligenceHostStatusName = "photo-intelligence-runtime-status.json"
	photoIntelligenceHostFreshness  = 45 * time.Second
)

type photoIntelligenceHostStatus struct {
	State             string
	ProfileConfigured bool
}

func validPhotoIntelligenceHostState(state string) bool {
	switch state {
	case "healthy", "unhealthy", "starting", "running-unverified", "stopped", "unknown":
		return true
	default:
		return false
	}
}

// Only regular, bounded and fresh files from the operator-provisioned bridge
// may affect installation observation; never accept a user-supplied host path,
// arbitrary Docker target, credentials, image, command or a fabricated success.
func (s *Server) readPhotoIntelligenceHostStatus() (photoIntelligenceHostStatus, bool) {
	if s == nil || strings.TrimSpace(s.HostControlDir) == "" {
		return photoIntelligenceHostStatus{}, false
	}
	for _, file := range []string{"heartbeat", photoIntelligenceHostStatusName} {
		info, err := os.Lstat(filepath.Join(s.HostControlDir, file))
		if err != nil || !info.Mode().IsRegular() ||
			info.Size() > 512 ||
			time.Since(info.ModTime()) > photoIntelligenceHostFreshness ||
			time.Until(info.ModTime()) > 15*time.Second {
			return photoIntelligenceHostStatus{}, false
		}
	}
	raw, err := os.ReadFile(filepath.Join(s.HostControlDir, photoIntelligenceHostStatusName))
	if err != nil || len(raw) == 0 || len(raw) > 512 {
		return photoIntelligenceHostStatus{}, false
	}
	var payload struct {
		State             string `json:"state"`
		ProfileConfigured *bool  `json:"profile_configured"`
	}
	if json.Unmarshal(raw, &payload) != nil ||
		payload.ProfileConfigured == nil ||
		!validPhotoIntelligenceHostState(payload.State) {
		return photoIntelligenceHostStatus{}, false
	}
	return photoIntelligenceHostStatus{
		State:             payload.State,
		ProfileConfigured: *payload.ProfileConfigured,
	}, true
}
