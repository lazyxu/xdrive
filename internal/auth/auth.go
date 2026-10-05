package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type Manager struct {
	secret    []byte
	accessTTL time.Duration
}

type Claims struct {
	UserID         uint64 `json:"uid"`
	TokenType      string `json:"typ,omitempty"`
	SessionVersion uint64 `json:"ver,omitempty"`
	jwt.RegisteredClaims
}

func New(secret string, accessTTL time.Duration) Manager {
	return Manager{secret: []byte(secret), accessTTL: accessTTL}
}

func (m Manager) TTL() time.Duration { return m.accessTTL }

func HashPassword(password string) (string, error) {
	if len(password) < 8 {
		return "", errors.New("password must be at least 8 characters")
	}
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(b), err
}

func CheckPassword(hash, password string) error {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
}

func (m Manager) Issue(userID, sessionVersion uint64) (string, error) {
	now := time.Now()
	claims := Claims{
		UserID:         userID,
		TokenType:      "access",
		SessionVersion: sessionVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(m.accessTTL)),
			Subject:   fmt.Sprintf("%d", userID),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
}

func (m Manager) Parse(tokenString string) (userID, sessionVersion uint64, err error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method %v", token.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil || !token.Valid || claims.UserID == 0 || (claims.TokenType != "" && claims.TokenType != "access") {
		return 0, 0, errors.New("invalid token")
	}
	return claims.UserID, claims.SessionVersion, nil
}

type PreviewStreamClaims struct {
	UserID         uint64 `json:"uid"`
	NodeID         uint64 `json:"nid"`
	NodeRevision   uint64 `json:"rev"`
	SessionVersion uint64 `json:"ver,omitempty"`
	PreviewKind    string `json:"kind"`
	TokenType      string `json:"typ"`
	jwt.RegisteredClaims
}

func (m Manager) IssuePreviewStream(
	userID, sessionVersion, nodeID, nodeRevision uint64,
	previewKind string,
	ttl time.Duration,
) (string, time.Time, error) {
	previewKind = strings.TrimSpace(previewKind)
	if userID == 0 || nodeID == 0 || nodeRevision == 0 ||
		previewKind == "" || len(previewKind) > 16 ||
		ttl <= 0 || ttl > 2*time.Hour {
		return "", time.Time{}, errors.New("invalid preview stream claims")
	}
	now := time.Now()
	expiresAt := now.Add(ttl)
	claims := PreviewStreamClaims{
		UserID:         userID,
		NodeID:         nodeID,
		NodeRevision:   nodeRevision,
		SessionVersion: sessionVersion,
		PreviewKind:    previewKind,
		TokenType:      "preview_stream",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			Subject:   fmt.Sprintf("%d", userID),
			Audience:  jwt.ClaimStrings{"xdrive-preview-stream"},
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
	return token, expiresAt, err
}

func (m Manager) ParsePreviewStream(tokenString string) (PreviewStreamClaims, error) {
	claims := &PreviewStreamClaims{}
	token, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(token *jwt.Token) (any, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, fmt.Errorf("unexpected signing method %v", token.Header["alg"])
			}
			return m.secret, nil
		},
		jwt.WithAudience("xdrive-preview-stream"),
	)
	if err != nil || !token.Valid ||
		claims.TokenType != "preview_stream" ||
		claims.UserID == 0 || claims.NodeID == 0 || claims.NodeRevision == 0 ||
		strings.TrimSpace(claims.PreviewKind) == "" {
		return PreviewStreamClaims{}, errors.New("invalid preview stream token")
	}
	return *claims, nil
}

func NewRefreshToken() (raw string, hash string, err error) {
	var b [32]byte
	if _, err = rand.Read(b[:]); err != nil {
		return "", "", err
	}
	raw = base64.RawURLEncoding.EncodeToString(b[:])
	return raw, HashRefreshToken(raw), nil
}

func HashRefreshToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
