package sourceagent

import "testing"

func TestRootSetIdentityIsOrderIndependentAndDetectsRootChanges(t *testing.T) {
	personal := Root{Key: "personal", ExpectedID: "fs:personal:11", ExpectedFingerprint: "root:btime:personal:11:22:33"}
	shared := Root{Key: "shared", ExpectedID: "fs:shared:22", ExpectedFingerprint: "root:btime:shared:22:33:44"}
	id1, fingerprint1, err := RootSetIdentity([]Root{personal, shared})
	if err != nil {
		t.Fatal(err)
	}
	id2, fingerprint2, err := RootSetIdentity([]Root{shared, personal})
	if err != nil {
		t.Fatal(err)
	}
	if id1 != id2 || fingerprint1 != fingerprint2 {
		t.Fatalf("root set identity depends on input order: (%s,%s) != (%s,%s)", id1, fingerprint1, id2, fingerprint2)
	}
	changed := shared
	changed.ExpectedFingerprint += ":changed"
	_, fingerprint3, err := RootSetIdentity([]Root{personal, changed})
	if err != nil {
		t.Fatal(err)
	}
	if fingerprint1 == fingerprint3 {
		t.Fatal("root fingerprint did not change after Shared root identity changed")
	}
}

func TestRootSetIdentityRejectsMissingAndDuplicateRoots(t *testing.T) {
	if _, _, err := RootSetIdentity(nil); err == nil {
		t.Fatal("empty root set was accepted")
	}
	root := Root{Key: "personal", ExpectedID: "fs:1", ExpectedFingerprint: "root:1"}
	if _, _, err := RootSetIdentity([]Root{root, root}); err == nil {
		t.Fatal("duplicate root key was accepted")
	}
	if _, _, err := RootSetIdentity([]Root{{Key: "personal", ExpectedID: "fs:1"}}); err == nil {
		t.Fatal("root without fingerprint was accepted")
	}
}
