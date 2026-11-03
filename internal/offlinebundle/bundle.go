package offlinebundle

// Package offlinebundle validates the signed five-component xDrive offline
// release format. It contains no Docker, network or privileged host operations.
// The executable and the UI Host must use the same admission rules.
import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	MaxManifestBytes = 8 << 20
	MaxPackageBytes  = int64(8) << 30
	MaxMembers       = 2000
)

var (
	DigestPattern = regexp.MustCompile("^[0-9a-f]{64}$")
	commitPattern = regexp.MustCompile("^[0-9a-f]{40}$")
	imagePattern  = regexp.MustCompile("^sha256:[0-9a-f]{64}$")
	refPattern    = regexp.MustCompile("^[a-z0-9._/-]+(:[a-zA-Z0-9_.-]+)?$")
	Components    = []string{"app", "postgres", "media-worker", "ai-runtime", "ai-models"}
	requiredFiles = []string{
		"assets/xdrive-server-install.sh",
		"assets/deploy/docker-compose.yml",
		"assets/scripts/server-backup.sh",
		"assets/scripts/server-backup-scheduled.sh",
		"assets/scripts/server-restore.sh",
		"assets/scripts/server-verify.sh",
		"assets/scripts/server-doctor.sh",
		"assets/scripts/server-migrate-user.sh",
		"assets/scripts/server-control.sh",
		"assets/scripts/caddy-env-config.py",
		"assets/scripts/caddy-admission.py",
		"assets/scripts/xdrive-server-host.sh",
	}
	imageMembers = map[string]struct{ Component, Member string }{
		"server":       {"app", "images/server.tar.gz"},
		"caddy":        {"app", "images/caddy.tar.gz"},
		"postgres":     {"postgres", "images/postgres.tar.gz"},
		"media-worker": {"media-worker", "images/media-worker.tar.gz"},
		"ai-runtime":   {"ai-runtime", "images/ai-runtime.tar.gz"},
	}
)

