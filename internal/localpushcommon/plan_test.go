package localpushcommon

import (
	"errors"
	"strings"
	"testing"
)

func fixturePlan() Plan {
	return Plan{
		Server: "https://server.test", Account: "alice", OwnerSession: "sess-a",
		DeviceID:        "12345678-1234-1234-1234-123456789abc",
		RootID:          "23456789-1234-1234-1234-123456789abc",
		RootFingerprint: strings.Repeat("a", 64),
		SourceID:        42, SourceRevision: 7,
		OperationID:  "34567890-1234-1234-1234-123456789abc",
		RelativePath: "nested/hello.txt", NativeIdentityKey: strings.Repeat("b", 64),
		ContentSHA256: strings.Repeat("c", 64), Size: 512,
		Target: Target{ParentID: 55, Name: "hello.txt"},
	}
}

func TestCommonResumeKeyStableAndScoped(t *testing.T) {
	base := fixturePlan()
	original, err := base.ResumeKey()
	if err != nil {
		t.Fatal(err)
	}
	again, err := base.ResumeKey()
	if err != nil || again != original {
		t.Fatalf("unstable retry identity %q %v", again, err)
	}
	if len(original) != 68 || !strings.HasPrefix(original, "lp2_") || strings.Contains(original, "hello") {
		t.Fatalf("unexpected key %q", original)
	}
	variants := []func(*Plan){
		func(p *Plan) { p.Account = "bob" },
		func(p *Plan) { p.OwnerSession = "sess-b" },
		func(p *Plan) { p.DeviceID = "22345678-1234-1234-1234-123456789abc" },
		func(p *Plan) { p.RootID = "33456789-1234-1234-1234-123456789abc" },
		func(p *Plan) { p.RootFingerprint = strings.Repeat("d", 64) },
		func(p *Plan) { p.SourceID++ },
		func(p *Plan) { p.SourceRevision++ },
		func(p *Plan) { p.OperationID = "44567890-1234-1234-1234-123456789abc" },
		func(p *Plan) { p.RelativePath = "other/hello.txt" },
		func(p *Plan) { p.NativeIdentityKey = strings.Repeat("e", 64) },
		func(p *Plan) { p.ContentSHA256 = strings.Repeat("f", 64) },
		func(p *Plan) { p.Size++ },
		func(p *Plan) { p.Target.ParentID++ },
	}
	for i, change := range variants {
		candidate := base
		change(&candidate)
		key, err := candidate.ResumeKey()
		if err != nil || key == original {
			t.Fatalf("case %d reused another operation: %v", i, err)
		}
	}
}

func TestCommonPlanFailsClosed(t *testing.T) {
	base := fixturePlan()
	variants := []func(*Plan){
		func(p *Plan) { p.Server = "" },
		func(p *Plan) { p.Account = "alice\nnew" },
		func(p *Plan) { p.DeviceID = "not-uuid" },
		func(p *Plan) { p.SourceRevision = 0 },
		func(p *Plan) { p.OperationID = "" },
		func(p *Plan) { p.NativeIdentityKey = "untrusted" },
		func(p *Plan) { p.ContentSHA256 = strings.Repeat("A", 64) },
		func(p *Plan) { p.RelativePath = "../hello.txt" },
		func(p *Plan) { p.RelativePath = "/etc/passwd" },
		func(p *Plan) { p.RelativePath = "nested\\hello.txt" },
		func(p *Plan) { p.RelativePath = "nested//hello.txt" },
		func(p *Plan) { p.Size = -1 },
		func(p *Plan) { p.Target.NodeID = 1 },
		func(p *Plan) { p.Target.Name = "other.txt" },
		func(p *Plan) { p.Target.ExpectedRevision = 5 },
	}
	for i, change := range variants {
		p := base
		change(&p)
		if _, err := p.ResumeKey(); !errors.Is(err, ErrInvalidPlan) {
			t.Fatalf("case %d accepted invalid plan: %v", i, err)
		}
	}
	update := base
	update.Target = Target{NodeID: 92, ExpectedRevision: 3}
	if _, err := update.ResumeKey(); err != nil {
		t.Fatal(err)
	}
}
