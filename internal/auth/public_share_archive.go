package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Unlike file tickets, a public ZIP ticket is bound to one completed,
// share-scoped durable prepare run. It cannot be used as account authentication.
const publicShareArchiveMaxTTL = 5 * time.Minute

type PublicShareArchiveClaims struct {
	ShareID      uint64 `json:"sid"`
	RootID       uint64 `json:"rid"`
	RootRevision uint64 `json:"rev"`
	PrepareID    string `json:"pid"`
	TokenType    string `json:"typ"`
	jwt.RegisteredClaims
}

func (m Manager) IssuePublicShareArchive(
	shareID, rootID, rootRevision uint64, prepareID string, ttl time.Duration,
) (string, time.Time, error) {
	if shareID == 0 || rootID == 0 || rootRevision == 0 ||
		len(prepareID) != 36 || ttl <= 0 || ttl > publicShareArchiveMaxTTL {
		return "", time.Time{}, errors.New("invalid public share archive claims")
	}
	now := time.Now().UTC()
	expiresAt := now.Add(ttl)
	claims := PublicShareArchiveClaims{
		ShareID: shareID, RootID: rootID, RootRevision: rootRevision,
		PrepareID: prepareID, TokenType: "public_share_archive",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			Subject:   fmt.Sprintf("share:%d", shareID),
			Audience:  jwt.ClaimStrings{"xdrive-public-share-archive"},
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
	return token, expiresAt, err
}

func (m Manager) ParsePublicShareArchive(raw string) (PublicShareArchiveClaims, error) {
	claims := &PublicShareArchiveClaims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method %v", token.Header["alg"])
		}
		return m.secret, nil
	}, jwt.WithAudience("xdrive-public-share-archive"))
	if err != nil || !token.Valid ||
		claims.TokenType != "public_share_archive" ||
		claims.ShareID == 0 || claims.RootID == 0 || claims.RootRevision == 0 ||
		len(claims.PrepareID) != 36 {
		return PublicShareArchiveClaims{}, errors.New("invalid public archive ticket")
	}
	return *claims, nil
}
