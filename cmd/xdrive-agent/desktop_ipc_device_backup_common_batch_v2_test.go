package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLocalCommonBatchIPCRequestNeverAcceptsLocalPathOrOtherSelectors(t *testing.T) {
	valid := httptest.NewRequest(http.MethodPost,
		"http://localhost/v1/device-backups/local-common-batch?source_id=42", nil)
	if source, ok := validLocalCommonBatchRequest(valid); !ok || source != 42 {
		t.Fatal("owning Desktop source selector unavailable")
	}
	for _, url := range []string{
		"http://localhost/v1/device-backups/local-common-batch?source_id=0",
		"http://localhost/v1/device-backups/local-common-batch?source_id=abc",
		"http://localhost/v1/device-backups/local-common-batch?source_id=42&path=/tmp/private",
		"http://localhost/v1/device-backups/local-common-batch?source_id=42&source_id=43",
		"http://localhost/v1/device-backups/local-common-batch?operation_id=abcd",
	} {
		r := httptest.NewRequest(http.MethodPost, url, nil)
		if _, ok := validLocalCommonBatchRequest(r); ok {
			t.Fatalf("untrusted renderer file selector accepted: %s", url)
		}
	}
}
