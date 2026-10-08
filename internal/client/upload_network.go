package client

import (
	"context"
	"io"
	"net/http"
	"sync"
	"time"
)

const uploadNetworkSampleInterval = 250 * time.Millisecond

type uploadNetworkProgressKey struct{}

// WithUploadNetworkProgress observes cumulative upload payload bytes consumed by
// the HTTP transport. Retransmissions count again; hashing, resumed chunks and
// source reads do not count. This is transport consumption, not a server receipt
// acknowledgement. Use a fresh context for each upload.
//
// The callback receives an initial zero, then serialized samples at most every
// 250 ms plus a final flush for each request body. It must return promptly. The
// existing UploadProgress callback continues to report logical chunk progress.
func WithUploadNetworkProgress(ctx context.Context, progress func(int64)) context.Context {
	if progress == nil {
		return ctx
	}
	observer := &uploadNetworkObserver{progress: progress, lastSampleAt: time.Now()}
	progress(0)
	return context.WithValue(ctx, uploadNetworkProgressKey{}, observer)
}

type uploadNetworkObserver struct {
	mu           sync.Mutex
	progress     func(int64)
	bytes        int64
	reported     int64
	lastSampleAt time.Time
	timer        *time.Timer
	timerID      uint64
}

func observeUploadRequest(req *http.Request) func() {
	observer, _ := req.Context().Value(uploadNetworkProgressKey{}).(*uploadNetworkObserver)
	if observer == nil || req.Body == nil || req.Body == http.NoBody {
		return func() {}
	}
	// Wrap after NewRequest has inferred ContentLength and GetBody from the
	// original reader, and keep observing any body replay made by net/http.
	req.Body = &uploadNetworkBody{ReadCloser: req.Body, observer: observer}
	if getBody := req.GetBody; getBody != nil {
		req.GetBody = func() (io.ReadCloser, error) {
			body, err := getBody()
			if err != nil || body == nil {
				return body, err
			}
			return &uploadNetworkBody{ReadCloser: body, observer: observer}, nil
		}
	}
	return observer.flush
}

type uploadNetworkBody struct {
	io.ReadCloser
	observer *uploadNetworkObserver
}

func (r *uploadNetworkBody) Read(p []byte) (int, error) {
	n, err := r.ReadCloser.Read(p)
	if n > 0 {
		r.observer.add(int64(n))
	}
	if err != nil {
		r.observer.flush()
	}
	return n, err
}

func (r *uploadNetworkBody) Close() error {
	defer r.observer.flush()
	return r.ReadCloser.Close()
}

func (o *uploadNetworkObserver) add(n int64) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.bytes += n
	wait := uploadNetworkSampleInterval - time.Since(o.lastSampleAt)
	if wait <= 0 {
		o.stopTimerLocked()
		o.publishLocked()
		return
	}
	if o.timer == nil {
		o.timerID++
		id := o.timerID
		o.timer = time.AfterFunc(wait, func() {
			o.mu.Lock()
			defer o.mu.Unlock()
			if id != o.timerID {
				return
			}
			o.timer = nil
			o.publishLocked()
		})
	}
}

func (o *uploadNetworkObserver) flush() {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.stopTimerLocked()
	o.publishLocked()
}

func (o *uploadNetworkObserver) stopTimerLocked() {
	if o.timer != nil {
		o.timer.Stop()
		o.timer = nil
		o.timerID++
	}
}

func (o *uploadNetworkObserver) publishLocked() {
	if o.bytes == o.reported {
		return
	}
	o.reported = o.bytes
	o.lastSampleAt = time.Now()
	o.progress(o.bytes)
}
