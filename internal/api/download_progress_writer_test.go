package api

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestDownloadProgressWriterCountsOnlySuccessfulResponseBytes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	response := &shortDownloadResponse{ResponseRecorder: httptest.NewRecorder(), limit: 3}
	context, _ := gin.CreateTestContext(response)
	var counted int64
	writer := &downloadProgressWriter{
		ResponseWriter: context.Writer,
		request:        httptest.NewRequest(http.MethodGet, "/download", nil),
		onWrite:        func(n int64) { counted += n },
	}
	n, err := writer.Write([]byte("abcdef"))
	if n != 3 || !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("short network write changed: n=%d err=%v", n, err)
	}
	if counted != 3 || writer.bytesSent != 3 {
		t.Fatalf("successful response bytes=%d, writer=%d; wanted 3, not the 6 source bytes", counted, writer.bytesSent)
	}
	state, _ := writer.result(nil)
	if state != "failed" {
		t.Fatalf("short network write state=%q, wanted failed", state)
	}
}

func TestDownloadProgressWriterPreservesServeContentSemantics(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name    string
		method  string
		headers map[string]string
		status  int
		body    string
		count   int64
		state   string
	}{
		{name: "file", method: http.MethodGet, status: http.StatusOK, body: "0123456789", count: 10, state: "completed"},
		{name: "head", method: http.MethodHead, status: http.StatusOK},
		{name: "range", method: http.MethodGet, headers: map[string]string{"Range": "bytes=3-6"}, status: http.StatusPartialContent, body: "3456", count: 4, state: "completed"},
		{name: "not modified", method: http.MethodGet, headers: map[string]string{"If-None-Match": `"revision"`}, status: http.StatusNotModified},
		{name: "precondition", method: http.MethodGet, headers: map[string]string{"If-Match": `"other"`}, status: http.StatusPreconditionFailed},
		{name: "invalid range", method: http.MethodGet, headers: map[string]string{"Range": "bytes=30-40"}, status: http.StatusRequestedRangeNotSatisfiable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			req := httptest.NewRequest(tc.method, "/download", nil)
			for key, value := range tc.headers {
				req.Header.Set(key, value)
			}
			var sent int64
			writer := &downloadProgressWriter{ResponseWriter: context.Writer, request: req, onWrite: func(n int64) { sent += n }}
			writer.Header().Set("ETag", `"revision"`)
			http.ServeContent(writer, req, "data.txt", time.Unix(123456, 0), bytes.NewReader([]byte("0123456789")))
			context.Writer.WriteHeaderNow()
			if response.Code != tc.status {
				t.Fatalf("status=%d wanted %d", response.Code, tc.status)
			}
			if tc.status < 400 && response.Body.String() != tc.body {
				t.Fatalf("body=%q wanted %q", response.Body.String(), tc.body)
			}
			if sent != tc.count {
				t.Fatalf("counted %d response bytes, wanted %d", sent, tc.count)
			}
			state, _ := writer.result(nil)
			if state != tc.state {
				t.Fatalf("state=%q wanted %q", state, tc.state)
			}
			if tc.status == http.StatusPartialContent && response.Header().Get("Content-Range") != "bytes 3-6/10" {
				t.Fatalf("range header=%q", response.Header().Get("Content-Range"))
			}
		})
	}
}

func TestDownloadProgressWriterCountsMultipartRangeFraming(t *testing.T) {
	gin.SetMode(gin.TestMode)
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	req := httptest.NewRequest(http.MethodGet, "/download", nil)
	req.Header.Set("Range", "bytes=0-1,7-9")
	var sent int64
	writer := &downloadProgressWriter{ResponseWriter: context.Writer, request: req, onWrite: func(n int64) { sent += n }}
	http.ServeContent(writer, req, "data.txt", time.Time{}, strings.NewReader("0123456789"))
	if response.Code != http.StatusPartialContent || !strings.HasPrefix(response.Header().Get("Content-Type"), "multipart/byteranges;") {
		t.Fatalf("multipart response=%d %v", response.Code, response.Header())
	}
	if sent != int64(response.Body.Len()) || sent <= 5 {
		t.Fatalf("counted %d; wanted all %d response bytes including range framing", sent, response.Body.Len())
	}
}

func TestDownloadProgressWriterCountsWriteStringAndEmptyResponse(t *testing.T) {
	gin.SetMode(gin.TestMode)
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	var sent int64
	writer := &downloadProgressWriter{ResponseWriter: context.Writer, request: httptest.NewRequest(http.MethodGet, "/", nil), onWrite: func(n int64) { sent += n }}
	if _, err := writer.WriteString("hello"); err != nil {
		t.Fatal(err)
	}
	if sent != 5 {
		t.Fatalf("WriteString counted=%d, wanted 5", sent)
	}

	empty, _ := gin.CreateTestContext(httptest.NewRecorder())
	emptyWriter := &downloadProgressWriter{ResponseWriter: empty.Writer, request: httptest.NewRequest(http.MethodGet, "/", nil)}
	http.ServeContent(emptyWriter, emptyWriter.request, "empty.txt", time.Time{}, strings.NewReader(""))
	state, _ := emptyWriter.result(nil)
	if state != "completed" || emptyWriter.bytesSent != 0 {
		t.Fatalf("empty download state=%q bytes=%d", state, emptyWriter.bytesSent)
	}
}

type shortDownloadResponse struct {
	*httptest.ResponseRecorder
	limit int
}

func (w *shortDownloadResponse) Write(p []byte) (int, error) {
	n, _ := w.ResponseRecorder.Write(p[:min(w.limit, len(p))])
	return n, io.ErrClosedPipe
}
