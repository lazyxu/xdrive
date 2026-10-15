package api

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/lazyxu/xdrive/internal/meta"
	"github.com/lazyxu/xdrive/internal/photointelligence"
)

func fixedFaceInfoForHostProbe() photointelligence.FaceAnalyzerInfo {
	model := photointelligence.FaceAnalyzerModelInfo{
		Name:    "fixed-test-model",
		Version: "v1",
		SHA256:  strings.Repeat("a", 64),
		License: "Apache-2.0",
	}
	return photointelligence.FaceAnalyzerInfo{
		ProtocolVersion:     photointelligence.FaceAnalyzerProtocolVersion,
		Name:                "test-face",
		PipelineVersion:     "face-v1",
		Detector:            model,
		Embedding:           model,
		EmbeddingFormat:     "f32le",
		EmbeddingDimensions: 128,
		RuntimeInstanceID:   "0123456789abcdef0123456789abcdef",
		HostApplyReceipt: &photointelligence.HostApplyReceipt{
			Revision: 7, RequestID: "0123456789abcdef01234567",
		},
	}
}

func TestPhotoHostFixedFaceDetectorExecutesAndPreservesZeroFaceBoundary(t *testing.T) {
	info := fixedFaceInfoForHostProbe()
	gate := meta.AdminPhotoHostApply{
		State: "host-verified", Revision: 7, RequestID: info.HostApplyReceipt.RequestID,
	}
	check := photoHostModelInfoCheck{
		ID: "photo-face", State: "ready", runtimeInstanceID: info.RuntimeInstanceID,
		hostReceipt: info.HostApplyReceipt,
	}
	calls, reads := 0, 0
	probe := func(context.Context) (photointelligence.FaceDetectorCanary, error) {
		calls++
		return photointelligence.FaceDetectorCanary{DetectorExecuted: true, FaceCount: 0}, nil
	}
	read := func(context.Context) (photointelligence.FaceAnalyzerInfo, error) {
		reads++
		return info, nil
	}
	if !runPhotoHostFixedFaceDetectorInference(context.Background(), check, gate, probe, read) ||
		calls != 1 || reads != 1 {
		t.Fatalf("model detector was not run or same-generation Info was skipped: calls=%d Info=%d", calls, reads)
	}
	// The operator never receives result counts, model credentials or nonces.
	raw, err := json.Marshal(adminPhotoHostPreflightDTO{
		FaceDetectorTaskState: "verified", SFaceTaskState: "verified",
	})
	if err != nil || strings.Contains(string(raw), gate.RequestID) ||
		strings.Contains(string(raw), info.RuntimeInstanceID) ||
		strings.Contains(string(raw), "face_count") {
		t.Fatal("private face detection or host identity escaped admin DTO")
	}

	for name, bad := range map[string]struct {
		check    photoHostModelInfoCheck
		gate     meta.AdminPhotoHostApply
		info     photointelligence.FaceAnalyzerInfo
		result   photointelligence.FaceDetectorCanary
		probeErr error
		infoErr  error
	}{
		"no executed detector": {check, gate, info, photointelligence.FaceDetectorCanary{FaceCount: 0}, nil, nil},
		"negative count":       {check, gate, info, photointelligence.FaceDetectorCanary{DetectorExecuted: true, FaceCount: -1}, nil, nil},
		"excessive count":      {check, gate, info, photointelligence.FaceDetectorCanary{DetectorExecuted: true, FaceCount: photointelligence.MaxFacesPerImage + 1}, nil, nil},
		"upstream error":       {check, gate, info, photointelligence.FaceDetectorCanary{DetectorExecuted: true}, errors.New("private-socket"), nil},
		"Info recheck error":   {check, gate, info, photointelligence.FaceDetectorCanary{DetectorExecuted: true}, nil, errors.New("secret-info")},
		"new process generation": {check, gate, func() photointelligence.FaceAnalyzerInfo {
			x := info
			x.RuntimeInstanceID = strings.Repeat("a", 32)
			return x
		}(), photointelligence.FaceDetectorCanary{DetectorExecuted: true}, nil, nil},
		"wrong original request": {check, gate, func() photointelligence.FaceAnalyzerInfo {
			x := info
			x.HostApplyReceipt = &photointelligence.HostApplyReceipt{Revision: 8, RequestID: gate.RequestID}
			return x
		}(), photointelligence.FaceDetectorCanary{DetectorExecuted: true}, nil, nil},
		"missing Info receipt": {check, gate, func() photointelligence.FaceAnalyzerInfo {
			x := info
			x.HostApplyReceipt = nil
			return x
		}(), photointelligence.FaceDetectorCanary{DetectorExecuted: true}, nil, nil},
		"missing expected ACK": {func() photoHostModelInfoCheck {
			x := check
			x.hostReceipt = nil
			return x
		}(), gate, info, photointelligence.FaceDetectorCanary{DetectorExecuted: true}, nil, nil},
		"unverified gate": {check, meta.AdminPhotoHostApply{State: "queued", Revision: 7, RequestID: gate.RequestID},
			info, photointelligence.FaceDetectorCanary{DetectorExecuted: true}, nil, nil},
	} {
		t.Run(name, func(t *testing.T) {
			if runPhotoHostFixedFaceDetectorInference(context.Background(), bad.check, bad.gate,
				func(context.Context) (photointelligence.FaceDetectorCanary, error) {
					return bad.result, bad.probeErr
				},
				func(context.Context) (photointelligence.FaceAnalyzerInfo, error) {
					return bad.info, bad.infoErr
				},
			) {
				t.Fatal("unverified YuNet detector was reported successful")
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	if runPhotoHostFixedFaceDetectorInference(ctx, check, gate,
		func(context.Context) (photointelligence.FaceDetectorCanary, error) {
			called = true
			return photointelligence.FaceDetectorCanary{DetectorExecuted: true}, nil
		},
		read,
	) || called {
		t.Fatal("canceled preflight started face detection")
	}
}

func TestPhotoHostSFaceSyntheticProofRequiresOriginalGeneration(t *testing.T) {
	info := fixedFaceInfoForHostProbe()
	gate := meta.AdminPhotoHostApply{
		State: "host-verified", Revision: 7, RequestID: info.HostApplyReceipt.RequestID,
	}
	check := photoHostModelInfoCheck{
		ID: "photo-face", State: "ready", runtimeInstanceID: info.RuntimeInstanceID,
		hostReceipt: info.HostApplyReceipt,
	}
	yes, no := true, false
	read := func(context.Context) (photointelligence.FaceAnalyzerInfo, error) { return info, nil }
	for _, scenario := range []struct {
		name    string
		value   *bool
		outcome string
	}{
		{"genuine feature", &yes, "verified"},
		{"failed feature", &no, "failed"},
		{"legacy model", nil, "unverified"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			calls := 0
			executed, feature := runPhotoHostFixedFaceDetectorInferenceWithSFace(
				context.Background(), check, gate,
				func(context.Context) (photointelligence.FaceDetectorCanary, error) {
					calls++
					return photointelligence.FaceDetectorCanary{
						DetectorExecuted: true, FaceCount: 0, SFaceEmbeddingValid: scenario.value,
					}, nil
				}, read,
			)
			if !executed || calls != 1 || feature != scenario.value ||
				photoHostSFaceSyntheticState(feature) != scenario.outcome {
				t.Fatalf("SFace status was not independently validated: valid=%v calls=%d result=%s",
					executed, calls, photoHostSFaceSyntheticState(feature))
			}
		})
	}
	probe := func(context.Context) (photointelligence.FaceDetectorCanary, error) {
		return photointelligence.FaceDetectorCanary{
			DetectorExecuted: true, FaceCount: 0, SFaceEmbeddingValid: &yes,
		}, nil
	}
	check.hostReceipt = nil
	if executed, feature := runPhotoHostFixedFaceDetectorInferenceWithSFace(
		context.Background(), check, gate, probe, read,
	); executed || feature != nil {
		t.Fatal("SFace success was accepted without audited Host Apply receipt")
	}
	check.hostReceipt = info.HostApplyReceipt
	restarted := info
	restarted.RuntimeInstanceID = strings.Repeat("f", 32)
	if executed, feature := runPhotoHostFixedFaceDetectorInferenceWithSFace(
		context.Background(), check, gate, probe,
		func(context.Context) (photointelligence.FaceAnalyzerInfo, error) { return restarted, nil },
	); executed || feature != nil {
		t.Fatal("SFace success survived a restarted model generation")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	if executed, feature := runPhotoHostFixedFaceDetectorInferenceWithSFace(
		ctx, check, gate,
		func(context.Context) (photointelligence.FaceDetectorCanary, error) {
			called = true
			return photointelligence.FaceDetectorCanary{SFaceEmbeddingValid: &yes}, nil
		}, read,
	); executed || feature != nil || called {
		t.Fatal("a canceled SFace canary was marked verified")
	}
}
