package transfer

import "testing"

func TestLocalRevealRequiresAgentOwnedDirectTransfer(t *testing.T) {
	m := NewManager(20)
	file := m.Start(Spec{
		FileName:      "photo.jpg",
		Path:          "/home/test/Photos/photo.jpg",
		Kind:          KindUpload,
		Direction:     "upload",
		CloudParentID: 42,
	})
	if _, err := m.LocalRevealTask(file.ID()); err == nil {
		t.Fatal("arbitrary transfer records must not be local-revealable")
	}
	file.AllowLocalReveal()
	got, err := m.LocalRevealTask(file.ID())
	if err != nil || !got.LocalRevealable || got.Path != "/home/test/Photos/photo.jpg" {
		t.Fatalf("trusted Agent file should be locatable: %+v, %v", got, err)
	}
	file.Complete()
	got, err = m.LocalRevealTask(file.ID())
	if err != nil || !got.LocalRevealable {
		t.Fatalf("completed direct file must retain a local destination: %+v, %v", got, err)
	}

	group := m.StartGroup(Spec{FileName: "batch", Kind: KindUpload, Direction: "upload"})
	group.AllowLocalReveal()
	if _, err := m.LocalRevealTask(group.ID()); err == nil {
		t.Fatal("group transfers must not expose arbitrary local file positions")
	}

	hydration := m.Start(Spec{FileName: "sync.bin", Path: "/home/test/sync.bin",
		Kind: KindHydration, Direction: "download"})
	hydration.AllowLocalReveal()
	if _, err := m.LocalRevealTask(hydration.ID()); err == nil {
		t.Fatal("background hydration must not reveal filesystem paths")
	}
	if _, err := m.LocalRevealTask("forged-task"); err == nil {
		t.Fatal("unknown transfer ids must be rejected")
	}
}
