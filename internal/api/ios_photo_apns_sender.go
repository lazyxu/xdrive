package api

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/lazyxu/xdrive/internal/meta"
)

const (
	iosPhotoAPNSTopic       = "com.lazyxu.xdrive.ios"
	iosPhotoAPNSMinimumGap  = 2 * time.Hour
	iosPhotoAPNSSweepLimit  = 32
	iosPhotoAPNSPayloadJSON = `{"aps":{"content-available":1},"xdrive_kind":"photos-backup-wake","xdrive_version":1}`
)

type iosPhotoAPNSProvider struct {
	teamID string
	keyID  string
	key    *ecdsa.PrivateKey
	client *http.Client
}

func validIOSPhotoAPNSIdentifier(s string) bool {
	if len(s) != 10 {
		return false
	}
	for _, c := range s {
		if c < 'A' || c > 'Z' {
			if c < '0' || c > '9' {
				return false
			}
		}
	}
	return true
}

// The .p8 is an operator-provisioned secret on the server, never a repository
// asset or client upload. Missing provisioning disables APNs, not backups.
func loadIOSPhotoAPNSProviderFromEnvironment() (*iosPhotoAPNSProvider, error) {
	team := strings.TrimSpace(os.Getenv("XD_IOS_PHOTO_APNS_TEAM_ID"))
	kid := strings.TrimSpace(os.Getenv("XD_IOS_PHOTO_APNS_KEY_ID"))
	file := strings.TrimSpace(os.Getenv("XD_IOS_PHOTO_APNS_PRIVATE_KEY_FILE"))
	if team == "" && kid == "" && file == "" {
		return nil, nil
	}
	if !validIOSPhotoAPNSIdentifier(team) || !validIOSPhotoAPNSIdentifier(kid) || file == "" {
		return nil, errors.New("incomplete Apple APNs provider configuration")
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return nil, errors.New("read private Apple APNs provider key failed")
	}
	defer clear(data)
	block, trailing := pem.Decode(data)
	if block == nil || block.Type != "PRIVATE KEY" || len(bytes.TrimSpace(trailing)) != 0 {
		return nil, errors.New("invalid Apple APNs PKCS8 key")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("invalid Apple APNs signing key")
	}
	key, ok := parsed.(*ecdsa.PrivateKey)
	if !ok || key.Curve != elliptic.P256() {
		return nil, errors.New("Apple APNs provider key must use P-256")
	}
	return &iosPhotoAPNSProvider{
		teamID: team, keyID: kid, key: key,
		client: &http.Client{
			Timeout: 15 * time.Second,
			Transport: &http.Transport{
				ForceAttemptHTTP2:   true,
				TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
				MaxIdleConns:        8,
				MaxIdleConnsPerHost: 4,
			},
		},
	}, nil
}

// APNs expects a JOSE raw P-256 R||S signature, NOT ASN.1 DER.
func (p *iosPhotoAPNSProvider) authorizationJWT(now time.Time) (string, error) {
	if p == nil || p.key == nil || !validIOSPhotoAPNSIdentifier(p.teamID) ||
		!validIOSPhotoAPNSIdentifier(p.keyID) {
		return "", errors.New("invalid APNs provider")
	}
	header, err := json.Marshal(struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}{Alg: "ES256", Kid: p.keyID})
	if err != nil {
		return "", err
	}
	claims, err := json.Marshal(struct {
		Iss string `json:"iss"`
		Iat int64  `json:"iat"`
	}{Iss: p.teamID, Iat: now.Unix()})
	if err != nil {
		return "", err
	}
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." +
		base64.RawURLEncoding.EncodeToString(claims)
	sum := sha256.Sum256([]byte(unsigned))
	r, s, err := ecdsa.Sign(rand.Reader, p.key, sum[:])
	if err != nil {
		return "", err
	}
	rBytes, sBytes := r.Bytes(), s.Bytes()
	if len(rBytes) > 32 || len(sBytes) > 32 {
		return "", errors.New("invalid APNs P-256 signature")
	}
	var raw [64]byte
	copy(raw[32-len(rBytes):32], rBytes)
	copy(raw[64-len(sBytes):], sBytes)
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

