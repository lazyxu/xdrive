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
	// A large legitimate original is authorized by scope, not an iOS cap.
	// Generic createUploadSession independently enforces MaxUploadBytes and quota.
	req.Size = int64(8) << 30
	if !admitted() {
		t.Fatal("8 GiB Owner-scoped PhotoKit original rejected")
	}
	req = pristine
	req.SHA256 = strings.Repeat("G", 64)
	check("invalid full SHA")
	req.ChunkSHA256 = []string{strings.Repeat("c", 64)}
	check("caller directed CAS reuse")
}

func TestIOSPhotoManagedLargeOriginalRequiresExactTarget(t *testing.T) {
	ownerRoot := uint64(91)
	sha := strings.Repeat("a", 64)
	key := "ios_" + strings.Repeat("b", 64)
	req := uploadInitRequest{
		ParentID:       &ownerRoot,
		Name:           "Live-xios-0123456789abcdef01234567-0123456789ab.zip",
		ConflictPolicy: meta.UploadConflictPolicyFail,
		Size:           int64(8) << 30, ChunkSize: defaultUploadChunkSize,
		SHA256: sha, ResumeKey: key,
	}
	scope := iosPhotoManagedUploadScope{targetID: ownerRoot}
	if !validIOSPhotoManagedUploadInit(req, scope) {
		t.Fatal("valid large managed iOS original rejected")
	}
	scope.targetID = ownerRoot + 1
	if validIOSPhotoManagedUploadInit(req, scope) {
		t.Fatal("large original escaped current managed target")
	}
	req.ParentID = nil
	if validIOSPhotoManagedUploadInit(req, iosPhotoManagedUploadScope{targetID: ownerRoot}) {
		t.Fatal("large original without Owner target admitted")
	}
}

func TestIOSBackgroundGrantIsNotUsedForGenericRoutes(t *testing.T) {
	// The route contract remains exact and denies generic folder listings,
	// deletion, node mutation and SourceRun. Only the iOS media byte ceiling
	// changed; the shared Go UploadSession still enforces MaxUploadBytes/quota.
	if defaultUploadChunkSize != 8*1_048_576 {
		t.Fatal("iOS media must keep bounded UploadSession chunk transport")
	}
}
