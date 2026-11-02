package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/lazyxu/xdrive/internal/baidumapjsapi"
)

type baiduAutoProbeTestTransport func(*http.Request) (*http.Response, error)

func (fn baiduAutoProbeTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func baiduAutoProbeTestResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}},
		Body: io.NopCloser(strings.NewReader(body)), ContentLength: int64(len(body)),
	}
}

func TestBaiduServerAKProbePinnedPublicCoordinateAndResponse(t *testing.T) {
	const ak = "only-test-not-a-real-ak"
	calls := 0
	client := &http.Client{Transport: baiduAutoProbeTestTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.Method != http.MethodGet || req.URL.Scheme != "https" ||
			req.URL.Host != "api.map.baidu.com" || req.URL.Path != "/geoconv/v2/" {
			t.Fatal("unapproved provider target")
		}
		q := req.URL.Query()
		if len(q) != 4 || q.Get("coords") != "116.404,39.915" ||
			q.Get("model") != "2" || q.Get("output") != "json" || q.Get("ak") != ak ||
			req.Header.Get("Accept-Encoding") != "identity" || req.Header.Get("Authorization") != "" {
			t.Fatal("canary must use one fixed public WGS84 coordinate and trusted Server AK")
		}
		return baiduAutoProbeTestResponse(200,
			`{"status":0,"result":[{"x":116.416,"y":39.922}]}`), nil
	})}
	if got := checkBaiduServerAKFixedCoordinate(context.Background(), ak, client); got != "accepted" || calls != 1 {
		t.Fatalf("fixed canary = %q, calls=%d", got, calls)
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if got := checkBaiduServerAKFixedCoordinate(cancelled, ak, client); got != "unavailable" || calls != 1 {
		t.Fatalf("cancelled canary sent egress: %q %d", got, calls)
	}
	if got := checkBaiduServerAKFixedCoordinate(context.Background(), "invalid\nak", client); got != "unavailable" || calls != 1 {
		t.Fatal("malformed credential sent provider request")
	}
}

func TestBaiduServerAKProbeRejectsRedirectInvalidAndQuotaResponses(t *testing.T) {
	const ak = "only-test-not-a-real-ak"
	cases := []struct {
		name  string
		code  int
		body  string
		alter func(*http.Response)
		want  string
	}{
		{"explicit denial", 403, "", nil, "rejected"},
		{"provider nonzero status", 200, `{"status":302,"message":"rate limited"}`, nil, "rejected"},
		{"provider response malformed", 200, `{"status":0}`, nil, "unavailable"},
		{"unrelated GPS", 200, `{"status":0,"result":[{"x":0,"y":0}]}`, nil, "unavailable"},
		{"bad MIME", 200, `{"status":0,"result":[{"x":116.416,"y":39.922}]}`, func(r *http.Response) {
			r.Header.Set("Content-Type", "text/html")
		}, "unavailable"},
		{"provider redirect", 302, "", func(r *http.Response) {
			r.Header.Set("Location", "https://other.example/")
		}, "unavailable"},
		{"oversized body", 200, strings.Repeat("x", baidumapjsapi.BaiduGeoconvMaxResponseBytes+1), nil, "unavailable"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			client := &http.Client{Transport: baiduAutoProbeTestTransport(func(req *http.Request) (*http.Response, error) {
				response := baiduAutoProbeTestResponse(tc.code, tc.body)
				if tc.alter != nil {
					tc.alter(response)
				}
				return response, nil
			})}
			if got := checkBaiduServerAKFixedCoordinate(context.Background(), ak, client); got != tc.want {
				t.Fatalf("provider response = %q, want %q", got, tc.want)
			}
		})
	}
	client := &http.Client{Transport: baiduAutoProbeTestTransport(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("test-private-failure")
	})}
	if got := checkBaiduServerAKFixedCoordinate(context.Background(), ak, client); got != "unavailable" {
		t.Fatalf("provider transport error leaked or promoted: %s", got)
	}
}

func TestBaiduServerAKProbeCredentialScopeAndFailClosedHealth(t *testing.T) {
	salt := []byte(strings.Repeat("s", baiduServerAKProbeSaltSize))
	a := baiduServerAKProbeTag(salt, "test-AK-a")
	b := baiduServerAKProbeTag(salt, "test-AK-b")
	if len(a) != 64 || a == b || strings.Contains(a, "test") ||
		baiduServerAKProbeTag(nil, "test-AK-a") != "" {
		t.Fatal("Server AK salted tag not bounded or credential-scoped")
	}
	for _, tc := range []struct {
		state, status, health string
	}{
		{"accepted", "ready", "ready"},
		{"rejected", "unavailable", "failed"},
		{"unavailable", "unknown", "unknown"},
		{"checking", "unknown", "not-checked"},
		{"rate-limited", "unknown", "not-checked"},
		{"not-checked", "unknown", "not-checked"},
	} {
		item := serviceDependency{ID: "baidu-map", Status: "unknown", HealthState: "not-checked", ActivationState: "local-effective"}
		applyBaiduServerProbeEvidence(&item, baiduServerAKProbeView{State: tc.state, CheckedAt: time.Now()})
		if item.Status != tc.status || item.HealthState != tc.health ||
			item.ActivationState != "local-effective" || item.BaiduServerProbeState != tc.state ||
			item.BaiduServerProbeCheckedAt == "" {
			t.Fatalf("state %s promoted unrelated activation: %+v", tc.state, item)
		}
	}
	s := &Server{BaiduMapEnabled: true, BaiduMapAK: "test-AK"}
	noDB := s.observeBaiduServerAKProbe(context.Background(), s.baiduMapDeploymentConfig())
	if noDB.State != "not-checked" {
		t.Fatal("no PostgreSQL must never start provider probe")
	}
	s.StartBaiduServerAKAutoProbe(context.Background()) // nil DB is safe and no-op
	if allowed, err := reserveBaiduServerProbeFleetQuota(context.Background(), nil, time.Now()); allowed || err == nil {
		t.Fatal("missing fleet DB admitted paid canary")
	}
}
