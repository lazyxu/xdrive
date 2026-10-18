package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
)

// The production signer and child inventory are unprovisioned in this build.
// This is a negative, REAL transport boundary test, not a synthetic-success
// grant and not evidence of a real licensed Baidu JSAPI4 deployment.
func TestBaiduJSAPI4SignedLiveLoaderNoReleaseNeverTouchesUpstream(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet,
		"https://gallery.example.invalid/_BMapService/api?v=4.0", nil)
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	s := &Server{AllowedOrigin: "https://gallery.example.invalid"}
	key := []byte("local-fixture-only-32-byte-cookie-key")
	for _, tc := range []struct {
		name    string
		ctx     context.Context
		request *http.Request
		key     []byte
	}{
		{name: "no signed production release", ctx: context.Background(), request: r, key: key},
		{name: "no map cookie key", ctx: context.Background(), request: r},
		{name: "no input", ctx: context.Background(), key: key},
		{name: "no context", request: r, key: key},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, headers, err := s.baiduJSAPI4SignedLiveLoader(tc.ctx, tc.request,
				tc.key, baidumapjsapi.JSAPI4ReleaseAttestation{},
				baidumapjsapi.JSAPI4ReleaseScope{})
			if !errors.Is(err, errBaiduJSAPIResourceDenied) ||
				body != nil || headers != nil {
				t.Fatal("unapproved JSAPI4 Loader exposed response or did not fail closed")
			}
		})
	}
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	if _, _, err := s.baiduJSAPI4SignedLiveLoader(ctx, r, key,
		baidumapjsapi.JSAPI4ReleaseAttestation{},
		baidumapjsapi.JSAPI4ReleaseScope{}); !errors.Is(err, errBaiduJSAPIResourceDenied) {
		t.Fatal("cancelled map request was admitted")
	}
}
