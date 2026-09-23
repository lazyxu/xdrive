package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
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
