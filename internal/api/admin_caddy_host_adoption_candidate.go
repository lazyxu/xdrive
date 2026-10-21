package api

import (
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

// D2b-1a is an administrator-only, NONSECRET evidence inventory, not an
// adoption candidate capable of driving a DB change. The current Host Control
// protocol has only TLS identity DIGESTS and an unbound instance generation
// state, not the separately attested complete running identity that D2b-2
// would need. Do not substitute saved desired values or deployment env vars.
const caddyAdoptionEvidenceProtocol = "xdrive.caddy.host-adoption-evidence.v1"

type adminCaddyAdoptionCandidateDTO struct {
	Protocol                string    `json:"protocol"`
	CheckedAt               time.Time `json:"checked_at"`
	DesiredRevision         uint64    `json:"desired_revision"`
	CredentialRevision      uint64    `json:"credential_revision"`
	SnapshotStable          bool      `json:"revision_snapshot_consistent"`
	HostObserved            bool      `json:"host_observed"`
	HostPending             bool      `json:"host_apply_pending"`
	HostInstanceGeneration  string    `json:"host_instance_generation"`
	HostLiveConfigState     string    `json:"host_live_config_state"`
	DesiredDomainLocalMatch string    `json:"desired_domain_local_match"`
	DesiredLANLocalMatch    string    `json:"desired_lan_local_match"`
	CandidateComplete       bool      `json:"candidate_complete"`
	CanAdopt                bool      `json:"can_adopt"`
	ApplySupported          bool      `json:"apply_supported"`
	Blockers                []string  `json:"blockers"`
}

// Every positive finding is only local and point-in-time; no proof here
// contains raw running FQDN/IP, a signed host identity, an authorized nonce,
// or a host-applied revision. Even a perfect local match remains blocked.
func buildCaddyAdoptionEvidence(snapshot caddyPreflightSnapshot,
	host caddyHostStatus, observed, pending bool, deployedLANIP string,
) adminCaddyAdoptionCandidateDTO {
	desired := snapshot.Desired
	credentialRevision := uint64(0)
	if snapshot.CredentialExists {
		credentialRevision = snapshot.Credential.Revision
	}
	evidence := adminCaddyAdoptionCandidateDTO{
		Protocol:                caddyAdoptionEvidenceProtocol,
		DesiredRevision:         desired.Revision,
		CredentialRevision:      credentialRevision,
		SnapshotStable:          true,
		HostObserved:            observed,
		HostPending:             pending,
		HostInstanceGeneration:  caddyObservedInstanceGeneration(host, observed),
		HostLiveConfigState:     caddyObservedLiveConfigState(host, observed),
		DesiredDomainLocalMatch: caddyDesiredDomainLocalMatch(desired, host, observed),
		DesiredLANLocalMatch:    caddyDesiredLANLocalMatch(desired, host, observed, deployedLANIP),
		CandidateComplete:       false,
		CanAdopt:                false,
		ApplySupported:          false,
		Blockers:                make([]string, 0, 9),
	}
	if desired.Revision == 0 || (desired.Source != "saved" &&
		desired.Source != caddyImportedHostOrigin) {
		evidence.Blockers = append(evidence.Blockers, "saved-revision-unavailable")
	}
	if !validCaddyIngressSelection(desired.Enabled, desired.Domain, desired.LANEnabled, desired.LANIP) {
		evidence.Blockers = append(evidence.Blockers, "saved-ingress-invalid")
	}
	if pending {
		evidence.Blockers = append(evidence.Blockers, "host-pending")
	}
	if !observed || host.State != "healthy" {
		evidence.Blockers = append(evidence.Blockers, "trusted-host-not-healthy")
	}
	if evidence.HostInstanceGeneration != "same-instance-local" {
		evidence.Blockers = append(evidence.Blockers, "same-host-generation-unverified")
	}
	if evidence.HostLiveConfigState != "observed-local" {
		evidence.Blockers = append(evidence.Blockers, "running-caddy-config-unverified")
	}
	if desired.Enabled {
		if evidence.DesiredDomainLocalMatch != "matched-local" {
			evidence.Blockers = append(evidence.Blockers, "domain-local-tls-unmatched")
		}
	} else {
		// No positive TLS handshake cannot attest a disabled ingress.
		evidence.Blockers = append(evidence.Blockers, "domain-disabled-not-attested")
	}
	if desired.LANEnabled {
		if evidence.DesiredLANLocalMatch != "matched-local" {
			evidence.Blockers = append(evidence.Blockers, "lan-local-tls-unmatched")
		}
	} else {
		evidence.Blockers = append(evidence.Blockers, "lan-disabled-not-attested")
	}
	// A fingerprint of a value in SAVED intent never becomes a separately
	// attested running candidate. This blocker is mandatory for D2b-1a.
	evidence.Blockers = append(evidence.Blockers, "independent-running-identity-unavailable")
	return evidence
}

// This endpoint is deliberately read-only and admin-gated by router.go.
// It neither creates a new desired revision nor grants Host/Docker authority.
// Re-read both DB revisions and Host observation: mixed views fail with 409.
// This consistency check is NOT the future D2b-2 signed/CAS write guarantee.
func (s *Server) adminCaddyHostAdoptionCandidate(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	ctx := c.Request.Context()
	first, err := s.readCaddyPreflightSnapshot(ctx)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy adoption evidence settings unavailable")
		return
	}
	pendingBefore, err := readCaddyHostPendingUnappliedDB(s.DB.WithContext(ctx))
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy host reservation evidence unavailable")
		return
	}
	hostBefore, observedBefore := s.readCaddyHostStatus()
	last, err := s.readCaddyPreflightSnapshot(ctx)
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy adoption evidence recheck unavailable")
		return
	}
	pendingAfter, err := readCaddyHostPendingUnappliedDB(s.DB.WithContext(ctx))
	if err != nil {
		fail(c, http.StatusServiceUnavailable, "Caddy host reservation recheck unavailable")
		return
	}
	hostAfter, observedAfter := s.readCaddyHostStatus()
	if !sameCaddyPreflightSnapshot(first, last) ||
		pendingBefore != pendingAfter || observedBefore != observedAfter ||
		hostBefore != hostAfter {
		fail(c, http.StatusConflict, "Caddy local evidence changed; inspect again")
		return
	}
	evidence := buildCaddyAdoptionEvidence(first, hostAfter, observedAfter,
		pendingAfter, os.Getenv("XD_LAN_HTTPS_IP"))
	evidence.CheckedAt = time.Now().UTC()
	c.JSON(http.StatusOK, evidence)
}
