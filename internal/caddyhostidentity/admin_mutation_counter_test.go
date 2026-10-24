package caddyhostidentity

import (
	"strings"
	"testing"
)

func TestPrivateCaddyAdminMutationDigest(t *testing.T) {
	good := []string{`caddy_admin_http_requests_total{code="200",handler="load",method="POST",path="/load"} 2`, `caddy_admin_http_requests_total{code="400",handler="admin",method="PATCH",path="/config/apps/http"} 1`}
	a, e := privateCaddyAdminMutationDigest(good)
	if e != nil || len(a) != 64 {
		t.Fatalf("valid mutations rejected %v", e)
	}
	b, e := privateCaddyAdminMutationDigest([]string{good[1], good[0]})
	if e != nil || b != a {
		t.Fatal("metric ordering changed canonical digest")
	}
	c, e := privateCaddyAdminMutationDigest([]string{strings.Replace(good[0], " 2", " 3", 1), good[1]})
	if e != nil || c == a {
		t.Fatal("same config but new completed mutation not detected")
	}
	zero, e := privateCaddyAdminMutationDigest(nil)
	if e != nil || len(zero) != 64 {
		t.Fatal("zero completed mutation not supported")
	}
	for name, lines := range map[string][]string{
		"duplicate":         {good[0], good[0]},
		"unknown method":    {`caddy_admin_http_requests_total{code="200",handler="metrics",method="TRACE",path="/metrics"} 1`},
		"malformed GET":     {`caddy_admin_http_requests_total{method="GET",path="/metrics"} 1`},
		"duplicate GET":     {`caddy_admin_http_requests_total{code="200",handler="metrics",method="GET",path="/metrics"} 1`, `caddy_admin_http_requests_total{code="200",handler="metrics",method="GET",path="/metrics"} 2`},
		"extra label":       {`caddy_admin_http_requests_total{code="200",handler="load",method="POST",path="/load",user="x"} 1`},
		"newline injection": {good[0] + "\nFAKE"},
		"missing labels":    {`caddy_admin_http_requests_total{method="POST",path="/load"} 1`},
		"counter float":     {strings.Replace(good[0], " 2", " 1.5", 1)},
		"counter NaN":       {strings.Replace(good[0], " 2", " NaN", 1)},
		"counter giant":     {strings.Replace(good[0], " 2", " 9007199254740994", 1)},
		"escaped path":      {`caddy_admin_http_requests_total{code="200",handler="load",method="POST",path="/load\\n"} 1`},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := privateCaddyAdminMutationDigest(lines); err == nil {
				t.Fatal("accepted ambiguous mutation witness")
			}
		})
	}
}

func TestCaddyAdminGETCountersAreValidatedButNotMutations(t *testing.T) {
	write := `caddy_admin_http_requests_total{code="200",handler="load",method="POST",path="/load"} 1`
	readA := `caddy_admin_http_requests_total{code="200",handler="metrics",method="GET",path="/metrics"} 3`
	readB := `caddy_admin_http_requests_total{code="200",handler="metrics",method="GET",path="/metrics"} 3000`
	first, err := privateCaddyAdminMutationDigest([]string{write, readA})
	if err != nil {
		t.Fatal(err)
	}
	second, err := privateCaddyAdminMutationDigest([]string{readB, write})
	if err != nil || first != second {
		t.Fatalf("a valid Caddy /metrics GET changed the mutation witness: %v", err)
	}
	empty, err := privateCaddyAdminMutationDigest(nil)
	if err != nil {
		t.Fatal(err)
	}
	onlyRead, err := privateCaddyAdminMutationDigest([]string{readA})
	if err != nil || onlyRead != empty {
		t.Fatal("an ordinary Admin GET must not change the mutation digest")
	}
}

// The only excluded Admin request series are the two genuinely read-only
// endpoints used by the installed Host observer itself. Other requests are
// not silently considered harmless, even if their HTTP method is GET.
func TestCaddyAdminReadAllowlistRequiresExactHandlerAndPath(t *testing.T) {
	base, err := privateCaddyAdminMutationDigest(nil)
	if err != nil {
		t.Fatal(err)
	}
	reads := []string{
		`caddy_admin_http_requests_total{code="200",handler="metrics",method="GET",path="/metrics"} 23`,
		`caddy_admin_http_requests_total{code="200",handler="admin",method="GET",path="/config/"} 17`,
	}
	got, err := privateCaddyAdminMutationDigest(reads)
	if err != nil || got != base {
		t.Fatalf("known read-only Admin paths invalidated mutation epoch: %v", err)
	}
	for _, unknown := range []string{
		`caddy_admin_http_requests_total{code="200",handler="plugin",method="GET",path="/config/"} 1`,
		`caddy_admin_http_requests_total{code="200",handler="admin",method="GET",path="/debug/pprof/"} 1`,
		`caddy_admin_http_requests_total{code="200",handler="metrics",method="GET",path="/metrics/"} 1`,
		`caddy_admin_http_requests_total{code="200",handler="plugin",method="GET",path="/custom-mutation"} 1`,
		`caddy_admin_http_requests_total{code="200",handler="admin",method="HEAD",path="/config/"} 1`,
		`caddy_admin_http_requests_total{code="200",handler="admin",method="OPTIONS",path="/config/"} 1`,
	} {
		if _, err := privateCaddyAdminMutationDigest([]string{unknown}); err == nil {
			t.Fatal("unexpected Admin request treated as harmless")
		}
	}
}

