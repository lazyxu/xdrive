//go:build linux

package caddyhostidentity

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

const (
	privateRetiredProofScope = "xdrive.caddy.retired-targets.v1"
	privateDeployProofScope  = "xdrive.caddy.host-env.v1"
)

type privateHostRetiredRecord struct {
	PreviousSHA string `json:"previous_sha256"`
	Protocol    string `json:"protocol"`
	RequestID   string `json:"request_id"`
	Domain      string `json:"retired_domain"`
	LANIP       string `json:"retired_lan_ip"`
	TargetSHA   string `json:"target_sha256"`
}

type privateHostAppliedTerminal struct {
	GenerationSHA string `json:"host_local_generation_sha256"`
	ConfigSHA     string `json:"host_local_live_config_sha256"`
	Protocol      string `json:"protocol"`
	RequestID     string `json:"request_id"`
	RetiredSHA    string `json:"retired_targets_sha256"`
	TargetSHA     string `json:"sha256"`
	State         string `json:"state"`
}

func privateReadHostRetiredTargets(controlDir, requestID string, current privateHostAuthoritySnapshot, activeGenerationSHA, activeLiveSHA string, now time.Time) (privateRetiredTargets, error) {
	fail := func() (privateRetiredTargets, error) { return privateRetiredTargets{}, errUntrusted }
	if now.IsZero() || !validPrivateOperationID(requestID) || !validDigest(current.envSHA) || !validDigest(activeGenerationSHA) || !validDigest(activeLiveSHA) || controlDir == "" || !filepath.IsAbs(controlDir) || filepath.Clean(controlDir) != controlDir {
		return fail()
	}
	real, err := filepath.EvalSymlinks(controlDir)
	if err != nil || real != controlDir || !privateHostRetiredArtifactSafe(controlDir, true, os.ModeSetgid|0770) {
		return fail()
	}
	term, termTime, err := privateReadRetiredArtifact(controlDir, "caddy-deploy-results", os.ModeSetgid|0750, requestID+".json", 0640, 512)
	if err != nil || now.Sub(termTime) > 7*24*time.Hour || termTime.After(now.Add(15*time.Second)) {
		return fail()
	}
	var receipt privateHostAppliedTerminal
	if json.Unmarshal(term, &receipt) != nil || !privateCanonicalJSONLine(term, receipt) || receipt.Protocol != privateDeployProofScope || receipt.State != "deployed" || receipt.RequestID != requestID || receipt.TargetSHA != current.envSHA || receipt.ConfigSHA != activeLiveSHA || receipt.GenerationSHA != activeGenerationSHA || !validDigest(receipt.RetiredSHA) {
		return fail()
	}
	raw, _, err := privateReadRetiredArtifact(controlDir, "caddy-retired-targets", 0700, requestID+".json", 0600, 1024)
	if err != nil {
		return fail()
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != receipt.RetiredSHA {
		return fail()
	}
	var source privateHostRetiredRecord
	if json.Unmarshal(raw, &source) != nil || !privateCanonicalJSONLine(raw, source) || source.Protocol != privateRetiredProofScope || source.RequestID != requestID || source.TargetSHA != receipt.TargetSHA || !validDigest(source.PreviousSHA) || (source.Domain == "" && source.LANIP == "") || (source.Domain != "" && (!validDomain(source.Domain) || source.Domain == current.domain)) || (source.LANIP != "" && (!validLANIP(source.LANIP) || source.LANIP == current.lanIPv4)) {
		return fail()
	}
	return privateRetiredTargets{domain: source.Domain, lanIPv4: source.LANIP}, nil
}

func validPrivateOperationID(id string) bool {
	if len(id) != 24 {
		return false
	}
	for _, c := range id {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

func privateCanonicalJSONLine(raw []byte, value any) bool {
	expected, err := json.Marshal(value)
	return err == nil && bytes.Equal(raw, append(expected, '\n'))
}

func privateHostRetiredArtifactSafe(path string, directory bool, mode os.FileMode) bool {
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || info.IsDir() != directory || (!directory && !info.Mode().IsRegular()) || info.Mode().Perm() != mode.Perm() {
		return false
	}
	sys, ok := info.Sys().(*syscall.Stat_t)
	return ok && sys.Uid == uint32(os.Geteuid()) && (directory || sys.Nlink == 1) && info.Mode()&os.ModeSetgid == mode&os.ModeSetgid
}

func privateReadRetiredArtifact(controlDir, subdir string, dirMode os.FileMode, filename string, fileMode os.FileMode, limit int64) ([]byte, time.Time, error) {
	fail := func() ([]byte, time.Time, error) { return nil, time.Time{}, errUntrusted }
	dir := filepath.Join(controlDir, subdir)
	if subdir == "caddy-retired-targets" {
		if !privateHostRetiredArtifactSafe(dir, true, 0700) && !privateHostRetiredArtifactSafe(dir, true, os.ModeSetgid|0700) {
			return fail()
		}
	} else if !privateHostRetiredArtifactSafe(dir, true, dirMode) {
		return fail()
	}
	path := filepath.Join(dir, filename)
	if !privateHostRetiredArtifactSafe(path, false, fileMode) {
		return fail()
	}
	parentBefore, dirErr := os.Lstat(dir)
	if dirErr != nil {
		return fail()
	}
	before, err := os.Lstat(path)
	if err != nil || before.Size() <= 0 || before.Size() > limit {
		return fail()
	}
	file, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return fail()
	}
	defer file.Close()
	openStat, err := file.Stat()
	if err != nil || !os.SameFile(before, openStat) {
		return fail()
	}
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(raw)) != before.Size() {
		return fail()
	}
	after, err := os.Lstat(path)
	parentAfter, parentErr := os.Lstat(dir)
	if err != nil || parentErr != nil || !os.SameFile(before, after) || !os.SameFile(parentBefore, parentAfter) || !privateHostRetiredArtifactSafe(path, false, fileMode) || !before.ModTime().Equal(after.ModTime()) {
		return fail()
	}
	if subdir == "caddy-retired-targets" {
		if !privateHostRetiredArtifactSafe(dir, true, 0700) && !privateHostRetiredArtifactSafe(dir, true, os.ModeSetgid|0700) {
			return fail()
		}
	} else if !privateHostRetiredArtifactSafe(dir, true, dirMode) {
		return fail()
	}
	return raw, after.ModTime(), nil
}
