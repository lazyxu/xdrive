package photointelligence

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func testPhotoHostTrustBundle() string {
	return "xdrive.photo.trust-anchor.v1\n" + strings.Repeat("a", 32) + "\n" + strings.Repeat("b", 64) + "\n7\n2\n" +
		strings.Repeat("1", 32) + " " + strings.Repeat("c", 64) + "\n" +
		strings.Repeat("2", 32) + " " + strings.Repeat("d", 64) + "\n"
}
func testPhotoHostTrustFile(t *testing.T, contents string) (string, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "trust-anchor")
	if err := os.WriteFile(path, []byte(contents), 0400); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(contents))
	return path, hex.EncodeToString(sum[:])
}
func TestPhotoHostPinnedPublicTrustMaterialRead(t *testing.T) {
	path, pin := testPhotoHostTrustFile(t, testPhotoHostTrustBundle())
	got, err := ReadPinnedPhotoHostTrustAnchorV1(path, pin)
	if err != nil || got.Revision != 7 || got.DeploymentEpoch != strings.Repeat("a", 32) || len(got.OperatorKey) != 32 || len(got.MemberKeys) != 2 {
		t.Fatalf("correct public material missing: %+v %v", got, err)
	}
	if _, err := ReadPinnedPhotoHostTrustAnchorV1(path, strings.Repeat("f", 64)); !errors.Is(err, ErrPhotoHostTrustAnchorUnverified) {
		t.Fatalf("different pin accepted: %v", err)
	}
	if _, err := ReadPinnedPhotoHostTrustAnchorV1("relative", pin); err == nil {
		t.Fatal("relative path accepted")
	}
	if _, err := ReadPinnedPhotoHostTrustAnchorV1(path, "bad"); err == nil {
		t.Fatal("weak pin accepted")
	}
	if _, err := ReadPinnedPhotoHostTrustAnchorV1(path+"-absent", pin); err == nil {
		t.Fatal("missing file accepted")
	}
	if _, err := ReadPinnedPhotoHostTrustAnchorV1(filepath.Dir(path), pin); err == nil {
		t.Fatal("directory accepted")
	}
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(path, link); err == nil {
		if _, err = ReadPinnedPhotoHostTrustAnchorV1(link, pin); err == nil {
			t.Fatal("symlink accepted")
		}
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(path, 0666); err != nil {
			t.Fatal(err)
		}
		if _, err := ReadPinnedPhotoHostTrustAnchorV1(path, pin); err == nil {
			t.Fatal("writable material accepted")
		}
	}
}
func TestPhotoHostPinnedTrustMaterialRejectsInvalidContent(t *testing.T) {
	valid := testPhotoHostTrustBundle()
	variants := map[string]string{
		"bad header":         strings.Replace(valid, "xdrive.photo.trust-anchor.v1", "bad.header", 1),
		"bad epoch":          strings.Replace(valid, strings.Repeat("a", 32), strings.Repeat("A", 32), 1),
		"bad key":            strings.Replace(valid, strings.Repeat("b", 64), strings.Repeat("Z", 64), 1),
		"bad revision":       strings.Replace(valid, "\n7\n2\n", "\n07\n2\n", 1),
		"duplicate ids":      strings.Replace(valid, strings.Repeat("2", 32)+" ", strings.Repeat("1", 32)+" ", 1),
		"out of order":       strings.Replace(strings.Replace(valid, strings.Repeat("1", 32), strings.Repeat("3", 32), 1), strings.Repeat("2", 32)+" ", strings.Repeat("1", 32)+" ", 1),
		"shared member key":  strings.Replace(valid, strings.Repeat("d", 64), strings.Repeat("c", 64), 1),
		"operator as member": strings.Replace(valid, strings.Repeat("d", 64), strings.Repeat("b", 64), 1),
		"wrong count":        strings.Replace(valid, "\n7\n2\n", "\n7\n3\n", 1),
		"extra bytes":        valid + "\n",
		"no trailing LF":     strings.TrimSuffix(valid, "\n"),
		"control":            strings.Replace(valid, "\n7\n2\n", "\r\n7\n2\n", 1),
		"oversized":          valid + strings.Repeat("X", 4096),
		"private key prose":  valid + "private_key=never\n",
	}
	for name, data := range variants {
		t.Run(name, func(t *testing.T) {
			path, pin := testPhotoHostTrustFile(t, data)
			if _, err := ReadPinnedPhotoHostTrustAnchorV1(path, pin); err == nil {
				t.Fatal("invalid public material accepted")
			}
		})
	}
}
func TestPhotoHostTrustFileChangeRequiresPinnedRevision(t *testing.T) {
	path, pin := testPhotoHostTrustFile(t, testPhotoHostTrustBundle())
	// The fixture intentionally starts read-only. Windows honors the read-only
	// attribute and refuses WriteFile until test permissions are restored.
	// Re-enable writes only for replacement, then restore read-only before
	// proving a changed bundle is rejected by the original pinned digest.
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Replace(testPhotoHostTrustBundle(), "\n7\n2\n", "\n8\n2\n", 1)), 0400); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0400); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadPinnedPhotoHostTrustAnchorV1(path, pin); err == nil {
		t.Fatal("updated file accepted with old pin")
	}
}
