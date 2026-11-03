package offlinebundle

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func integrationImageArchive(t *testing.T, ref string) ([]byte, string) {
	t.Helper()
	layer := []byte("fixed-original-image-layer")
	diffID := imageDigest(layer)
	config := []byte(fmt.Sprintf(`{"os":"linux","architecture":"amd64","rootfs":{"type":"layers","diff_ids":[%q]}}`, diffID))
	id := imageDigest(config)
	configName := id[7:] + ".json"
	files := map[string][]byte{
		configName:        config,
		"layer/layer.tar": layer,
	}
	dockerManifest, _ := json.Marshal([]dockerSaveManifest{{
		Config: configName, RepoTags: []string{ref}, Layers: []string{"layer/layer.tar"},
	}})
	files["manifest.json"] = dockerManifest
	return makeTarGz(t, files, nil), id
}
func populateIntegrationPackages(t *testing.T, dir string, failed bool) (*Manifest, string) {
	t.Helper()
	m := manifestFixture()
	configID := ""
	for _, name := range Components {
		files := map[string][]byte{}
		if name == "app" {
			for _, filename := range requiredFiles {
				files[filename] = []byte("verified deployment file\n")
			}
			installer := `#!/usr/bin/env bash
set -euo pipefail
[[ "$XD_OFFLINE_NO_PULL" == 1 ]]
[[ "$XD_INSTALL_SOURCE" == github ]]
[[ "$XD_INSTALL_CHANNEL" == master ]]
[[ -d "$XD_OFFLINE_ASSET_DIR" ]]
[[ "$XD_OFFLINE_SERVER_IMAGE" == ghcr.io/lazyxu/xdrive-server:sha-* ]]
printf 'verified transaction\n' > "$XD_TEST_TRANSACTION_MARKER"
`
			if failed {
				installer += "exit 73\n"
			}
			files["assets/xdrive-server-install.sh"] = []byte(installer)
			files["assets/scripts/xdrive-share-update.py"] = []byte("verified publisher helper\n")
		}
		if name == "ai-models" {
			files["models/weights.onnx"] = []byte("fake-model-bytes")
			files["licenses/license.txt"] = []byte("fake-license")
		}
		for key, owner := range imageMembers {
			if owner.Component != name {
				continue
			}
			ref := "ghcr.io/lazyxu/xdrive-" + key + ":sha-" + m.SourceCommit[:12]
			raw, id := integrationImageArchive(t, ref)
			files[owner.Member] = raw
			m.Images[key] = Image{Ref: ref, ID: id}
			configID = id
		}
		if len(files) == 0 {
			t.Fatalf("no files for %s", name)
		}
		members := map[string]Member{}
		for filename, data := range files {
			members[filename] = Member{SHA256: bytesHash(data), Size: int64(len(data))}
		}
		data := makeTarGz(t, files, nil)
		sha := bytesHash(data)
		entry := Package{
			Filename: fmt.Sprintf("xdrive-%s-%s.tar.gz", name, sha[:12]),
			SHA256:   sha, Size: int64(len(data)),
			Members: members, Fingerprint: strings.Repeat("f", 64),
			BuiltFromCommit: m.SourceCommit,
			ReleaseTag:      fmt.Sprintf("offline-%s-%s", name, sha[:12]),
		}
		m.Packages[name] = entry
		if err := os.WriteFile(filepath.Join(dir, entry.Filename), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseManifest(raw); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	return m, configID
}
func installWithMockDocker(t *testing.T, failed bool) {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Skip("Docker host activation test requires Linux")
	}
	root := t.TempDir()
	dir := filepath.Join(root, "release")
	home := filepath.Join(root, "home")
	bin := filepath.Join(root, "bin")
	for _, path := range []string{dir, bin, filepath.Join(home, "config"), filepath.Join(home, "state")} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	m, id := populateIntegrationPackages(t, dir, failed)
	dockerScript := fmt.Sprintf(`#!/bin/sh
case "$1" in
  info|load|build) exit 0 ;;
  image) printf '%%s\n' '%s'; exit 0 ;;
esac
exit 51
`, id)
	if err := os.WriteFile(filepath.Join(bin, "docker"), []byte(dockerScript), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	receipt := filepath.Join(root, "receipt")
	t.Setenv("XD_TEST_TRANSACTION_MARKER", receipt)
	// A forged external image override must never override the signed
	// manifest identity or reach the transactional Host installer.
	t.Setenv("XD_OFFLINE_SERVER_IMAGE", "attacker/not-xdrive:latest")
	t.Setenv("XD_INSTALL_SOURCE", "attacker")
	t.Setenv("XD_OFFLINE_NO_PULL", "0")
	options := InstallOptions{Directory: dir, Workdir: root, Home: home, Components: Components,
		BackupFileData: false}
	err := Install(context.Background(), m, options)
	if failed {
		if err == nil {
			t.Fatal("Host activation failure ignored")
		}
		if _, err := os.Stat(filepath.Join(home, "state", "offline-installed.json")); !os.IsNotExist(err) {
			t.Fatal("failed Host transaction wrote success state")
		}
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(receipt); err != nil {
		t.Fatal("transactional installer was not invoked")
	}
	raw, err := os.ReadFile(filepath.Join(home, "state", "offline-installed.json"))
	if err != nil {
		t.Fatal(err)
	}
	var state InstalledState
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatal(err)
	}
	if state.SourceCommit != m.SourceCommit || len(state.Installed) != 5 {
		t.Fatalf("incorrect installed component receipt: %+v", state)
	}
}
func TestGoInstallerReusesHostTransactionAndScrubsOverrides(t *testing.T) {
	installWithMockDocker(t, false)
}
func TestGoInstallerDoesNotClaimSuccessAfterRollback(t *testing.T) {
	installWithMockDocker(t, true)
}