func TestCaddyAdminErrorCountersBindFailedWrite(t *testing.T) {
	write := `caddy_admin_http_requests_total{code="200",handler="load",method="POST",path="/load"} 1`
	errorWrite := `caddy_admin_http_request_errors_total{handler="load",method="POST",path="/load"} 1`
	before, err := privateCaddyAdminMutationDigest([]string{write})
	if err != nil {
		t.Fatal(err)
	}
	after, err := privateCaddyAdminMutationDigest([]string{write, errorWrite})
	if err != nil || before == after {
		t.Fatal("a newly recorded Admin write error did not invalidate the mutation checkpoint")
	}
	reversed, err := privateCaddyAdminMutationDigest([]string{errorWrite, write})
	if err != nil || reversed != after {
		t.Fatal("sorting Admin request/error series changed the private fingerprint")
	}
	advanced := strings.Replace(errorWrite, " 1", " 2", 1)
	next, err := privateCaddyAdminMutationDigest([]string{write, advanced})
	if err != nil || next == after {
		t.Fatal("increased failed Admin request count went unnoticed")
	}
	readError := `caddy_admin_http_request_errors_total{handler="metrics",method="GET",path="/metrics"} 3`
	ignored, err := privateCaddyAdminMutationDigest([]string{write, readError})
	if err != nil || ignored != before {
		t.Fatal("known read-only metrics GET error unexpectedly invalidated mutation digest")
	}
	for name, series := range map[string][]string{
		"duplicate error counter": {write, errorWrite, errorWrite},
		"fractional error count":  {strings.Replace(errorWrite, " 1", " 1.5", 1)},
		"NaN error count":         {strings.Replace(errorWrite, " 1", " NaN", 1)},
		"unknown GET error":       {`caddy_admin_http_request_errors_total{handler="plugin",method="GET",path="/custom"} 1`},
		"untrusted error method":  {`caddy_admin_http_request_errors_total{handler="admin",method="TRACE",path="/config/"} 1`},
		"extra error label":       {`caddy_admin_http_request_errors_total{handler="load",method="POST",path="/load",user="x"} 1`},
		"wrong error metric name": {`caddy_admin_http_request_errors_totals{handler="load",method="POST",path="/load"} 1`},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := privateCaddyAdminMutationDigest(series); err == nil {
				t.Fatal("untrusted Caddy Admin error metric admitted")
			}
		})
	}
}

func TestCaddyAdminScientificCounterPreservesIntegerMutations(t *testing.T) {
	decimal := `caddy_admin_http_requests_total{code="200",handler="load",method="POST",path="/load"} 1000000`
	scientific := `caddy_admin_http_requests_total{code="200",handler="load",method="POST",path="/load"} 1e+06`
	first, err := privateCaddyAdminMutationDigest([]string{decimal})
	if err != nil {
		t.Fatal(err)
	}
	second, err := privateCaddyAdminMutationDigest([]string{scientific})
	if err != nil || first != second {
		t.Fatalf("exact integer counter in scientific notation was not canonical: %v", err)
	}
	errorDecimal := `caddy_admin_http_request_errors_total{handler="load",method="POST",path="/load"} 32`
	errorScientific := `caddy_admin_http_request_errors_total{handler="load",method="POST",path="/load"} 3.2E+01`
	a, err := privateCaddyAdminMutationDigest([]string{errorDecimal})
	if err != nil {
		t.Fatal(err)
	}
	b, err := privateCaddyAdminMutationDigest([]string{errorScientific})
	if err != nil || a != b {
		t.Fatalf("Admin error counter scientific notation was not canonical: %v", err)
	}
	for name, value := range map[string]string{
		"float64 precision boundary":   "9007199254740992",
		"silent rounding above limit":  "9007199254740993",
		"exponent precision boundary":  "9.007199254740992e+15",
		"fractional negative exponent": "1e-02",
		"fractional positive exponent": "1.55e+01",
		"overflow exponent":            "1e+309",
	} {
		t.Run(name, func(t *testing.T) {
			line := strings.Replace(decimal, " 1000000", " "+value, 1)
			if _, err := privateCaddyAdminMutationDigest([]string{line}); err == nil {
				t.Fatalf("ambiguous counter precision accepted: %s", value)
			}
		})
	}
}
