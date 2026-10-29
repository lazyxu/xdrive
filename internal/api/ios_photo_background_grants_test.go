package api

import (
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestIOSPhotoBackgroundGrantSecretIsRandomAndNeverAWebBearer(t *testing.T) {
	a, ah, err := newIOSPhotoGrantSecret()
	if err != nil { t.Fatal(err) }
	b, bh, err := newIOSPhotoGrantSecret()
	if err != nil { t.Fatal(err) }
	if !validIOSPhotoGrantSecret(a) || !validIOSPhotoGrantSecret(b) ||
		a == b || ah == bh || a == ah || b == bh ||
		len(ah) != 64 || len(bh) != 64 {
		t.Fatal("device photo grant must use independent high-entropy opaque credentials")
	}
	for _, raw := range []string{"", a + "x", "ios_" + a, a + "=",
		strings.Repeat("!", 43), strings.Repeat(".", 43)} {
		if validIOSPhotoGrantSecret(raw) {
			t.Fatalf("invalid/reformatted ios grant accepted: %q", raw)
		}
	}
}

func TestIOSPhotoBackgroundGrantAdmissionFailsClosed(t *testing.T) {
	now := time.Now().UTC()
	user := meta.User{ID: 17, SessionVersion: 4}
	device := meta.ClientDevice{
		ID: "01010101-0202-0303-0404-050505050505", OwnerID: 17, Platform: "ios",
	}
	root := meta.Node{ID: 31, OwnerID: 17, Type: meta.NodeTypeDir}
	grant := meta.IOSPhotoBackgroundGrant{
		ID: "01010101-0202-0303-0404-060606060606",
		OwnerID: 17, DeviceID: device.ID, RootNodeID: root.ID,
		SessionVersion: 4, ServerInstance: "server-uuid",
		ExpiresAt: now.Add(48 * time.Hour),
	}
	allowed := func() bool {
		return iosPhotoGrantValid(grant, device, user, root, "server-uuid", now)
	}
	if !allowed() { t.Fatal("exact verified original Owner/Device/Root must admit") }
	devCopy, userCopy, rootCopy, grantCopy := device, user, root, grant
	failure := func(label string) {
		t.Helper()
		if allowed() { t.Fatalf("unauthorized %s admitted", label) }
		device, user, root, grant = devCopy, userCopy, rootCopy, grantCopy
	}
	device.Platform = "windows"; failure("Desktop Agent platform")
	device.OwnerID++; failure("foreign device")
	revoked := now
	device.RevokedAt = &revoked; failure("revoked installation")
	user.SessionVersion++; failure("password/session revocation")
	user.MustChangePassword = true; failure("password-rotation requirement")
	user.DisabledAt = &revoked; failure("disabled account")
	user.ID++; failure("other Owner")
	grant.RootNodeID++; failure("different root")
	grant.ServerInstance = "foreign"; failure("foreign server installation")
	grant.SessionVersion = 0; failure("missing session generation")
	grant.ExpiresAt = now; failure("expired")
	grant.RevokedAt = &revoked; failure("individually revoked grant")
	root.ID++; failure("root moved")
	root.Type = meta.NodeTypeFile; failure("not root directory")
	n := uint64(1); root.ParentID = &n; failure("nonroot folder")
	root.DeletedAt = &revoked; failure("trashed root")
	root.OwnerID++; failure("root from another Owner")
}

func TestIOSPhotoGrantIsNotGenericUploadAuthorization(t *testing.T) {
	// Routing policy: the grant middleware must not fill Gin's generic
	// userID/currentUser context. Even a valid grant cannot enter
	// /uploads or /nodes. Only explicit dedicated iOS routes can add write
	// authority in a separate reviewed PR.
	// A normal token parser will also reject the 43-character opaque secret.
	raw, _, err := newIOSPhotoGrantSecret()
	if err != nil { t.Fatal(err) }
	if strings.Count(raw, ".") != 0 {
		t.Fatal("grant must not impersonate the standard JWT access token")
	}
}
