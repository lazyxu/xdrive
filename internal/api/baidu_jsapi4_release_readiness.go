package api

import "github.com/lazyxu/xdrive/internal/baidumapjsapi"

// A3c18 readiness codes are source-controlled, read-only and non-sensitive.
// They are NOT a Baidu licence, raw HAR leak audit or physical device proof.
// ONLY currentBaiduJSAPI4OperatorRelease grants runtime authority; the admin
// desired flag can never make the JSAPI4 loader or its children available.
const (
	baiduJSAPI4MissingBrowserAK    = "browser_ak_not_configured"
	baiduJSAPI4DesiredDisabled     = "desired_disabled"
	baiduJSAPI4EncryptionMissing   = "encryption_keyring_unavailable"
	baiduJSAPI4HTTPSOriginInvalid  = "trusted_https_origin_invalid"
	baiduJSAPI4SignerUnavailable   = "instance_signing_identity_unavailable"
	baiduJSAPI4ResourcesUnreviewed = "child_resource_inventory_not_reviewed"
	baiduJSAPI4ReleaseUnavailable  = "signed_release_not_installed"
)

// baiduJSAPI4ReleaseBlockers never reads Browser AK plaintext, exposes the
// configured origin or requests a provider resource. It describes CURRENT
// configuration and source policy only; a zero-length set alone is not GO.
func (s *Server) baiduJSAPI4ReleaseBlockers(
	cfg baiduJSAPIDesiredConfig, signedRuntime bool,
) []string {
	if signedRuntime {
		return []string{}
	}
	blockers := make([]string, 0, 7)
	if !cfg.Configured {
		blockers = append(blockers, baiduJSAPI4MissingBrowserAK)
	}
	if !cfg.DesiredEnabled {
		blockers = append(blockers, baiduJSAPI4DesiredDisabled)
	}
	if s == nil || s.ConnectorSecrets == nil {
		blockers = append(blockers, baiduJSAPI4EncryptionMissing)
	}
	if s == nil {
		blockers = append(blockers, baiduJSAPI4HTTPSOriginInvalid)
	} else if _, err := baidumapjsapi.TrustedProxyBase(s.AllowedOrigin); err != nil {
		blockers = append(blockers, baiduJSAPI4HTTPSOriginInvalid)
	}
	if !s.baiduJSAPI4ManagedSignerReady() {
		blockers = append(blockers, baiduJSAPI4SignerUnavailable)
	}
	if !baidumapjsapi.JSAPI4ChildInventoryComplete() {
		blockers = append(blockers, baiduJSAPI4ResourcesUnreviewed)
	}
	if len(blockers) == 0 {
		blockers = append(blockers, baiduJSAPI4ReleaseUnavailable)
	}
	return blockers
}
