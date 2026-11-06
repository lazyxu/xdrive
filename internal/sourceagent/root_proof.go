package sourceagent

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
)

// RootSetIdentity creates one stable server-verifiable identity for all
// configured Synology Photos roots. RootID binds the root identities; the
// fingerprint changes if any root's filesystem fingerprint changes.
func RootSetIdentity(roots []Root) (string, string, error) {
	if len(roots) == 0 || len(roots) > 2 {
		return "", "", fmt.Errorf("one or two Synology roots are required")
	}
	ordered := append([]Root(nil), roots...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Key < ordered[j].Key })

	seen := make(map[string]struct{}, len(ordered))
	identityParts := make([]string, 0, len(ordered))
	fingerprintParts := make([]string, 0, len(ordered))
	for _, root := range ordered {
		key := strings.TrimSpace(root.Key)
		rootID := strings.TrimSpace(root.ExpectedID)
		fingerprint := strings.TrimSpace(root.ExpectedFingerprint)
		if (key != "personal" && key != "shared") || rootID == "" || fingerprint == "" {
			return "", "", fmt.Errorf("Synology root key, filesystem identity and fingerprint are required")
		}
		if _, exists := seen[key]; exists {
			return "", "", fmt.Errorf("duplicate Synology root %q", key)
		}
		seen[key] = struct{}{}
		identityParts = append(identityParts, key+"\n"+rootID)
		fingerprintParts = append(fingerprintParts, key+"\n"+rootID+"\n"+fingerprint)
	}
	rootUUID := uuid.NewSHA1(uuid.NameSpaceOID, []byte(strings.Join(identityParts, "\n--\n")))
	sum := sha256.Sum256([]byte(strings.Join(fingerprintParts, "\n--\n")))
	return rootUUID.String(), hex.EncodeToString(sum[:]), nil
}
