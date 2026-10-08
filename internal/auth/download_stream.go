package auth

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const downloadStreamMaxTTL = 30 * time.Minute

type DownloadStreamClaims struct {
	UserID           uint64 `json:"uid"`
	SessionVersion   uint64 `json:"ver,omitempty"`
	ResourceKind     string `json:"kind"`
	ResourceID       string `json:"rid"`
	ResourceRevision uint64 `json:"rev,omitempty"`
	TokenType        string `json:"typ"`
	jwt.RegisteredClaims
}

func (m Manager) IssueDownloadStream(
	userID, sessionVersion uint64,
	resourceKind, resourceID string,
	resourceRevision uint64,
	ttl time.Duration,
) (string, time.Time, error) {
	resourceKind = strings.TrimSpace(resourceKind)
	resourceID = strings.TrimSpace(resourceID)
	if userID == 0 ||
		resourceKind == "" || len(resourceKind) > 32 ||
		resourceID == "" || len(resourceID) > 256 ||
		ttl <= 0 || ttl > downloadStreamMaxTTL {
		return "", time.Time{}, errors.New("invalid download stream claims")
	}
	now := time.Now()
	expiresAt := now.Add(ttl)
	claims := DownloadStreamClaims{
		UserID:           userID,
		SessionVersion:   sessionVersion,
		ResourceKind:     resourceKind,
		ResourceID:       resourceID,
		ResourceRevision: resourceRevision,
		TokenType:        "download_stream",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			Subject:   fmt.Sprintf("%d", userID),
			Audience:  jwt.ClaimStrings{"xdrive-download-stream"},
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
	return token, expiresAt, err
}

func (m Manager) ParseDownloadStream(tokenString string) (DownloadStreamClaims, error) {
	claims := &DownloadStreamClaims{}
	token, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(token *jwt.Token) (any, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, fmt.Errorf("unexpected signing method %v", token.Header["alg"])
			}
			return m.secret, nil
		},
		jwt.WithAudience("xdrive-download-stream"),
	)
	if err != nil || !token.Valid ||
		claims.TokenType != "download_stream" ||
		claims.UserID == 0 ||
		strings.TrimSpace(claims.ResourceKind) == "" ||
		strings.TrimSpace(claims.ResourceID) == "" {
		return DownloadStreamClaims{}, errors.New("invalid download stream token")
	}
	return *claims, nil
}
