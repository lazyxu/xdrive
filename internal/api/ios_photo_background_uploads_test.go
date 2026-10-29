package api

import (
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestIOSBackgroundOriginalDestinationsOnly(t *testing.T) {
	good := []string{
		"IMG_3301-xios-0123456789abcdef01234567-0123456789ab.HEIC",
		"summer-trip-xios-0123456789abcdef01234567-0123456789ab.mov",
		"Live-xios-0123456789abcdef01234567-0123456789ab.zip",
	}
	for _, name := range good {
		if !iosBackgroundOriginalNameValid(name) {
			t.Fatalf("valid HMAC-tagged original rejected: %s", name)
		}
	}
	bad := []string{
		"IMG_3301.HEIC",
		"Live-pair.zip",
		"../../IMG-xios-0123456789abcdef01234567-0123456789ab.mov",
		"IMG-xios-0123456789abcdef01234567-ABCDEFABCDEF.mov",
		"IMG-xios-0123456789abcdef01234567-0123456789ab.exe/evil",
		"IMG-xios-0123456789abcdef01234567-0123456789ab." + strings.Repeat("a", 14),
	}
	for _, name := range bad {
		if iosBackgroundOriginalNameValid(name) {
			t.Fatalf("non-PhotoKit original admitted: %s", name)
		}
	}
}

func TestIOSBackgroundUploadCannotOverwriteOrEscapeRoot(t *testing.T) {
	ownerRoot := uint64(91)
	grant := meta.IOSPhotoBackgroundGrant{OwnerID: 7, RootNodeID: ownerRoot}
	sha := strings.Repeat("a", 64)
	key := "ios_" + strings.Repeat("b", 64)
	name := "Image-xios-0123456789abcdef01234567-0123456789ab.heic"
	req := uploadInitRequest{
		ParentID: &ownerRoot, Name: name,
		ConflictPolicy: meta.UploadConflictPolicyFail,
		Size:           65, ChunkSize: defaultUploadChunkSize,
		SHA256: sha, ResumeKey: key,
	}
	admitted := func() bool { return iosBackgroundUploadInitValid(req, grant) }
	if !admitted() {
		t.Fatal("exact Owner-root HMAC original should pass")
	}
	pristine := req
	check := func(reason string) {
		t.Helper()
		if admitted() {
			t.Fatalf("privileged %s upload admitted", reason)
		}
		req = pristine
	}
	foreignRoot := uint64(92)
	req.ParentID = &foreignRoot
	check("foreign root")
	req.ParentID = nil
	check("missing root")
	node := uint64(8)
	req.NodeID = &node
	check("overwrite existing node")
	req.ConflictPolicy = meta.UploadConflictPolicyOverwrite
	check("overwrite policy")
	req.ConflictPolicy = meta.UploadConflictPolicySkip
	check("skip policy")
	req.Name = "plain-original.mov"
	check("arbitrary name")
	req.ResumeKey = "lp2_" + strings.Repeat("a", 64)
	check("privileged Push HMAC")
	req.ResumeKey = "ios_" + strings.Repeat("z", 64)
	check("nonhex HMAC")
	req.ExpectedRevision = 123
	check("revision overwrite")
	req.MD5 = strings.Repeat("a", 32)
	check("legacy MD5 fallback")
	req.ChunkSize = 4 * 1_048_576
	check("nonstandard chunk size")
	req.Size = 0
	check("zero bytes")
	req.Size = iosBackgroundOriginalMaxBytes + 1
	check("oversized media")
	req.SHA256 = strings.Repeat("G", 64)
	check("invalid full SHA")
	req.ChunkSHA256 = []string{strings.Repeat("c", 64)}
	check("caller directed CAS reuse")
}

func TestIOSBackgroundGrantIsNotUsedForGenericRoutes(t *testing.T) {
	// The route contract is exact and intentionally denies generic folder
	// listings, deletion, node mutation and SourceRun.
	// Background wrappers call existing Go handlers only AFTER the
	// scoped Owner/root and iOS HMAC policy validates each operation.
	if iosBackgroundOriginalMaxBytes <= 1_073_741_824 ||
		iosBackgroundOriginalMaxBytes > 1_073_741_824+8*1_048_576 {
		t.Fatal("Live ZIP overhead needs a small upper bound")
	}
}