type Member struct {
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type Package struct {
	Filename        string            `json:"filename"`
	SHA256          string            `json:"sha256"`
	Size            int64             `json:"size"`
	Members         map[string]Member `json:"members"`
	Fingerprint     string            `json:"fingerprint,omitempty"`
	BuiltFromCommit string            `json:"built_from_commit,omitempty"`
	ReleaseTag      string            `json:"release_tag,omitempty"`
}
type Image struct {
	Ref string `json:"ref"`
	ID  string `json:"id"`
}
type Manifest struct {
	Schema       int                `json:"schema"`
	Platform     string             `json:"platform"`
	Source       string             `json:"source"`
	SourceCommit string             `json:"source_commit"`
	Channel      string             `json:"channel"`
	Packages     map[string]Package `json:"packages"`
	Images       map[string]Image   `json:"images"`
	Fingerprints map[string]string  `json:"fingerprints,omitempty"`
	Contracts    map[string]int     `json:"contracts,omitempty"`
}

func fail(format string, args ...any) error { return fmt.Errorf("xDrive offline: "+format, args...) }

func componentSet() map[string]bool {
	result := make(map[string]bool, len(Components))
	for _, n := range Components {
		result[n] = true
	}
	return result
}
func exactKeys[T any](m map[string]T, expected map[string]bool) bool {
	if len(m) != len(expected) {
		return false
	}
	for n := range m {
		if !expected[n] {
			return false
		}
	}
	return true
}
func SafeMember(name string) bool {
	if name == "" || len(name) >= 512 || strings.HasPrefix(name, "/") || strings.Contains(name, "\\") ||
		path.Clean(name) != name {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

// safeFile rejects symbolic links in the complete path, not only at the leaf.
// It does not turn untrusted filesystem paths into an authority to execute.
func SafeFile(filename string) (*os.File, os.FileInfo, error) {
	full, err := filepath.Abs(filename)
	if err != nil {
		return nil, nil, err
	}
	for cur := full; ; cur = filepath.Dir(cur) {
		info, err := os.Lstat(cur)
		if err != nil {
			return nil, nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, nil, fail("symlink in offline file path")
		}
		if cur == filepath.Dir(cur) {
			break
		}
	}
	info, err := os.Lstat(full)
	if err != nil {
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, nil, fail("not an offline regular file")
	}
	f, err := os.Open(full)
	if err != nil {
		return nil, nil, err
	}
	verified, err := f.Stat()
	if err != nil || !os.SameFile(info, verified) {
		f.Close()
		return nil, nil, fail("offline file changed during admission")
	}
	return f, verified, nil
}
func HashReader(r io.Reader) (string, error) {
	h := sha256.New()
	_, err := io.Copy(h, r)
	return hex.EncodeToString(h.Sum(nil)), err
}
func HashFile(filename string) (string, error) {
	f, _, err := SafeFile(filename)
	if err != nil {
		return "", err
	}
	defer f.Close()
	return HashReader(f)
}

// rejectDuplicateKeys prevents ambiguous metadata: Go's default JSON parser
// would otherwise silently accept the last duplicate object property.
func rejectDuplicateKeys(raw []byte) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var next func(int) error
	next = func(depth int) error {
		if depth > 64 {
			return fail("JSON nesting exceeds limit")
		}
		tok, err := d.Token()
		if err != nil {
			return err
		}
		delim, ok := tok.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				key, err := d.Token()
				if err != nil {
					return err
				}
				s, ok := key.(string)
				if !ok {
					return fail("invalid JSON object key")
				}
				if seen[s] {
					return fail("duplicate JSON key: %s", s)
				}
				seen[s] = true
				if err := next(depth + 1); err != nil {
					return err
				}
			}
			closing, err := d.Token()
			if err != nil {
				return err
			}
			if closing != json.Delim('}') {
				return fail("invalid object closing delimiter")
			}
		case '[':
			for d.More() {
				if err := next(depth + 1); err != nil {
					return err
				}
			}
			closing, err := d.Token()
			if err != nil {
				return err
			}
			if closing != json.Delim(']') {
				return fail("invalid array closing delimiter")
			}
		default:
			return fail("unexpected JSON delimiter")
		}
		return nil
	}
	if err := next(0); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		if err == nil {
			return fail("multiple JSON values")
		}
		return err
	}
	return nil
}
func ParseManifest(raw []byte) (*Manifest, error) {
	if len(raw) == 0 || len(raw) > MaxManifestBytes {
		return nil, fail("manifest size exceeds limit")
	}
	if err := rejectDuplicateKeys(raw); err != nil {
		return nil, err
	}
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fail("invalid manifest JSON: %v", err)
	}
	if m.Schema != 1 && m.Schema != 2 {
		return nil, fail("unsupported manifest schema")
	}
	if m.Platform != "linux/amd64" {
		return nil, fail("unsupported offline platform")
	}
	if !commitPattern.MatchString(m.SourceCommit) {
		return nil, fail("invalid release commit")
	}
	if m.Channel != "master" && m.Channel != "stable" {
		return nil, fail("unsupported channel")
	}
	if m.Source != "github" && m.Source != "gitlab" {
		return nil, fail("unsupported publisher")
	}
	if !exactKeys(m.Packages, componentSet()) {
		return nil, fail("manifest must declare all five packages")
	}
	filenames := map[string]bool{}
	for _, name := range Components {
		p := m.Packages[name]
		if !DigestPattern.MatchString(p.SHA256) || p.Filename !=
			fmt.Sprintf("xdrive-%s-%s.tar.gz", name, p.SHA256[:12]) ||
			p.Size <= 0 || p.Size > MaxPackageBytes || len(p.Members) == 0 || len(p.Members) > MaxMembers {
			return nil, fail("invalid package identity: %s", name)
		}
		if filenames[p.Filename] {
			return nil, fail("duplicate package filenames")
		}
		filenames[p.Filename] = true
		for member, meta := range p.Members {
			if !SafeMember(member) || !DigestPattern.MatchString(meta.SHA256) ||
				meta.Size < 0 || meta.Size > MaxPackageBytes {
				return nil, fail("invalid package member: %s", member)
			}
		}
	}
	if len(m.Images) != len(imageMembers) {
		return nil, fail("missing image identities")
	}
	for key, owner := range imageMembers {
		img, ok := m.Images[key]
		if !ok || !refPattern.MatchString(img.Ref) || !imagePattern.MatchString(img.ID) {
			return nil, fail("invalid image metadata: %s", key)
		}
		if _, ok := m.Packages[owner.Component].Members[owner.Member]; !ok {
			return nil, fail("missing image archive: %s", owner.Member)
		}
	}
	if m.Schema == 2 {
		if !exactKeys(m.Fingerprints, componentSet()) {
			return nil, fail("missing component fingerprints")
		}
		for _, name := range Components {
			p := m.Packages[name]
			if !DigestPattern.MatchString(m.Fingerprints[name]) ||
				p.Fingerprint != m.Fingerprints[name] ||
				!commitPattern.MatchString(p.BuiltFromCommit) ||
				p.ReleaseTag != fmt.Sprintf("offline-%s-%s", name, p.SHA256[:12]) {
				return nil, fail("invalid immutable package identity: %s", name)
			}
		}
		contracts := map[string]bool{"postgres_major": true, "media_worker_api": true, "photo_intelligence_api": true, "model_runtime_api": true}
		if !exactKeys(m.Contracts, contracts) {
			return nil, fail("missing compatibility contracts")
		}
		for _, v := range m.Contracts {
			if v <= 0 {
				return nil, fail("invalid compatibility contract")
			}
		}
	}
	for _, name := range requiredFiles {
		if _, ok := m.Packages["app"].Members[name]; !ok {
			return nil, fail("missing App deployment asset: %s", name)
		}
	}
	hasModel, hasLicense := false, false
	for name := range m.Packages["ai-models"].Members {
		if strings.HasPrefix(name, "models/") {
			hasModel = true
		}
		if strings.HasPrefix(name, "licenses/") {
			hasLicense = true
		}
	}
	if !hasModel || !hasLicense {
		return nil, fail("AI Models files or licenses missing")
	}
	if m.Channel == "master" {
		target := m.SourceCommit
		if m.Schema == 2 {
			target = m.Packages["app"].BuiltFromCommit
		}
		suffix := ":sha-" + target[:12]
		if !strings.HasSuffix(m.Images["server"].Ref, suffix) ||
			!strings.HasSuffix(m.Images["caddy"].Ref, suffix) {
			return nil, fail("App images not pinned to exact build commit")
		}
	}
	return &m, nil
}
func ReadManifest(dir, trustedSHA string, requireTrust bool) (*Manifest, error) {
	if requireTrust && trustedSHA == "" {
		return nil, fail("independently trusted Manifest SHA-256 required")
	}
	if trustedSHA != "" && !DigestPattern.MatchString(trustedSHA) {
		return nil, fail("invalid trusted Manifest SHA-256")
	}
	f, info, err := SafeFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return nil, err
	}
	defer f.Close()
	if info.Size() <= 0 || info.Size() > MaxManifestBytes {
		return nil, fail("manifest size exceeds limit")
	}
	raw, err := io.ReadAll(io.LimitReader(f, MaxManifestBytes+1))
	if err != nil {
		return nil, err
	}
	if trustedSHA != "" {
		actual := sha256.Sum256(raw)
		if hex.EncodeToString(actual[:]) != trustedSHA {
			return nil, fail("trusted Manifest digest mismatch")
		}
	}
	return ParseManifest(raw)
}
func Select(dir string, m *Manifest, requested string) ([]string, error) {
	selected := map[string]bool{}
	if requested != "" {
		for _, c := range strings.Split(requested, ",") {
			if !componentSet()[c] || selected[c] {
				return nil, fail("invalid component selection")
			}
			selected[c] = true
		}
	} else {
		for _, c := range Components {
			file := filepath.Join(dir, m.Packages[c].Filename)
			if s, err := os.Lstat(file); err == nil && s.Mode().IsRegular() {
				selected[c] = true
			}
		}
	}
	var result []string
	for _, c := range Components {
		if selected[c] {
			result = append(result, c)
		}
	}
	if len(result) == 0 {
		return nil, fail("no offline packages selected")
	}
	return result, nil
}
func VerifySelection(dir string, m *Manifest, selection []string, extractDir string) error {
	for _, component := range selection {
		if !componentSet()[component] {
			return fail("unknown component: %s", component)
		}
		p := m.Packages[component]
		target := ""
		if extractDir != "" {
			target = filepath.Join(extractDir, component)
		}
		fmt.Printf("[offline] verifying %s: %s\n", component, p.Filename)
		if err := VerifyArchive(filepath.Join(dir, p.Filename), p, target); err != nil {
			return err
		}
		fmt.Printf("[offline] %s: verified\n", component)
	}
	return nil
}

