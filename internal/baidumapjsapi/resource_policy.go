package baidumapjsapi

import (
	"context"
	"net/http"
)

// A3b2d2b3a reviews code-owned JSAPI4 resource shapes. The result is NOT
// Owner authorization, proxy admission, license evidence, or an AK-bearing URL.
// No HTTP route or production caller is added by this phase.
//
// The Loader is the sole reviewed shape. Its child resources must be observed
// under a licensed account, individually reviewed and added in source code;
// untrusted HARs, administrative fields and arbitrary URL arguments cannot
// mutate this policy.
type JSAPI4ReviewedKind uint8

const (
	JSAPI4ResourceUnreviewed JSAPI4ReviewedKind = iota
	JSAPI4ResourceLoader
	JSAPI4ResourceChild
)

type JSAPI4ResourceReview struct {
	Kind             JSAPI4ReviewedKind
	MaxResponseBytes int64
	MediaType        string
}

// This must be a code-reviewed evidence revision, never derived from a HAR or
// operator-controlled configuration. It remains empty until official account
// entitlement and every JSAPI child-resource contract are verified.
const reviewedJSAPI4ChildInventoryRevision = ""

// No JSAPI4 dynamic child routes have been approved. Keeping the count in
// source code prevents a sample HAR from becoming an implicit allowlist.
const reviewedJSAPI4ChildResourceCount = 0

// JSAPI4ChildInventoryComplete is a necessary, NOT sufficient, condition for
// future release. It intentionally remains false in this sub-phase.
func JSAPI4ChildInventoryComplete() bool {
	if reviewedJSAPI4ChildInventoryRevision == "" || reviewedJSAPI4ChildResourceCount <= 0 ||
		reviewedJSAPI4ChildResourceCount != len(sourceReviewedJSAPI4Children) {
		return false
	}
	// A release must not register two competing contracts for one Gin path
	// or an unreviewed percent-encoded/wildcard/unsupported upstream shape.
	seen := make(map[string]bool, len(sourceReviewedJSAPI4Children))
	for _, child := range sourceReviewedJSAPI4Children {
		if ValidateJSAPI4ChildCandidate(child) != nil || seen[child.ProxyPath] {
			return false
		}
		seen[child.ProxyPath] = true
	}
	return true
}

// ReviewJSAPI4ResourceRequest considers only the resource's canonical HTTP
// envelope. VerifyMapSession (live DB state), same-origin preflight, separate
// network quotas, legal entitlement and a trusted release proof remain
// mandatory for a *future* handler. No browser-supplied Host is trusted.
func ReviewJSAPI4ResourceRequest(req *http.Request) (JSAPI4ResourceReview, error) {
	var denied JSAPI4ResourceReview
	if req == nil || req.URL == nil || req.Context().Err() != nil {
		return denied, ErrUnreviewedResource
	}
	// Any credential header must be absent, not merely have an empty
	// Header.Get() result. Reuse the audited map-session transport guard to
	// reject duplicate fields, mixed-case aliases, nil and empty values.
	_, hasAuthorization, validAuthorization := strictMapTransportHeader(req, "Authorization")
	_, hasProxyAuthorization, validProxyAuthorization := strictMapTransportHeader(req, "Proxy-Authorization")
	if !validAuthorization || hasAuthorization ||
		!validProxyAuthorization || hasProxyAuthorization {
		return denied, ErrUnreviewedResource
	}
	u := req.URL
	if u.IsAbs() || u.Host != "" || u.User != nil || u.Opaque != "" ||
		u.RawPath != "" || u.ForceQuery || u.Fragment != "" || u.RawFragment != "" {
		return denied, ErrUnreviewedResource
	}
	if u.Path == LoaderPath {
		if err := ValidateLoaderRoute(req.Method, u.EscapedPath(), u.RawQuery); err != nil {
			return denied, ErrUnreviewedResource
		}
		return JSAPI4ResourceReview{Kind: JSAPI4ResourceLoader, MaxResponseBytes: MaxLoaderBytes}, nil
	}
	// Exact code-owned children only. A captured HAR/admin value cannot alter
	// the immutable source manifest; with zero reviewed children this is 404.
	child, err := approvedJSAPI4ChildRequest(req)
	if err != nil {
		return denied, ErrUnreviewedResource
	}
	return JSAPI4ResourceReview{
		Kind: JSAPI4ResourceChild, MaxResponseBytes: child.MaxResponseBytes,
		MediaType: child.MediaType,
	}, nil
}

// JSAPI4ProductionResourceGate is the extra code-owned release fence for
// future authenticated Server routing. Pure synthetic ReleaseGates booleans
// are deliberately insufficient while real child inventory is unapproved.
// It is not an HTTP endpoint and never performs a network request.
func JSAPI4ProductionResourceGate(ctx context.Context, req *http.Request, gates ReleaseGates) error {
	if ctx == nil || ctx.Err() != nil || req == nil || req.Context().Err() != nil || !gates.Ready() {
		return ErrGateClosed
	}
	if _, err := ReviewJSAPI4ResourceRequest(req); err != nil {
		return ErrGateClosed
	}
	if !JSAPI4ChildInventoryComplete() {
		return ErrGateClosed
	}
	// Full inventory is still not a licence, raw AK safety audit, signed
	// release decision, or current Owner permission. A later separately
	// reviewed implementation must verify those facts before opening this.
	return ErrGateClosed
}
