package auth

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const sourceWriterAudience = "xdrive-source-writer"

// SourceWriterClaims is a distinct, signed authorization proof added ONLY by
// the trusted Pull worker. It is never accepted as an Owner access token.
// A verified proof alone does not grant write permission: API handlers also
// lock/validate the current Source, Run and exact target ancestry.
type SourceWriterClaims struct {
	OwnerID        uint64 `json:"uid"`
	SessionVersion uint64 `json:"ver"`
	SourceID       uint64 `json:"sid"`
	RunID          string `json:"rid"`
	SourceRevision uint64 `json:"srev"`
	TokenType      string `json:"typ"`
	jwt.RegisteredClaims
}

func (m Manager) IssueSourceWriter(
	ownerID, sessionVersion, sourceID, sourceRevision uint64,
	runID string, ttl time.Duration,
) (string, error) {
	runID = strings.TrimSpace(runID)
	if ownerID == 0 || sourceID == 0 || sourceRevision == 0 ||
		runID == "" || len(runID) > 64 || ttl <= 0 || ttl > time.Hour {
		return "", errors.New("invalid Source writer grant")
	}
	now := time.Now().UTC()
	claims := SourceWriterClaims{
		OwnerID: ownerID, SessionVersion: sessionVersion,
		SourceID: sourceID, RunID: runID, SourceRevision: sourceRevision,
		TokenType: "source_writer",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "xdrive-internal-pull-worker",
			Audience: jwt.ClaimStrings{sourceWriterAudience},
			IssuedAt: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(m.secret)
}

func (m Manager) ParseSourceWriter(raw string) (SourceWriterClaims, error) {
	claims := &SourceWriterClaims{}
	token, err := jwt.ParseWithClaims(
		strings.TrimSpace(raw), claims,
		func(t *jwt.Token) (any, error) {
			if t.Method != jwt.SigningMethodHS256 {
				return nil, fmt.Errorf("invalid Source writer signature algorithm")
			}
			return m.secret, nil
		},
		jwt.WithAudience(sourceWriterAudience),
		jwt.WithIssuer("xdrive-internal-pull-worker"),
	)
	if err != nil || !token.Valid ||
		claims.TokenType != "source_writer" ||
		claims.OwnerID == 0 || claims.SourceID == 0 ||
		claims.SourceRevision == 0 || claims.RunID == "" {
		return SourceWriterClaims{}, errors.New("invalid Source writer proof")
	}
	return *claims, nil
}
