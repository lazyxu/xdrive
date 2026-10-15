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

func fixedCreativeInfoForHostProbe() photointelligence.CreativeAnalyzerInfo {
	return photointelligence.CreativeAnalyzerInfo{
		ProtocolVersion: photointelligence.CreativeAnalyzerProtocolVersion,
		Name:            "test-fixed-creative",
		PipelineVersion: "creative-v1",
		SegmentModel: photointelligence.FaceAnalyzerModelInfo{
			Name: "EfficientSAM", Version: "v1",
			SHA256: strings.Repeat("a", 64), License: "Apache-2.0",
		},
		Capabilities: []string{
			photointelligence.CreativeCapabilityCutout,
			photointelligence.CreativeCapabilityErase,
		},
		RuntimeInstanceID: "0123456789abcdef0123456789abcdef",
		HostApplyReceipt: &photointelligence.HostApplyReceipt{
			Revision: 7, RequestID: "0123456789abcdef01234567",
		},
	}
}

func TestPhotoHostFixedCreativeRealCutoutRequiresOriginalGeneration(t *testing.T) {
	info := fixedCreativeInfoForHostProbe()
	if err := photointelligence.ValidateCreativeAnalyzerInfo(info); err != nil {
		t.Fatal(err)
	}
	gate := meta.AdminPhotoHostApply{
		State: "host-verified", Revision: 7, RequestID: info.HostApplyReceipt.RequestID,
	}
	check := photoHostModelInfoCheck{
		ID: "photo-creative", State: "ready", runtimeInstanceID: info.RuntimeInstanceID,
		hostReceipt: info.HostApplyReceipt,
	}
	probed, read := 0, 0
	probe := func(context.Context) (bool, error) { probed++; return true, nil }
	readInfo := func(context.Context) (photointelligence.CreativeAnalyzerInfo, error) {
		read++
		return info, nil
	}
	ok, err := runPhotoHostFixedCreativeInference(
		context.Background(), check, gate, probe, readInfo,
	)
	if err != nil || !ok || probed != 1 || read != 1 {
		t.Fatalf("actual Creative cutout or post-Info missing: ok=%t calls=%d info=%d err=%v", ok, probed, read, err)
	}
	public, err := json.Marshal(adminPhotoHostPreflightDTO{CreativeCutoutTaskState: "verified"})
	if err != nil || strings.Contains(string(public), gate.RequestID) ||
		strings.Contains(string(public), info.RuntimeInstanceID) ||
		strings.Contains(string(public), "model_path") ||
		strings.Contains(string(public), "png_data") {
		t.Fatal("private Creative image or Host identity escaped administrator response")
	}

	restarted := info
	restarted.RuntimeInstanceID = strings.Repeat("b", 32)
	wrongACK := info
	wrongACK.HostApplyReceipt = &photointelligence.HostApplyReceipt{
		Revision: gate.Revision + 1, RequestID: gate.RequestID,
	}
	for name, scenario := range map[string]struct {
		check    photoHostModelInfoCheck
		gate     meta.AdminPhotoHostApply
		info     photointelligence.CreativeAnalyzerInfo
		result   bool
		probeErr error
		infoErr  error
	}{
		"missing model execution": {check, gate, info, false, nil, nil},
		"upstream task failed":    {check, gate, info, true, errors.New("private socket error"), nil},
		"Info failed":             {check, gate, info, true, nil, errors.New("private model info")},
		"restart":                 {check, gate, restarted, true, nil, nil},
		"wrong original ACK":      {check, gate, wrongACK, true, nil, nil},
		"missing ACK":             {func() photoHostModelInfoCheck { x := check; x.hostReceipt = nil; return x }(), gate, info, true, nil, nil},
		"wrong service":           {func() photoHostModelInfoCheck { x := check; x.ID = "photo-smart"; return x }(), gate, info, true, nil, nil},
		"unaudited":               {check, meta.AdminPhotoHostApply{State: "queued", Revision: 7, RequestID: gate.RequestID}, info, true, nil, nil},
	} {
		t.Run(name, func(t *testing.T) {
			accepted, _ := runPhotoHostFixedCreativeInference(
				context.Background(), scenario.check, scenario.gate,
				func(context.Context) (bool, error) { return scenario.result, scenario.probeErr },
				func(context.Context) (photointelligence.CreativeAnalyzerInfo, error) {
					return scenario.info, scenario.infoErr
				},
			)
			if accepted {
				t.Fatal("unverified or failed Creative synthetic cutout was accepted")
			}
		})
	}
	if accepted, err := runPhotoHostFixedCreativeInference(
		context.Background(), check, gate,
		func(context.Context) (bool, error) {
			return false, photointelligence.ErrCreativeCutoutCanaryUnavailable
		}, readInfo,
	); accepted || !errors.Is(err, photointelligence.ErrCreativeCutoutCanaryUnavailable) {
		t.Fatal("old model missing private probe was treated as a failed or successful real inference")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	if accepted, _ := runPhotoHostFixedCreativeInference(ctx, check, gate,
		func(context.Context) (bool, error) { called = true; return true, nil },
		readInfo,
	); accepted || called {
		t.Fatal("canceled Creative diagnostic performed model inference")
	}
}
