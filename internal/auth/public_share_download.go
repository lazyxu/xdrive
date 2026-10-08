package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const publicShareDownloadMaxTTL = 10 * time.Minute

type PublicShareDownloadClaims struct {
	ShareID      uint64 `json:"sid"`
	NodeID       uint64 `json:"nid"`
	NodeRevision uint64 `json:"rev"`
	TokenType    string `json:"typ"`
	jwt.RegisteredClaims
}

func (m Manager) IssuePublicShareDownload(
	shareID, nodeID, nodeRevision uint64,
	ttl time.Duration,
) (string, time.Time, error) {
	if shareID == 0 || nodeID == 0 || nodeRevision == 0 ||
		ttl <= 0 || ttl > publicShareDownloadMaxTTL {
		return "", time.Time{}, errors.New("invalid public share download claims")
	}
	now := time.Now()
	expiresAt := now.Add(ttl)
	claims := PublicShareDownloadClaims{
		ShareID:      shareID,
		NodeID:       nodeID,
		NodeRevision: nodeRevision,
		TokenType:    "public_share_download",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			Subject:   fmt.Sprintf("share:%d", shareID),
			Audience:  jwt.ClaimStrings{"xdrive-public-share-download"},
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
	return token, expiresAt, err
}

func (m Manager) ParsePublicShareDownload(tokenString string) (PublicShareDownloadClaims, error) {
	claims := &PublicShareDownloadClaims{}
	token, err := jwt.ParseWithClaims(
		tokenString,
		claims,
		func(token *jwt.Token) (any, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, fmt.Errorf("unexpected signing method %v", token.Header["alg"])
			}
			return m.secret, nil
		},
		jwt.WithAudience("xdrive-public-share-download"),
	)
	if err != nil || !token.Valid ||
		claims.TokenType != "public_share_download" ||
		claims.ShareID == 0 || claims.NodeID == 0 || claims.NodeRevision == 0 {
		return PublicShareDownloadClaims{}, errors.New("invalid public share download token")
	}
	return *claims, nil
}
