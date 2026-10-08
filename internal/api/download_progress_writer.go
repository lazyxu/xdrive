package api

import (
	"io"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// downloadProgressWriter observes successful response writes. It deliberately
// does not expose io.ReaderFrom: io.Copy must not bypass the byte counter.
// The embedded Gin writer preserves headers, flushing and response control.
type downloadProgressWriter struct {
	gin.ResponseWriter
	request   *http.Request
	onStart   func()
	onWrite   func(int64)
	started   bool
	bytesSent int64
	writeErr  error
}

func (w *downloadProgressWriter) bodyResponse() bool {
	return w.request.Method == http.MethodGet &&
		(w.Status() == http.StatusOK || w.Status() == http.StatusPartialContent)
}

func (w *downloadProgressWriter) start() {
	if !w.started {
		w.started = true
		if w.onStart != nil {
			w.onStart()
		}
	}
}

func (w *downloadProgressWriter) Write(p []byte) (int, error) {
	bodyResponse := w.bodyResponse()
	if bodyResponse {
		w.start()
	}
	n, err := w.ResponseWriter.Write(p)
	if bodyResponse {
		if n > 0 {
			w.bytesSent += int64(n)
			if w.onWrite != nil {
				w.onWrite(int64(n))
			}
		}
		if err != nil {
			w.writeErr = err
		} else if n != len(p) {
			w.writeErr = io.ErrShortWrite
		}
	}
	return n, err
}

func (w *downloadProgressWriter) WriteString(value string) (int, error) {
	return w.Write([]byte(value))
}

func (w *downloadProgressWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// An empty state means this request was not a transfer attempt. In particular,
// probes and conditional/range validation must not complete a queued download.
func (w *downloadProgressWriter) result(handlerErr error) (state, message string) {
	if w.request.Method != http.MethodGet ||
		w.Status() == http.StatusNotModified ||
		w.Status() == http.StatusPreconditionFailed ||
		w.Status() == http.StatusRequestedRangeNotSatisfiable {
		return "", ""
	}
	if w.request.Context().Err() != nil {
		return "cancelled", "download response was cancelled"
	}
	if handlerErr != nil || w.writeErr != nil || w.Status() >= 400 {
		return "failed", "download response did not finish"
	}
	if !w.bodyResponse() {
		return "", ""
	}
	if length, err := strconv.ParseInt(w.Header().Get("Content-Length"), 10, 64); err == nil && length != w.bytesSent {
		return "failed", "download response was incomplete"
	}
	return "completed", ""
}