// SnapshotSelection copies the candidate's exact signed archives into a
// private directory BEFORE verification or Docker mutation. A group-writable
// Web upload staging area can change concurrently; no part of the install is
// allowed to read that live directory again after its snapshot was admitted.
func SnapshotSelection(sourceDir, targetDir string, m *Manifest, selection []string) error {
	if err := os.Mkdir(targetDir, 0700); err != nil {
		return err
	}
	for _, component := range selection {
		p, ok := m.Packages[component]
		if !ok {
			return fail("invalid component selected")
		}
		input, info, err := SafeFile(filepath.Join(sourceDir, p.Filename))
		if err != nil {
			return err
		}
		if info.Size() != p.Size {
			input.Close()
			return fail("offline staged archive size differs: %s", component)
		}
		target := filepath.Join(targetDir, p.Filename)
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			input.Close()
			return err
		}
		hash := sha256.New()
		n, copyErr := io.Copy(io.MultiWriter(output, hash), io.LimitReader(input, p.Size+1))
		readCloseErr := input.Close()
		writeCloseErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		if readCloseErr != nil {
			return readCloseErr
		}
		if writeCloseErr != nil {
			return writeCloseErr
		}
		if n != p.Size || hex.EncodeToString(hash.Sum(nil)) != p.SHA256 {
			return fail("offline staged archive SHA-256 differs: %s", component)
		}
	}
	return nil
}

