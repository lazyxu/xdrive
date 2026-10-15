package baidumapjsapi

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func sampleChildCandidate() JSAPI4ChildCandidate {
	return JSAPI4ChildCandidate{
		ProxyPath:    "/_BMapService/tiles/0.png",
		UpstreamHost: "api.map.baidu.com",
		MediaType:    "image/png", MaxResponseBytes: 64 << 10,
		Query: []JSAPI4ChildQueryCandidate{
			{Name: "v", Literal: "4.0"},
			{Name: "x", BoundedUint: true, Min: 0, Max: 4096},
		},
	}
}

func TestCandidateIsNotInventoryApproval(t *testing.T) {
	c := sampleChildCandidate()
	if err := ValidateJSAPI4ChildCandidate(c); err != nil {
		t.Fatal(err)
	}
	if JSAPI4ChildInventoryComplete() {
		t.Fatal("unreviewed candidates cannot complete source inventory")
	}
	req, _ := http.NewRequest(http.MethodGet, "/_BMapService/api?v=4.0", nil)
	if err := JSAPI4ProductionResourceGate(context.Background(), req, ReleaseGates{
		Licensed: true, ObservedResourceInventory: true, RawLeakAudit: true,
		OwnerSessionAndFleetQuota: true, PlatformIsolation: true,
	}); !errors.Is(err, ErrGateClosed) {
		t.Fatal("no production runtime permitted", err)
	}
}

func TestCandidateRejectsDangerousPolicyProposals(t *testing.T) {
	tests := map[string]func(*JSAPI4ChildCandidate){
		"wildcard host":       func(c *JSAPI4ChildCandidate) { c.UpstreamHost = "*.baidu.com" },
		"foreign host":        func(c *JSAPI4ChildCandidate) { c.UpstreamHost = "api.map.baidu.com.attacker.invalid" },
		"absolute path":       func(c *JSAPI4ChildCandidate) { c.ProxyPath = "https://api.map.baidu.com/tiles/x" },
		"outside prefix":      func(c *JSAPI4ChildCandidate) { c.ProxyPath = "/tiles/x" },
		"loader duplicate":    func(c *JSAPI4ChildCandidate) { c.ProxyPath = LoaderPath },
		"encoded alias":       func(c *JSAPI4ChildCandidate) { c.ProxyPath = "/_BMapService/%2fsecret" },
		"path traversal":      func(c *JSAPI4ChildCandidate) { c.ProxyPath = "/_BMapService/a/../b" },
		"unicode path":        func(c *JSAPI4ChildCandidate) { c.ProxyPath = "/_BMapService/照片" },
		"no bytes cap":        func(c *JSAPI4ChildCandidate) { c.MaxResponseBytes = 0 },
		"huge cap":            func(c *JSAPI4ChildCandidate) { c.MaxResponseBytes = MaxLoaderBytes + 1 },
		"mime wildcard":       func(c *JSAPI4ChildCandidate) { c.MediaType = "*/*" },
		"duplicate query":     func(c *JSAPI4ChildCandidate) { c.Query = append(c.Query, c.Query[0]) },
		"browser AK":          func(c *JSAPI4ChildCandidate) { c.Query[0].Name = "ak" },
		"browser token":       func(c *JSAPI4ChildCandidate) { c.Query[0].Name = "token" },
		"callback":            func(c *JSAPI4ChildCandidate) { c.Query[0].Name = "callback" },
		"empty literal":       func(c *JSAPI4ChildCandidate) { c.Query[0].Literal = "" },
		"unbounded integer":   func(c *JSAPI4ChildCandidate) { c.Query[1].Max = 0; c.Query[1].Min = 1 },
		"both number/literal": func(c *JSAPI4ChildCandidate) { c.Query[1].Literal = "anything" },
		"literal injection":   func(c *JSAPI4ChildCandidate) { c.Query[0].Literal = "4.0&ak=stolen" },
	}
	for name, change := range tests {
		t.Run(name, func(t *testing.T) {
			c := sampleChildCandidate()
			change(&c)
			if !errors.Is(ValidateJSAPI4ChildCandidate(c), ErrUnreviewedResource) {
				t.Fatal("candidate unexpectedly accepted")
			}
		})
	}
}

func TestCandidateMatchesOnlyCanonicalBoundedRead(t *testing.T) {
	good := sampleChildCandidate()
	paths := []string{
		"/_BMapService/tiles/0.png?v=4.0&x=0",
		"/_BMapService/tiles/0.png?v=4.0&x=4096",
	}
	for _, p := range paths {
		req, _ := http.NewRequest(http.MethodGet, p, nil)
		if err := MatchJSAPI4ChildCandidate(good, req); err != nil {
			t.Fatal(p, err)
		}
	}
	bad := []string{
		"/_BMapService/tiles/0.png?v=4.0&x=4097",
		"/_BMapService/tiles/0.png?v=4.0&x=01",
		"/_BMapService/tiles/0.png?v=4.0&x=-1",
		"/_BMapService/tiles/0.png?v=4.0&x=1&ak=leak",
		"/_BMapService/tiles/0.png?v=4.0&x=1&x=2",
		"/_BMapService/tiles/0.png?x=1&v=4.0",
		"/_BMapService/tiles/0.png?v=4.0&x=%31",
		"/_BMapService/tiles/0.png?v=4.0&x=1%3Bak%3D1",
		"/_BMapService/tiles/%30.png?v=4.0&x=1",
		"/_BMapService/tiles/1.png?v=4.0&x=1",
		"https://api.map.baidu.com/_BMapService/tiles/0.png?v=4.0&x=1",
	}
	for _, p := range bad {
		t.Run(p, func(t *testing.T) {
			req, _ := http.NewRequest(http.MethodGet, p, nil)
			if req == nil {
				t.Fatal("bad request fixture")
			}
			if !errors.Is(MatchJSAPI4ChildCandidate(good, req), ErrUnreviewedResource) {
				t.Fatal("noncanonical request accepted")
			}
		})
	}
	r, _ := http.NewRequest(http.MethodPost, paths[0], nil)
	if MatchJSAPI4ChildCandidate(good, r) == nil {
		t.Fatal("POST accepted")
	}
	r, _ = http.NewRequest(http.MethodGet, paths[0], nil)
	r.Header.Set("Authorization", "Bearer secret")
	if MatchJSAPI4ChildCandidate(good, r) == nil {
		t.Fatal("bearer accepted")
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	r, _ = http.NewRequestWithContext(cancelled, http.MethodGet, paths[0], nil)
	if MatchJSAPI4ChildCandidate(good, r) == nil {
		t.Fatal("canceled accepted")
	}
}
