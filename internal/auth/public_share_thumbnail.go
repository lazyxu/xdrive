package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const publicShareThumbnailMaxTTL = 2 * time.Minute

// A thumbnail ticket is purpose-separated from public original previews,
// file downloads, archives and account sessions.
type PublicShareThumbnailClaims struct {
	ShareID      uint64 `json:"sid"`
	NodeID       uint64 `json:"nid"`
	NodeRevision uint64 `json:"rev"`
	TokenType    string `json:"typ"`
	jwt.RegisteredClaims
}

func (m Manager) IssuePublicShareThumbnail(shareID, nodeID, nodeRevision uint64, ttl time.Duration) (string, time.Time, error) {
	if shareID == 0 || nodeID == 0 || nodeRevision == 0 || ttl <= 0 || ttl > publicShareThumbnailMaxTTL {
		return "", time.Time{}, errors.New("invalid public thumbnail claims")
	}
	now := time.Now()
	expires := now.Add(ttl)
	claims := PublicShareThumbnailClaims{
		ShareID: shareID, NodeID: nodeID, NodeRevision: nodeRevision,
		TokenType: "public_share_thumbnail",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expires),
			Audience:  jwt.ClaimStrings{"xdrive-public-share-thumbnail"},
			Subject:   fmt.Sprintf("share-thumbnail:%d", shareID),
		},
	}
	raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
	return raw, expires, err
}

func (m Manager) ParsePublicShareThumbnail(raw string) (PublicShareThumbnailClaims, error) {
	claims := &PublicShareThumbnailClaims{}
	token, err := jwt.ParseWithClaims(
		raw, claims,
		func(token *jwt.Token) (any, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, fmt.Errorf("unexpected signing method %v", token.Header["alg"])
			}
			return m.secret, nil
		},
		jwt.WithAudience("xdrive-public-share-thumbnail"),
		jwt.WithExpirationRequired(),
	)
	if err != nil || !token.Valid || claims.TokenType != "public_share_thumbnail" ||
		claims.ShareID == 0 || claims.NodeID == 0 || claims.NodeRevision == 0 {
		return PublicShareThumbnailClaims{}, errors.New("invalid public thumbnail ticket")
	}
	return *claims, nil
}
