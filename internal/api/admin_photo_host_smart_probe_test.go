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

func fixedSmartInfoForHostProbe() photointelligence.SmartAnalyzerInfo {
	model := photointelligence.FaceAnalyzerModelInfo{
		Name: "test", Version: "v1", SHA256: strings.Repeat("a", 64), License: "MIT",
	}
	return photointelligence.SmartAnalyzerInfo{
		ProtocolVersion: photointelligence.SmartAnalyzerProtocolVersion,
		Name:            "smart-test", PipelineVersion: "v1",
		Classifier: model, TextDetector: model, TextRecognizer: model,
		OCRLanguage:       "zh-en",
		RuntimeInstanceID: "0123456789abcdef0123456789abcdef",
		HostApplyReceipt: &photointelligence.HostApplyReceipt{
			Revision: 7, RequestID: "0123456789abcdef01234567",
		},
	}
}

func TestPhotoHostSmartModelThreePathsRequireAttestedGeneration(t *testing.T) {
	info := fixedSmartInfoForHostProbe()
	gate := meta.AdminPhotoHostApply{
		State: "host-verified", Revision: 7, RequestID: info.HostApplyReceipt.RequestID,
	}
	check := photoHostModelInfoCheck{
		ID: "photo-smart", State: "ready", runtimeInstanceID: info.RuntimeInstanceID,
		hostReceipt: info.HostApplyReceipt,
	}
	valid := photointelligence.SmartModelCanary{
		ClassifierExecuted: true, OCRDetectorExecuted: true, OCRRecognizerExecuted: true,
		LabelCount: 0, OCRRegionCount: 0, OCRCharCount: 0,
	}
	inferCalls, infoCalls := 0, 0
	probe := func(context.Context) (photointelligence.SmartModelCanary, error) {
		inferCalls++
		return valid, nil
	}
	read := func(context.Context) (photointelligence.SmartAnalyzerInfo, error) {
		infoCalls++
		return info, nil
	}
	if !runPhotoHostFixedSmartInference(context.Background(), check, gate, probe, read) ||
		inferCalls != 1 || infoCalls != 1 {
		t.Fatalf("Smart models were not executed/rechecked: calls=%d info=%d", inferCalls, infoCalls)
	}
	raw, err := json.Marshal(adminPhotoHostPreflightDTO{SmartModelTaskState: "verified"})
	if err != nil || strings.Contains(string(raw), info.RuntimeInstanceID) ||
		strings.Contains(string(raw), gate.RequestID) ||
		strings.Contains(string(raw), "ocr_text") || strings.Contains(string(raw), "region_count") {
		t.Fatal("private Smart model state leaked into admin result")
	}

	invalid := []struct {
		name   string
		mutate func(*photointelligence.SmartModelCanary)
	}{
		{"classifier missing", func(x *photointelligence.SmartModelCanary) { x.ClassifierExecuted = false }},
		{"OCR detector missing", func(x *photointelligence.SmartModelCanary) { x.OCRDetectorExecuted = false }},
		{"CRNN recognizer missing", func(x *photointelligence.SmartModelCanary) { x.OCRRecognizerExecuted = false }},
		{"negative labels", func(x *photointelligence.SmartModelCanary) { x.LabelCount = -1 }},
		{"excess labels", func(x *photointelligence.SmartModelCanary) { x.LabelCount = 17 }},
		{"negative regions", func(x *photointelligence.SmartModelCanary) { x.OCRRegionCount = -1 }},
		{"excess regions", func(x *photointelligence.SmartModelCanary) { x.OCRRegionCount = 201 }},
		{"negative char count", func(x *photointelligence.SmartModelCanary) { x.OCRCharCount = -1 }},
		{"excess char count", func(x *photointelligence.SmartModelCanary) { x.OCRCharCount = photointelligence.MaxSmartOCRRunes + 1 }},
	}
	for _, tc := range invalid {
		t.Run(tc.name, func(t *testing.T) {
			item := valid
			tc.mutate(&item)
			if runPhotoHostFixedSmartInference(context.Background(), check, gate,
				func(context.Context) (photointelligence.SmartModelCanary, error) { return item, nil }, read,
			) {
				t.Fatal("unverified Smart result was counted as success")
			}
		})
	}
	check.hostReceipt = nil
	if runPhotoHostFixedSmartInference(context.Background(), check, gate, probe, read) {
		t.Fatal("missing original request ACK accepted")
	}
	check.hostReceipt = info.HostApplyReceipt
	otherInfo := info
	otherInfo.RuntimeInstanceID = strings.Repeat("f", 32)
	if runPhotoHostFixedSmartInference(context.Background(), check, gate, probe,
		func(context.Context) (photointelligence.SmartAnalyzerInfo, error) { return otherInfo, nil },
	) {
		t.Fatal("restarted model generation accepted")
	}
	if runPhotoHostFixedSmartInference(context.Background(), check, gate,
		func(context.Context) (photointelligence.SmartModelCanary, error) {
			return valid, errors.New("secret path")
		}, read,
	) {
		t.Fatal("upstream failure accepted")
	}
	if runPhotoHostFixedSmartInference(context.Background(), check, gate, probe,
		func(context.Context) (photointelligence.SmartAnalyzerInfo, error) {
			return info, errors.New("private token")
		},
	) {
		t.Fatal("post-inference Info failure accepted")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	if runPhotoHostFixedSmartInference(ctx, check, gate,
		func(context.Context) (photointelligence.SmartModelCanary, error) { called = true; return valid, nil }, read,
	) || called {
		t.Fatal("canceled request executed the Smart model")
	}
}