func iosPhotoAPNSEndpoint(environment, token string) (string, error) {
	if !validIOSPhotoAPNSToken(token) || !validIOSPhotoAPNSEnvironment(environment) {
		return "", errors.New("invalid APNs destination")
	}
	host := "api.push.apple.com"
	if environment == "development" {
		host = "api.sandbox.push.apple.com"
	}
	return "https://" + host + "/3/device/" + token, nil
}

func newIOSPhotoAPNSWakeRequest(ctx context.Context, endpoint, jwt string) (*http.Request, error) {
	if jwt == "" {
		return nil, errors.New("Apple provider JWT required")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		endpoint, strings.NewReader(iosPhotoAPNSPayloadJSON))
	if err != nil {
		return nil, err
	}
	request.Header.Set("authorization", "bearer "+jwt)
	request.Header.Set("apns-topic", iosPhotoAPNSTopic)
	request.Header.Set("apns-push-type", "background")
	request.Header.Set("apns-priority", "5")
	request.Header.Set("apns-expiration", "0") // stale background hints are worthless
	request.Header.Set("apns-collapse-id", "ios-photos-backup")
	request.Header.Set("content-type", "application/json")
	return request, nil
}

// Returns invalidToken=true only for Apple-documented token scope/revocation
// rejection, not generic authentication, network or provider failures.
func (p *iosPhotoAPNSProvider) sendWake(ctx context.Context,
	environment, token, jwt string) (invalidToken bool, err error) {
	endpoint, err := iosPhotoAPNSEndpoint(environment, token)
	if err != nil {
		return false, err
	}
	req, err := newIOSPhotoAPNSWakeRequest(ctx, endpoint, jwt)
	if err != nil {
		return false, err
	}
	res, err := p.client.Do(req)
	if err != nil {
		return false, err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusOK {
		return false, nil
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 4097))
	if err != nil || len(body) > 4096 {
		return false, errors.New("unavailable APNs provider response")
	}
	var failure struct {
		Reason string `json:"reason"`
	}
	if json.Unmarshal(body, &failure) != nil {
		return false, fmt.Errorf("APNs provider HTTP %d", res.StatusCode)
	}
	if (res.StatusCode == http.StatusBadRequest ||
		res.StatusCode == http.StatusGone) &&
		(failure.Reason == "BadDeviceToken" ||
			failure.Reason == "Unregistered" ||
			failure.Reason == "DeviceTokenNotForTopic") {
		return true, nil
	}
	return false, fmt.Errorf("APNs provider HTTP %d", res.StatusCode)
}

// An optional worker sends at most one silent hint per grant every two hours.
// No configured keyring/provider means NO APNs sender. BGProcessing and
// foreground/Focused backup remain functional independent of APNs.
func (s *Server) StartIOSPhotoAPNSWakeWorker(ctx context.Context) {
	provider, err := loadIOSPhotoAPNSProviderFromEnvironment()
	if err != nil {
		slog.Warn("ios_photo_apns_provider_unavailable", "reason", "configuration_invalid")
		return
	}
	if provider == nil || s.ConnectorSecrets == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(iosPhotoAPNSMinimumGap)
		defer ticker.Stop()
		s.iosPhotoAPNSWakeSweep(ctx, provider)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.iosPhotoAPNSWakeSweep(ctx, provider)
			}
		}
	}()
}

func (s *Server) iosPhotoAPNSWakeSweep(ctx context.Context, provider *iosPhotoAPNSProvider) {
	if err := ctx.Err(); err != nil || provider == nil || s.ConnectorSecrets == nil {
		return
	}
	now := time.Now().UTC()
	jwt, err := provider.authorizationJWT(now)
	if err != nil {
		return
	}
	var grants []meta.IOSPhotoBackgroundGrant
	if err := s.DB.WithContext(ctx).
		Where("apns_token_ciphertext IS NOT NULL AND revoked_at IS NULL AND expires_at > ? AND (apns_last_sent_at IS NULL OR apns_last_sent_at < ?)",
			now, now.Add(-iosPhotoAPNSMinimumGap)).
		Order("apns_last_sent_at ASC NULLS FIRST, id ASC").
		Limit(iosPhotoAPNSSweepLimit).Find(&grants).Error; err != nil {
		return
	}
	for _, grant := range grants {
		if ctx.Err() != nil {
			return
		}
		s.iosPhotoAPNSSendOne(ctx, provider, grant, jwt, now)
	}
}

