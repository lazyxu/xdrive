package auth

import (
	"errors"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// MapAccess is a distinct strictly verified access JWT identity for short-lived
// Baidu map-cookie minting. The ordinary access-token parser remains unchanged.
// It carries only signed identity and issued-at, never a Browser/Server AK.
type MapAccess struct {
	UserID         uint64
	SessionVersion uint64
	IssuedAt       time.Time
}

// ParseMapAccess rejects legacy tokens without a session version or issued-at.
// The map-only revocation cutoff is checked independently against fresh DB
// state; parsing a JWT alone is never permission to mint a map session.
func (m Manager) ParseMapAccess(tokenString string, now time.Time) (MapAccess, error) {
	denied := errors.New("invalid map bootstrap access token")
	if now.IsZero() || tokenString == "" {
		return MapAccess{}, denied
	}
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims,
		func(token *jwt.Token) (any, error) {
			if token.Method != jwt.SigningMethodHS256 {
				return nil, denied
			}
			return m.secret, nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithTimeFunc(func() time.Time { return now }),
	)
	if err != nil || !token.Valid || claims.TokenType != "access" ||
		claims.UserID == 0 || claims.SessionVersion == 0 ||
		claims.IssuedAt == nil || claims.ExpiresAt == nil ||
		claims.Subject != strconv.FormatUint(claims.UserID, 10) {
		return MapAccess{}, denied
	}
	issuedAt := claims.IssuedAt.Time
	if issuedAt.IsZero() || issuedAt.After(now) ||
		!claims.ExpiresAt.Time.After(now) {
		return MapAccess{}, denied
	}
	return MapAccess{UserID: claims.UserID, SessionVersion: claims.SessionVersion, IssuedAt: issuedAt}, nil
}
