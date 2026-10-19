package baidumapjsapi

import (
	"context"
	"crypto/sha256"
	"encoding/json"
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

// A code-owned, versioned *resource family*, not an arbitrary URL proxy or
// client-edited manifest. The operator has explicitly approved using the
// documented Baidu serviceHost family. Strict path/query/MIME/size/Owner/AK
// controls, not the wildcard spelling, decide actual admission.
const reviewedJSAPI4ChildInventoryRevision = "baidu-jsapi4-official-servicehost-bounded-family-20261019"

// Exactly one provider-owned family is code-approved. The full request is
// inspected at runtime; this is NOT a claim of observed 9-pair real HAR or
// device evidence. Do not add any other upstream host/provider.
const reviewedJSAPI4ChildResourceCount = 1

// A complete code-owned request family is necessary, NOT sufficient: real
// map Session/Owner, current encrypted Browser AK, scoped signing, quota,
// MIME/body safety and Browser/Server validation remain separate gates.
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
	// Only the immutable Baidu serviceHost family. Each child is checked against
	// the strict runtime grammar before any AK, quota or network access.
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

// JSAPI4ApprovedPolicySHA256 identifies the immutable compiled reviewed
// resource graph. Missing children have no policy hash and cannot be
// transformed into runtime permission by an operator checkbox or wildcard.
func JSAPI4ApprovedPolicySHA256() ([32]byte, bool) {
	if !JSAPI4ChildInventoryComplete() {
		return [32]byte{}, false
	}
	payload, err := json.Marshal(struct {
		Domain   string
		Revision string
		Loader   string
		Children []JSAPI4ChildCandidate
	}{
		Domain:   "xdrive/baidu-jsapi4/source-policy/v1",
		Revision: reviewedJSAPI4ChildInventoryRevision,
		Loader:   LoaderPath + "?v=4.0",
		Children: sourceReviewedJSAPI4Children,
	})
	if err != nil {
		return [32]byte{}, false
	}
	return sha256.Sum256(payload), true
}
