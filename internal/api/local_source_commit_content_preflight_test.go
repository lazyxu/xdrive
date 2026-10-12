package api

import (
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
)

func TestLocalQuarantinedEvidenceMustMatchExactPersistedScope(t *testing.T) {
	sourceID, revision := uint64(14), uint64(9)
	proof := localSourceExecutorProof{DeviceID: "own-device", RootID: "own-root", SourceRevision: revision}
	fingerprint := strings.Repeat("a", 64)
	ev := meta.LocalSourceItemEvidence{
		ID: 5, SourceID: sourceID, SourceRevision: revision,
		SourceItemID: 91, DeviceID: proof.DeviceID,
		RootID: proof.RootID, RootFingerprint: fingerprint,
		PreviousSnapshotSHA256: strings.Repeat("1", 64),
		CurrentSnapshotSHA256:  strings.Repeat("2", 64),
		PreviousPathKey:        strings.Repeat("3", 64),
		CurrentPathKey:         strings.Repeat("4", 64),
		NativeIdentityKey:      strings.Repeat("5", 64),
	}
	good := meta.LocalSourceCommitIntent{
		SourceID: sourceID, SourceRevision: revision,
		EvidenceID: ev.ID, SourceItemID: ev.SourceItemID,
		DeviceID: ev.DeviceID, RootID: ev.RootID,
		RootFingerprint:        fingerprint,
		PreviousSnapshotSHA256: ev.PreviousSnapshotSHA256,
		CurrentSnapshotSHA256:  ev.CurrentSnapshotSHA256,
		PreviousPathKey:        ev.PreviousPathKey,
		CurrentPathKey:         ev.CurrentPathKey,
		NativeIdentityKey:      ev.NativeIdentityKey,
		State:                  meta.LocalSourceCommitIntentStateQuarantined,
	}
	check := func(intent meta.LocalSourceCommitIntent, candidate meta.LocalSourceItemEvidence) bool {
		return sameLocalQuarantinedEvidence(intent, candidate, sourceID, revision, proof, fingerprint)
	}
	if !check(good, ev) {
		t.Fatal("same exact quarantined evidence rejected")
	}
	for _, test := range []struct {
		name string
		edit func(*meta.LocalSourceCommitIntent)
	}{
		{"different Source", func(x *meta.LocalSourceCommitIntent) { x.SourceID++ }},
		{"stale revision", func(x *meta.LocalSourceCommitIntent) { x.SourceRevision++ }},
		{"other evidence", func(x *meta.LocalSourceCommitIntent) { x.EvidenceID++ }},
		{"other item", func(x *meta.LocalSourceCommitIntent) { x.SourceItemID++ }},
		{"other device", func(x *meta.LocalSourceCommitIntent) { x.DeviceID = "foreign" }},
		{"other Root", func(x *meta.LocalSourceCommitIntent) { x.RootID = "foreign" }},
		{"other fingerprint", func(x *meta.LocalSourceCommitIntent) { x.RootFingerprint = strings.Repeat("b", 64) }},
		{"older generation", func(x *meta.LocalSourceCommitIntent) { x.CurrentSnapshotSHA256 = strings.Repeat("6", 64) }},
		{"earlier generation", func(x *meta.LocalSourceCommitIntent) { x.PreviousSnapshotSHA256 = strings.Repeat("7", 64) }},
		{"other old path", func(x *meta.LocalSourceCommitIntent) { x.PreviousPathKey = strings.Repeat("8", 64) }},
		{"other new path", func(x *meta.LocalSourceCommitIntent) { x.CurrentPathKey = strings.Repeat("9", 64) }},
		{"other native identity", func(x *meta.LocalSourceCommitIntent) { x.NativeIdentityKey = strings.Repeat("a", 64) }},
		{"no longer quarantined", func(x *meta.LocalSourceCommitIntent) { x.State = "committed" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			bad := good
			test.edit(&bad)
			if check(bad, ev) {
				t.Fatal("changed persisted quarantine accepted")
			}
		})
	}
	changedEvidence := ev
	changedEvidence.CurrentPathKey = strings.Repeat("b", 64)
	if check(good, changedEvidence) {
		t.Fatal("tampered underlying advisory evidence accepted")
	}
	changedEvidence = ev
	changedEvidence.DeviceID = "foreign"
	if check(good, changedEvidence) {
		t.Fatal("foreign advisory evidence accepted")
	}
	changedEvidence = ev
	changedEvidence.PreviousPathKey = changedEvidence.CurrentPathKey
	if check(good, changedEvidence) {
		t.Fatal("same old and new path accepted")
	}
}

func TestQuarantinedPhysicalClaimsBoundedToFourObjectsAnd64MiB(t *testing.T) {
	base := localEvidenceCloudMetadataRequest{
		PreviousSnapshotSHA256: strings.Repeat("1", 64),
		CurrentSnapshotSHA256:  strings.Repeat("2", 64),
		Items: []localEvidenceCloudMetadataItem{
			{EvidenceID: 1, SHA256: strings.Repeat("a", 64), Size: 12},
		},
	}
	if !validLocalQuarantinedContentClaims(base) {
		t.Fatal("bounded owning-Agent physical check rejected")
	}
	invalid := []struct {
		name string
		edit func(*localEvidenceCloudMetadataRequest)
	}{
		{"no items", func(x *localEvidenceCloudMetadataRequest) { x.Items = nil }},
		{"five items", func(x *localEvidenceCloudMetadataRequest) {
			x.Items = []localEvidenceCloudMetadataItem{
				{1, strings.Repeat("a", 64), 1}, {2, strings.Repeat("a", 64), 1},
				{3, strings.Repeat("a", 64), 1}, {4, strings.Repeat("a", 64), 1},
				{5, strings.Repeat("a", 64), 1},
			}
		}},
		{"exceeds byte budget", func(x *localEvidenceCloudMetadataRequest) { x.Items[0].Size = 64<<20 + 1 }},
		{"invalid hash", func(x *localEvidenceCloudMetadataRequest) { x.Items[0].SHA256 = "bad" }},
		{"zero ID", func(x *localEvidenceCloudMetadataRequest) { x.Items[0].EvidenceID = 0 }},
		{"duplicate ID", func(x *localEvidenceCloudMetadataRequest) {
			x.Items = append(x.Items, x.Items[0])
		}},
		{"generation collision", func(x *localEvidenceCloudMetadataRequest) { x.CurrentSnapshotSHA256 = x.PreviousSnapshotSHA256 }},
	}
	for _, tt := range invalid {
		t.Run(tt.name, func(t *testing.T) {
			got := base
			got.Items = append([]localEvidenceCloudMetadataItem(nil), base.Items...)
			tt.edit(&got)
			if validLocalQuarantinedContentClaims(got) {
				t.Fatal("unsafe physical quarantine check accepted")
			}
		})
	}
}
