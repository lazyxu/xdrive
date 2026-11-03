package offlinebundle

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func bytesHash(b []byte) string   { d := sha256.Sum256(b); return hex.EncodeToString(d[:]) }
func imageDigest(b []byte) string { return "sha256:" + bytesHash(b) }
func makeTarGz(t *testing.T, files map[string][]byte, extra []tar.Header) []byte {
	t.Helper()
	var buf bytes.Buffer
	g := gzip.NewWriter(&buf)
	w := tar.NewWriter(g)
	for name, data := range files {
		h := &tar.Header{Name: name, Mode: 0644, Size: int64(len(data)), Typeflag: tar.TypeReg}
		if err := w.WriteHeader(h); err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	for _, h := range extra {
		if err := w.WriteHeader(&h); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if err := g.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
func manifestFixture() *Manifest {
	m := &Manifest{
		Schema: 2, Platform: "linux/amd64", Source: "github", Channel: "master",
		SourceCommit: strings.Repeat("a", 40),
		Packages:     map[string]Package{}, Images: map[string]Image{},
		Contracts: map[string]int{"postgres_major": 17, "media_worker_api": 1,
			"photo_intelligence_api": 1, "model_runtime_api": 1},
		Fingerprints: map[string]string{},
	}
	for i, name := range Components {
		hash := strings.Repeat(string(rune('a'+i)), 64)
		// Format is bound to content hash, not to the commit.
		m.Packages[name] = Package{
			Filename: "xdrive-" + name + "-" + hash[:12] + ".tar.gz", SHA256: hash, Size: 10,
			Members:     map[string]Member{"images/test.tar.gz": {SHA256: strings.Repeat("b", 64), Size: 1}},
			Fingerprint: strings.Repeat("f", 64), BuiltFromCommit: m.SourceCommit,
			ReleaseTag: "offline-" + name + "-" + hash[:12],
		}
		m.Fingerprints[name] = strings.Repeat("f", 64)
	}
	app := m.Packages["app"]
	for _, n := range requiredFiles {
		app.Members[n] = Member{SHA256: strings.Repeat("c", 64), Size: 1}
	}
	m.Packages["app"] = app
	models := m.Packages["ai-models"]
	models.Members["models/weights.onnx"] = Member{SHA256: strings.Repeat("d", 64), Size: 1}
	models.Members["licenses/license.txt"] = Member{SHA256: strings.Repeat("e", 64), Size: 1}
	m.Packages["ai-models"] = models
	for key, owner := range imageMembers {
		img := m.Packages[owner.Component]
		img.Members[owner.Member] = Member{SHA256: strings.Repeat("b", 64), Size: 1}
		m.Packages[owner.Component] = img
		ref := "ghcr.io/lazyxu/xdrive-" + key + ":sha-" + m.SourceCommit[:12]
		if key == "server" || key == "caddy" {
			ref = "ghcr.io/lazyxu/xdrive-" + key + ":sha-" + m.SourceCommit[:12]
		}
		m.Images[key] = Image{Ref: ref, ID: "sha256:" + strings.Repeat("b", 64)}
	}
	return m
}
func TestManifestGoMatchesExistingFormat(t *testing.T) {
	m := manifestFixture()
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseManifest(data); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	validSHA := bytesHash(data)
	if _, err := ReadManifest(dir, validSHA, true); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name     string
		digest   string
		required bool
	}{
		{"missing trust", "", true}, {"bad digest", strings.Repeat("0", 64), true},
		{"malformed digest", "../bad", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := ReadManifest(dir, test.digest, test.required); err == nil {
				t.Fatal("accepted unsafe Manifest trust")
			}
		})
	}
	t.Run("duplicate JSON keys", func(t *testing.T) {
		broken := bytes.Replace(data, []byte(`"schema":2`), []byte(`"schema":2,"schema":2`), 1)
		if bytes.Equal(data, broken) {
			t.Fatal("fixture replacement missed")
		}
		if _, err := ParseManifest(broken); err == nil {
			t.Fatal("duplicate field accepted")
		}
	})
	t.Run("unsafe path", func(t *testing.T) {
		broken := manifestFixture()
		app := broken.Packages["app"]
		app.Members["../malicious"] = Member{SHA256: strings.Repeat("e", 64), Size: 1}
		broken.Packages["app"] = app
		raw, _ := json.Marshal(broken)
		if _, err := ParseManifest(raw); err == nil {
			t.Fatal("unsafe tar path accepted")
		}
	})
	t.Run("conflicting image reference", func(t *testing.T) {
		broken := manifestFixture()
		i := broken.Images["server"]
		i.Ref = "ghcr.io/lazyxu/xdrive-server:latest"
		broken.Images["server"] = i
		raw, _ := json.Marshal(broken)
		if _, err := ParseManifest(raw); err == nil {
			t.Fatal("moving image tag accepted")
		}
	})
}
func TestGoArchiveRejectsCorruptionAndLink(t *testing.T) {
	dir := t.TempDir()
	content := []byte("verified data")
	file := "assets/xdrive-server-install.sh"
	archive := makeTarGz(t, map[string][]byte{file: content}, nil)
	name := filepath.Join(dir, "xdrive-app.tar.gz")
	if err := os.WriteFile(name, archive, 0600); err != nil {
		t.Fatal(err)
	}
	p := Package{SHA256: bytesHash(archive), Size: int64(len(archive)),
		Members: map[string]Member{file: {SHA256: bytesHash(content), Size: int64(len(content))}}}
	if err := VerifyArchive(name, p, ""); err != nil {
		t.Fatal(err)
	}
	extracted := filepath.Join(dir, "extract")
	if err := VerifyArchive(name, p, extracted); err != nil {
		t.Fatal(err)
	}
	result, err := os.ReadFile(filepath.Join(extracted, "assets", "xdrive-server-install.sh"))
	if err != nil || !bytes.Equal(result, content) {
		t.Fatal("Go extraction differs")
	}
	copy := append([]byte{}, archive...)
	copy[len(copy)/2] ^= 0x01
	if err := os.WriteFile(name, copy, 0600); err != nil {
		t.Fatal(err)
	}
	if err := VerifyArchive(name, p, ""); err == nil {
		t.Fatal("altered archive passed SHA-256")
	}
	other := filepath.Join(dir, "shortcut")
	if err := os.Symlink(name, other); err != nil {
		t.Fatal(err)
	}
	if err := VerifyArchive(other, p, ""); err == nil {
		t.Fatal("symlink accepted")
	}
	bad := makeTarGz(t, map[string][]byte{}, []tar.Header{
		{Name: "assets/symlink", Typeflag: tar.TypeSymlink, Linkname: "../../etc/passwd", Mode: 0644},
	})
	if err := os.WriteFile(name, bad, 0600); err != nil {
		t.Fatal(err)
	}
	p = Package{SHA256: bytesHash(bad), Size: int64(len(bad)),
		Members: map[string]Member{"assets/symlink": {SHA256: bytesHash(nil), Size: 0}}}
	if err := VerifyArchive(name, p, ""); err == nil {
		t.Fatal("tar symlink accepted")
	}
}
func dockerImageFixture(t *testing.T, oci bool) ([]byte, Image) {
	t.Helper()
	ref := "ghcr.io/lazyxu/xdrive-server:sha-" + strings.Repeat("a", 12)
	layer := []byte("an original layer")
	layerID := imageDigest(layer)
	config := []byte(`{"os":"linux","architecture":"amd64","rootfs":{"type":"layers","diff_ids":["` + layerID + `"]}}`)
	configID := imageDigest(config)
	configName := configID[7:] + ".json"
	layerName := "layer/layer.tar"
	if oci {
		configName = "blobs/sha256/" + configID[7:]
		layerName = "blobs/sha256/" + layerID[7:]
	}
	dockerManifest, _ := json.Marshal([]dockerSaveManifest{{Config: configName, RepoTags: []string{ref}, Layers: []string{layerName}}})
	files := map[string][]byte{
		"manifest.json": dockerManifest, configName: config, layerName: layer,
	}
	signedID := configID
	if oci {
		manifestDoc := map[string]any{"schemaVersion": 2, "mediaType": ociManifest,
			"config": map[string]any{"digest": configID, "mediaType": "application/vnd.oci.image.config.v1+json", "size": len(config)},
			"layers": []any{map[string]any{"digest": layerID, "mediaType": "application/vnd.oci.image.layer.v1.tar", "size": len(layer)}}}
		rawManifest, _ := json.Marshal(manifestDoc)
		manifestID := imageDigest(rawManifest)
		files["blobs/sha256/"+manifestID[7:]] = rawManifest
		idx := map[string]any{"schemaVersion": 2, "mediaType": ociIndex,
			"manifests": []any{map[string]any{"digest": manifestID, "size": len(rawManifest), "mediaType": ociManifest,
				"annotations": map[string]string{"io.containerd.image.name": ref},
				"platform":    map[string]string{"os": "linux", "architecture": "amd64"}}}}
		indexRaw, _ := json.Marshal(idx)
		files["index.json"] = indexRaw
		files["oci-layout"] = []byte(`{"imageLayoutVersion":"1.0.0"}`)
		signedID = manifestID
	}
	return makeTarGz(t, files, nil), Image{Ref: ref, ID: signedID}
}
func TestGoDockerIdentityClassicAndOCI(t *testing.T) {
	for _, oci := range []bool{false, true} {
		label := "classic"
		if oci {
			label = "OCI"
		}
		t.Run(label, func(t *testing.T) {
			archive, signed := dockerImageFixture(t, oci)
			filename := filepath.Join(t.TempDir(), "server.tar.gz")
			if err := os.WriteFile(filename, archive, 0600); err != nil {
				t.Fatal(err)
			}
			id, err := ImageArchiveIdentity(filename, signed)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(id.Config, "sha256:") {
				t.Fatal("missing verified config")
			}
			if oci && len(id.Descriptors) == 0 {
				t.Fatal("missing OCI descriptor chain")
			}
			signed.ID = "sha256:" + strings.Repeat("0", 64)
			if _, err := ImageArchiveIdentity(filename, signed); err == nil {
				t.Fatal("unlinked signed image identity accepted")
			}
			signed.Ref = "ghcr.io/attacker/not-xdrive:latest"
			if _, err := ImageArchiveIdentity(filename, signed); err == nil {
				t.Fatal("untrusted image reference accepted")
			}
		})
	}
}
func TestGoInstallRefusesUnsafeSelectionBeforeDocker(t *testing.T) {
	m := manifestFixture()
	for _, selection := range [][]string{
		{"postgres"}, {"app", "ai-models"}, {"app", "ai-runtime"},
	} {
		err := Install(context.Background(), m, InstallOptions{Directory: t.TempDir(), Components: selection})
		if err == nil {
			t.Fatal("accepted unsafe install dependency selection")
		}
	}
}
