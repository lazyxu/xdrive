package clipboardcrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"regexp"
	"strconv"
	"unicode/utf8"
)

var ErrInvalidEnvelope = errors.New("invalid targeted Clipboard E2EE envelope")

const maxPlain = 65536

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$`)

type Envelope struct {
	ClientEventID  string
	TargetDeviceID string
	Kind           string
	NodeID         uint64
	EphemeralKey   string
	WrappedKey     string
	Nonce          string
	Ciphertext     string
}

func decode(raw string, size int) ([]byte, error) {
	data, err := base64.StdEncoding.Strict().DecodeString(raw)
	if err != nil || len(data) != size || base64.StdEncoding.EncodeToString(data) != raw {
		return nil, ErrInvalidEnvelope
	}
	return data, nil
}

func contentBytes(raw string) ([]byte, error) {
	data, err := base64.StdEncoding.Strict().DecodeString(raw)
	if err != nil || len(data) < 17 || len(data) > maxPlain+16 ||
		base64.StdEncoding.EncodeToString(data) != raw {
		return nil, ErrInvalidEnvelope
	}
	return data, nil
}

func context(scope string, v Envelope) (string, error) {
	if scope == "" || len(scope) > 512 || !uuidPattern.MatchString(v.ClientEventID) ||
		!uuidPattern.MatchString(v.TargetDeviceID) {
		return "", ErrInvalidEnvelope
	}
	switch v.Kind {
	case "text/plain", "text/uri-list":
		if v.NodeID != 0 {
			return "", ErrInvalidEnvelope
		}
	case "image/x-xdrive-node-ref", "application/x-xdrive-node-ref":
		if v.NodeID == 0 {
			return "", ErrInvalidEnvelope
		}
	default:
		return "", ErrInvalidEnvelope
	}
	return "xdrive-clipboard-target-v1|" + scope + "|" + v.ClientEventID + "|" + v.TargetDeviceID, nil
}

func wrapKey(shared []byte, base string) []byte {
	salt := sha256.Sum256([]byte(base + "|salt"))
	extract := hmac.New(sha256.New, salt[:])
	extract.Write(shared)
	prk := extract.Sum(nil)
	defer clear(prk)
	expansion := hmac.New(sha256.New, prk)
	expansion.Write([]byte(base + "|wrap"))
	expansion.Write([]byte{1})
	return expansion.Sum(nil)
}

// GenerateDeviceKey creates an independently enrolled X25519 installation
// identity. The caller MUST persist the private key only inside the OS-bound
// credential store, with the exact current Owner/Server/device scope.
func GenerateDeviceKey() ([]byte, []byte, error) {
	key, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	return key.Bytes(), key.PublicKey().Bytes(), nil
}

// Decrypt exposes plaintext only inside an Owner-verified receiving Agent.
// The server, browser CGI, and ordinary UI never see the private key.
// A targeted Node reference is NOT a File read grant: Viewer must recheck ACL.
func Decrypt(scope string, deviceID string, privateRaw []byte, v Envelope) (string, error) {
	if v.TargetDeviceID != deviceID || len(privateRaw) != 32 {
		return "", ErrInvalidEnvelope
	}
	base, err := context(scope, v)
	if err != nil {
		return "", err
	}
	ephemeral, err := decode(v.EphemeralKey, 32)
	if err != nil {
		return "", err
	}
	wrapped, err := decode(v.WrappedKey, 60)
	if err != nil {
		return "", err
	}
	nonce, err := decode(v.Nonce, 12)
	if err != nil {
		return "", err
	}
	ciphertext, err := contentBytes(v.Ciphertext)
	if err != nil {
		return "", err
	}
	priv, err := ecdh.X25519().NewPrivateKey(privateRaw)
	if err != nil {
		return "", ErrInvalidEnvelope
	}
	pub, err := ecdh.X25519().NewPublicKey(ephemeral)
	if err != nil {
		return "", ErrInvalidEnvelope
	}
	shared, err := priv.ECDH(pub)
	if err != nil {
		return "", ErrInvalidEnvelope
	}
	defer clear(shared)
	wrapping := wrapKey(shared, base)
	defer clear(wrapping)
	aesWrap, err := aes.NewCipher(wrapping)
	if err != nil {
		return "", ErrInvalidEnvelope
	}
	gcmWrap, err := cipher.NewGCM(aesWrap)
	if err != nil {
		return "", ErrInvalidEnvelope
	}
	node := strconv.FormatUint(v.NodeID, 10)
	secret, err := gcmWrap.Open(nil, wrapped[:12], wrapped[12:],
		[]byte(base+"|key|"+v.Kind+"|"+node))
	if err != nil || len(secret) != 32 {
		return "", ErrInvalidEnvelope
	}
	defer clear(secret)
	aesContent, err := aes.NewCipher(secret)
	if err != nil {
		return "", ErrInvalidEnvelope
	}
	gcmContent, err := cipher.NewGCM(aesContent)
	if err != nil {
		return "", ErrInvalidEnvelope
	}
	cleartext, err := gcmContent.Open(nil, nonce, ciphertext,
		[]byte(base+"|content|"+v.Kind+"|"+node))
	if err != nil || len(cleartext) < 1 || len(cleartext) > maxPlain {
		return "", ErrInvalidEnvelope
	}
	defer clear(cleartext)
	// Do not replace malformed UTF-8. The browser and Native decoders use
	// fatal UTF-8 and must agree on the same authenticated message.
	if !utf8.Valid(cleartext) {
		return "", ErrInvalidEnvelope
	}
	return string(cleartext), nil
}
