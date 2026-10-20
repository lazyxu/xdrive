package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const publicSharePreviewMaxTTL = 2 * time.Minute

// Public Share previews are never account previews or file-download tickets.
type PublicSharePreviewClaims struct {
	ShareID      uint64 `json:"sid"`
	NodeID       uint64 `json:"nid"`
	NodeRevision uint64 `json:"rev"`
	TokenType    string `json:"typ"`
	jwt.RegisteredClaims
}

func (m Manager) IssuePublicSharePreview(shareID, nodeID, nodeRevision uint64, ttl time.Duration) (string, time.Time, error) {
	if shareID == 0 || nodeID == 0 || nodeRevision == 0 || ttl <= 0 || ttl > publicSharePreviewMaxTTL {
		return "", time.Time{}, errors.New("invalid public preview claims")
	}
	now := time.Now()
	expires := now.Add(ttl)
	claims := PublicSharePreviewClaims{
		ShareID: shareID, NodeID: nodeID, NodeRevision: nodeRevision,
		TokenType: "public_share_preview",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expires),
			Audience:  jwt.ClaimStrings{"xdrive-public-share-preview"},
			Subject:   fmt.Sprintf("share-preview:%d", shareID),
		},
	}
	raw, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
	return raw, expires, err
}

func (m Manager) ParsePublicSharePreview(raw string) (PublicSharePreviewClaims, error) {
	claims := &PublicSharePreviewClaims{}
	token, err := jwt.ParseWithClaims(
		raw, claims,
		func(token *jwt.Token) (any, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, fmt.Errorf("unexpected signing method %v", token.Header["alg"])
			}
			return m.secret, nil
		},
		jwt.WithAudience("xdrive-public-share-preview"),
		jwt.WithExpirationRequired(),
	)
	if err != nil || !token.Valid || claims.TokenType != "public_share_preview" ||
		claims.ShareID == 0 || claims.NodeID == 0 || claims.NodeRevision == 0 {
		return PublicSharePreviewClaims{}, errors.New("invalid public share preview token")
	}
	return *claims, nil
}