func (s *Server) iosPhotoAPNSSendOne(ctx context.Context, provider *iosPhotoAPNSProvider,
	grant meta.IOSPhotoBackgroundGrant, jwt string, now time.Time) {
	if !iosPhotoGrantHasManagedTarget(grant) ||
		grant.APNSKeyVersion == 0 || grant.APNSTokenDigest == "" ||
		!validIOSPhotoAPNSEnvironment(grant.APNSEnvironment) {
		return
	}
	// Validate independently of grant creation: a dead Owner session,
	// revoked device or re-bound Source cannot produce another push.
	var owner meta.User
	var device meta.ClientDevice
	var root meta.Node
	if s.DB.WithContext(ctx).Where("id = ?", grant.OwnerID).
		Take(&owner).Error != nil ||
		s.DB.WithContext(ctx).Where("id = ? AND owner_id = ?", grant.DeviceID, grant.OwnerID).
			Take(&device).Error != nil ||
		s.DB.WithContext(ctx).Where("id = ? AND owner_id = ? AND parent_id IS NULL",
			grant.RootNodeID, grant.OwnerID).Take(&root).Error != nil ||
		!iosPhotoGrantValid(grant, device, owner, root, s.PWAOfflineInstanceID, now) {
		return
	}
	source, target, err := iosPhotoDestinationBindingTx(s.DB.WithContext(ctx), device)
	if err != nil || source.ID != *grant.SourceID || target.ID != *grant.TargetNodeID {
		return
	}

	tokenBytes, err := s.ConnectorSecrets.Open(*grant.SourceID,
		iosPhotoAPNSCredentialKindPrefix+grant.DeviceID,
		grant.APNSKeyVersion, grant.APNSTokenCiphertext)
	if err != nil {
		return
	}
	defer clear(tokenBytes)
	token := string(tokenBytes)
	hash := sha256.Sum256(tokenBytes)
	if !validIOSPhotoAPNSToken(token) ||
		subtle.ConstantTimeCompare([]byte(grant.APNSTokenDigest),
			[]byte(hex.EncodeToString(hash[:]))) != 1 {
		return
	}

	// Atomic claim against the precise grant+token before any egress. Multiple
	// server instances cannot double-send a hint; a revoked grant cannot claim.
	// A revoke after claim may still race one already-in-flight harmless hint,
	// but the native vault refuses uploading without a current scoped grant.
	claim := s.DB.WithContext(ctx).Model(&meta.IOSPhotoBackgroundGrant{}).
		Where("id = ? AND owner_id = ? AND revoked_at IS NULL AND expires_at > ? AND apns_token_digest = ? AND (apns_last_sent_at IS NULL OR apns_last_sent_at < ?)",
			grant.ID, grant.OwnerID, now, grant.APNSTokenDigest,
			now.Add(-iosPhotoAPNSMinimumGap)).
		Update("apns_last_sent_at", now)
	if claim.Error != nil || claim.RowsAffected != 1 {
		return
	}
	invalid, err := provider.sendWake(ctx, grant.APNSEnvironment, token, jwt)
	if invalid {
		// Revoke only the same token digest; a concurrently registered token
		// must remain active. Never revoke the backing Photo upload grant.
		_ = s.DB.WithContext(ctx).Model(&meta.IOSPhotoBackgroundGrant{}).
			Where("id = ? AND owner_id = ? AND apns_token_digest = ?",
				grant.ID, grant.OwnerID, grant.APNSTokenDigest).
			Updates(map[string]any{
				"apns_token_ciphertext": nil, "apns_key_version": 0,
				"apns_token_digest": "", "apns_environment": "",
				"apns_registered_at": nil,
			}).Error
	}
	if err != nil {
		// No token, key, JWT or PhotoKit identity in telemetry.
		slog.Warn("ios_photo_apns_hint_failed", "kind", "optional_background_hint")
	}
}
