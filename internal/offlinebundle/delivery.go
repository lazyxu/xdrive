package offlinebundle

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
)

// A delivery descriptor is independently attested alongside the Manifest and
// Go ELF. The executable is already verified by trusted Host bootstrap before
// this parser runs; this check enforces exact cryptographic cross-binding.
type signedDeliveryFile struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type signedDelivery struct {
	Schema       int                `json:"schema"`
	RepositoryID int64              `json:"repository_id"`
	Channel      string             `json:"channel"`
	Platform     string             `json:"platform"`
	SourceCommit string             `json:"source_commit"`
	Sequence     int64              `json:"sequence"`
	Manifest     signedDeliveryFile `json:"manifest"`
	Installer    signedDeliveryFile `json:"installer"`
	GoInstaller  signedDeliveryFile `json:"go_installer"`
}

func validSignedDeliveryFile(file signedDeliveryFile, name string) bool {
	return file.Name == name && file.Size > 0 && DigestPattern.MatchString(file.SHA256)
}

// VerifySignedDelivery binds the attested delivery descriptor, target Manifest,
// original repository, signed source commit, and the authenticated running ELF.
// It never runs Docker, network calls or untrusted release executables.
func VerifySignedDelivery(dir string, manifest *Manifest, manifestSHA, installerSHA, deliverySHA string) error {
	if manifest == nil || !DigestPattern.MatchString(manifestSHA) ||
		!DigestPattern.MatchString(installerSHA) || !DigestPattern.MatchString(deliverySHA) {
		return fail("signed delivery requires verified publisher identities")
	}
	f, info, err := SafeFile(filepath.Join(dir, "delivery.json"))
	if err != nil {
		return err
	}
	defer f.Close()
	const maxDeliveryBytes = int64(1 << 20)
	if info.Size() <= 0 || info.Size() > maxDeliveryBytes {
		return fail("signed delivery descriptor exceeds size limit")
	}
	raw, err := io.ReadAll(io.LimitReader(f, maxDeliveryBytes+1))
	if err != nil {
		return err
	}
	actual := sha256.Sum256(raw)
	if hex.EncodeToString(actual[:]) != deliverySHA {
		return fail("signed delivery descriptor differs from attested Host snapshot")
	}
	if err := rejectDuplicateKeys(raw); err != nil {
		return err
	}
	var d signedDelivery
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&d); err != nil {
		return fail("invalid signed delivery: %v", err)
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return fail("signed delivery contains trailing JSON")
	}
	if d.Schema != 1 || d.RepositoryID != 1382670236 || d.Channel != "master" ||
		d.Platform != "linux/amd64" || d.Sequence <= 0 ||
		!commitPattern.MatchString(d.SourceCommit) || d.SourceCommit != manifest.SourceCommit ||
		manifest.Schema != 2 || manifest.Source != "github" || manifest.Channel != "master" {
		return fail("signed delivery publisher, commit or compatibility metadata mismatch")
	}
	if !validSignedDeliveryFile(d.Manifest, "manifest.json") ||
		!validSignedDeliveryFile(d.Installer, "xdrive-offline.py") ||
		!validSignedDeliveryFile(d.GoInstaller, "xdrive-offline-linux-amd64") ||
		d.Manifest.SHA256 != manifestSHA || d.GoInstaller.SHA256 != installerSHA {
		return fail("signed delivery artifact identities differ")
	}
	manifestFile, manifestInfo, err := SafeFile(filepath.Join(dir, d.Manifest.Name))
	if err != nil {
		return err
	}
	hash, hashErr := HashReader(manifestFile)
	closeErr := manifestFile.Close()
	if hashErr != nil {
		return hashErr
	}
	if closeErr != nil {
		return closeErr
	}
	if manifestInfo.Size() != d.Manifest.Size || hash != d.Manifest.SHA256 {
		return fail("signed delivery Manifest digest or size mismatch")
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	self, selfInfo, err := SafeFile(executable)
	if err != nil {
		return err
	}
	selfHash, hashErr := HashReader(self)
	closeErr = self.Close()
	if hashErr != nil {
		return hashErr
	}
	if closeErr != nil {
		return closeErr
	}
	if selfInfo.Size() != d.GoInstaller.Size || selfHash != d.GoInstaller.SHA256 {
		return fail("running Go installer differs from signed delivery identity")
	}
	return nil
}