func VerifyArchive(filename string, p Package, extractDir string) error {
	f, info, err := SafeFile(filename)
	if err != nil {
		return err
	}
	defer f.Close()
	if info.Size() != p.Size {
		return fail("package byte size mismatch: %s", p.Filename)
	}
	actual, err := HashReader(f)
	if err != nil {
		return err
	}
	if actual != p.SHA256 {
		return fail("package SHA-256 mismatch: %s", p.Filename)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	gz, err := gzip.NewReader(f)
	if err != nil {
		return fail("invalid gzip package: %w", err)
	}
	defer gz.Close()
	if extractDir != "" {
		if err := os.Mkdir(extractDir, 0700); err != nil {
			return err
		}
	}
	tarReader := tar.NewReader(gz)
	seen := map[string]bool{}
	for {
		h, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fail("invalid package tar: %w", err)
		}
		if h.Typeflag != tar.TypeReg && h.Typeflag != tar.TypeRegA {
			return fail("unsupported tar entry type: %s", h.Name)
		}
		expected, ok := p.Members[h.Name]
		if !SafeMember(h.Name) || !ok || seen[h.Name] || len(seen) >= MaxMembers || h.Size != expected.Size {
			return fail("unsafe or unexpected package member: %s", h.Name)
		}
		seen[h.Name] = true
		hasher := sha256.New()
		if extractDir == "" {
			if _, err := io.CopyN(hasher, tarReader, h.Size); err != nil {
				return err
			}
		} else {
			target := filepath.Join(extractDir, filepath.FromSlash(h.Name))
			if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
				return err
			}
			output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
			if err != nil {
				return err
			}
			_, copyErr := io.CopyN(io.MultiWriter(hasher, output), tarReader, h.Size)
			closeErr := output.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		}
		if hex.EncodeToString(hasher.Sum(nil)) != expected.SHA256 {
			return fail("tar member SHA-256 mismatch: %s", h.Name)
		}
		if extractDir != "" && strings.HasPrefix(h.Name, "assets/") && strings.HasSuffix(h.Name, ".sh") {
			if err := os.Chmod(filepath.Join(extractDir, filepath.FromSlash(h.Name)), 0700); err != nil {
				return err
			}
		}
	}
	if len(seen) != len(p.Members) {
		return fail("missing expected package members: %s", p.Filename)
	}
	// A tar EOF can precede the gzip trailer; drain it to validate CRC and size.
	if _, err := io.Copy(io.Discard, gz); err != nil {
		return fail("invalid gzip checksum: %w", err)
	}
	return nil
}
