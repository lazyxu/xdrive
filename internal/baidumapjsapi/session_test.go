package baidumapjsapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

var testingKey = []byte(strings.Repeat("a", 32))

func trustedSession() MapSessionState {
	return MapSessionState{OwnerID: 101, SessionVersion: 4, ConfigurationRevision: 7,
		RevocationEpoch: 3, AccountActive: true, RuntimeAuthorized: true}
}

func TestMapCookieOnlyForTrustedEnabledSession(t *testing.T) {
	now := time.Date(2026, 10, 13, 11, 0, 0, 0, time.UTC)
	state := trustedSession()
	cookie, err := IssueMapSession(testingKey, state, now)
	if err != nil {
		t.Fatal(err)
	}
	if cookie.Name != MapCookieName || cookie.Domain != "" || cookie.Path != MapCookiePath ||
		!cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode ||
		cookie.MaxAge != 120 || strings.Contains(cookie.Value, "private-browser-ak") {
		t.Fatal("unsafe map-only cookie")
	}
	if err := VerifyMapSession(testingKey, cookie.Value, state, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	mutations := []func(*MapSessionState){
		func(s *MapSessionState) { s.RuntimeAuthorized = false },
		func(s *MapSessionState) { s.AccountActive = false },
		func(s *MapSessionState) { s.SessionVersion++ },
		func(s *MapSessionState) { s.ConfigurationRevision++ },
		func(s *MapSessionState) { s.RevocationEpoch++ },
		func(s *MapSessionState) { s.OwnerID++ },
		func(s *MapSessionState) { s.OwnerID = 0 },
		func(s *MapSessionState) { s.RevocationEpoch = 0 },
	}
	for i, mutate := range mutations {
		s := state
		mutate(&s)
		if VerifyMapSession(testingKey, cookie.Value, s, now.Add(time.Second)) == nil {
			t.Fatalf("accepted revoked state #%d", i)
		}
		if _, err := IssueMapSession(testingKey, s, now); err == nil && (!s.RuntimeAuthorized || !s.AccountActive || s.OwnerID == 0 || s.RevocationEpoch == 0) {
			t.Fatalf("issued disabled session #%d", i)
		}
	}
}

func TestMapSessionExpiryTamperAndWrongKeys(t *testing.T) {
	now := time.Date(2026, 10, 13, 11, 0, 0, 0, time.UTC)
	state := trustedSession()
	cookie, _ := IssueMapSession(testingKey, state, now)
	if VerifyMapSession(testingKey, cookie.Value, state, now.Add(MapSessionTTL)) == nil {
		t.Fatal("accepted expired")
	}
	if VerifyMapSession(testingKey, cookie.Value, state, now.Add(-time.Nanosecond)) == nil {
		t.Fatal("accepted pre-issue")
	}
	if VerifyMapSession([]byte(strings.Repeat("b", 32)), cookie.Value, state, now) == nil {
		t.Fatal("accepted wrong key")
	}
	if VerifyMapSession([]byte("weak"), cookie.Value, state, now) == nil {
		t.Fatal("accepted weak key")
	}
	if VerifyMapSession(testingKey, cookie.Value+"!", state, now) == nil {
		t.Fatal("accepted noncanonical token")
	}
	if VerifyMapSession(testingKey, cookie.Value[:len(cookie.Value)-2]+"aa", state, now) == nil {
		t.Fatal("accepted corrupted token")
	}
	if _, err := IssueMapSession([]byte("weak"), state, now); err == nil {
		t.Fatal("accepted weak issuer key")
	}
	if _, err := IssueMapSession(testingKey, MapSessionState{}, now); err == nil {
		t.Fatal("accepted disabled issuer state")
	}
}

func TestMapSessionRandomnessAndLogoutClearing(t *testing.T) {
	now := time.Now()
	a, err := IssueMapSession(testingKey, trustedSession(), now)
	if err != nil {
		t.Fatal(err)
	}
	b, err := IssueMapSession(testingKey, trustedSession(), now)
	if err != nil {
		t.Fatal(err)
	}
	if a.Value == b.Value {
		t.Fatal("reused cookie nonce")
	}
	c := MapSessionRevocationCookie()
	if c.MaxAge != -1 || !c.HttpOnly || !c.Secure || c.Path != MapCookiePath || c.Domain != "" || c.SameSite != http.SameSiteStrictMode {
		t.Fatal("cookie invalidation unsafe")
	}
}

func TestBootstrapRequiresExactHTTPSSameOriginAndPOST(t *testing.T) {
	const origin = "https://example.invalid"
	r := httptest.NewRequest("POST", origin+"/api/v1/media/places/baidu-jsapi/session", nil)
	r.Header.Set("Origin", origin)
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	if !SessionBootstrapSameOrigin(r, origin) {
		t.Fatal("rejected same origin")
	}
	for _, replacement := range []string{"http://example.invalid", "https://evil.invalid", "null", ""} {
		r.Header.Set("Origin", replacement)
		if SessionBootstrapSameOrigin(r, origin) {
			t.Fatal("accepted foreign bootstrap origin")
		}
	}
	r.Header.Set("Origin", origin)
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	if SessionBootstrapSameOrigin(r, origin) {
		t.Fatal("accepted cross-site bootstrap")
	}
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	r.URL.RawQuery = "token=leak"
	if SessionBootstrapSameOrigin(r, origin) {
		t.Fatal("accepted bootstrap with query")
	}
	r.URL.RawQuery = ""
	r.Method = "GET"
	if SessionBootstrapSameOrigin(r, origin) {
		t.Fatal("accepted GET")
	}
}

func TestResourcePrecheckRejectsBearerExternalAndAK(t *testing.T) {
	const origin = "https://example.invalid"
	r := httptest.NewRequest("GET", origin+"/_BMapService/api?v=4.0", nil)
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	if !SessionResourceRequest(r, origin) {
		t.Fatal("rejected safe resource")
	}
	r.Header.Set("Authorization", "Bearer secret")
	if SessionResourceRequest(r, origin) {
		t.Fatal("accepted bearer to 3p")
	}
	r.Header.Del("Authorization")
	r.URL.RawQuery = "v=4.0&AK=bad"
	if SessionResourceRequest(r, origin) {
		t.Fatal("accepted browser AK")
	}
	r.URL.RawQuery = "v=4.0"
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	if SessionResourceRequest(r, origin) {
		t.Fatal("accepted cross site")
	}
	r.Header.Set("Sec-Fetch-Site", "same-origin")
	r.Header.Set("Origin", "https://attacker.invalid")
	if SessionResourceRequest(r, origin) {
		t.Fatal("accepted external origin")
	}
	r.Header.Del("Origin")
	r.URL.Path = "/some/other/path"
	if SessionResourceRequest(r, origin) {
		t.Fatal("accepted unrelated resource")
	}
}

func TestMapBootstrapRejectsAmbiguousHeaders(t *testing.T) {
	const origin = "https://gallery.example.invalid"
	newRequest := func() *http.Request {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/media/places/baidu-jsapi/session", nil)
		r.Header.Set("Origin", origin)
		r.Header.Set("Sec-Fetch-Site", "same-origin")
		return r
	}
	if !SessionBootstrapSameOrigin(newRequest(), origin) {
		t.Fatal("valid same-origin bootstrap rejected")
	}
	for name, mutate := range map[string]func(*http.Request){
		"duplicate origin":        func(r *http.Request) { r.Header.Add("Origin", origin) },
		"mixed-case origin alias": func(r *http.Request) { r.Header["origin"] = []string{origin} },
		"empty origin field":      func(r *http.Request) { r.Header["Origin"] = []string{""} },
		"duplicate site":          func(r *http.Request) { r.Header.Add("Sec-Fetch-Site", "same-origin") },
		"mixed-case site alias":   func(r *http.Request) { r.Header["sec-fetch-site"] = []string{"same-origin"} },
		"empty site field":        func(r *http.Request) { r.Header["Sec-Fetch-Site"] = []string{""} },
		"duplicate referer":       func(r *http.Request) { r.Header["Referer"] = []string{origin + "/", origin + "/"} },
		"null referer":            func(r *http.Request) { r.Header.Set("Referer", "null") },
		"empty referer":           func(r *http.Request) { r.Header.Set("Referer", "") },
	} {
		t.Run(name, func(t *testing.T) {
			r := newRequest()
			mutate(r)
			if SessionBootstrapSameOrigin(r, origin) {
				t.Fatal("ambiguous map bootstrap header was accepted")
			}
		})
	}
}

func TestMapResourceRejectsAmbiguousHeadersAndMalformedQuery(t *testing.T) {
	const origin = "https://gallery.example.invalid"
	newRequest := func() *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/_BMapService/api?v=4.0", nil)
		r.Header.Set("Origin", origin)
		r.Header.Set("Sec-Fetch-Site", "same-origin")
		return r
	}
	if !SessionResourceRequest(newRequest(), origin) {
		t.Fatal("valid same-origin loader preflight rejected")
	}
	for name, mutate := range map[string]func(*http.Request){
		"duplicate origin":               func(r *http.Request) { r.Header.Add("Origin", origin) },
		"mixed-case origin alias":        func(r *http.Request) { r.Header["origin"] = []string{origin} },
		"empty origin field":             func(r *http.Request) { r.Header.Set("Origin", "") },
		"duplicate fetch site":           func(r *http.Request) { r.Header.Add("Sec-Fetch-Site", "same-origin") },
		"mixed-case site alias":          func(r *http.Request) { r.Header["sec-fetch-site"] = []string{"same-origin"} },
		"empty authorization":            func(r *http.Request) { r.Header.Set("Authorization", "") },
		"mixed-case authorization alias": func(r *http.Request) { r.Header["authorization"] = []string{"Bearer private"} },
		"proxy authorization":            func(r *http.Request) { r.Header.Set("Proxy-Authorization", "Basic sensitive") },
		"empty proxy authorization":      func(r *http.Request) { r.Header.Set("Proxy-Authorization", "") },
		"invalid query escape":           func(r *http.Request) { r.URL.RawQuery = "v=4.0&ak=%GG" },
		"forbidden uppercase ak":         func(r *http.Request) { r.URL.RawQuery = "v=4.0&AK=private" },
		"encoded path alias":             func(r *http.Request) { r.URL.RawPath = "/_BMapService/%61pi" },
		"empty force query":              func(r *http.Request) { r.URL.ForceQuery = true },
		"fragment":                       func(r *http.Request) { r.URL.Fragment = "private" },
	} {
		t.Run(name, func(t *testing.T) {
			r := newRequest()
			mutate(r)
			if SessionResourceRequest(r, origin) {
				t.Fatal("unsafe JSAPI map resource transport accepted")
			}
		})
	}
}
