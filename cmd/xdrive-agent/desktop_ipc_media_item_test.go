package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDesktopIPCMediaItemValidatesNodeID(t *testing.T) {
	handler := &desktopIPCHandler{}
	cases := []struct {
		name     string
		path     string
		expected int
	}{
		{name: "missing id", path: "/v1/media/item", expected: http.StatusBadRequest},
		{name: "zero", path: "/v1/media/item?node_id=0", expected: http.StatusBadRequest},
		{name: "negative", path: "/v1/media/item?node_id=-1", expected: http.StatusBadRequest},
		{name: "invalid", path: "/v1/media/item?node_id=nan", expected: http.StatusBadRequest},
		{name: "overflow", path: "/v1/media/item?node_id=18446744073709551616", expected: http.StatusBadRequest},
		{name: "unsupported controller", path: "/v1/media/item?node_id=1", expected: http.StatusNotImplemented},
	}
	for _, testcase := range cases {
		t.Run(testcase.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, testcase.path, nil)
			recorder := httptest.NewRecorder()
			handler.mediaItem(recorder, req)
			if recorder.Code != testcase.expected {
				t.Fatalf("status = %d, want %d: %s", recorder.Code, testcase.expected, recorder.Body.String())
			}
		})
	}
}
