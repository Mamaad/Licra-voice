package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"strings"
	"time"
)

type Challenge struct {
	Nonce   string
	Context string
	Expires time.Time
	used    bool
}

func New(server, version, nickname, key string) *Challenge {
	b := make([]byte, 32)
	rand.Read(b)
	nonce := base64.StdEncoding.EncodeToString(b)
	return &Challenge{Nonce: nonce, Context: strings.Join([]string{"licra:v1", server, nonce, version, nickname, key}, "\n"), Expires: time.Now().Add(10 * time.Second)}
}
func (c *Challenge) Verify(key, signature string) bool {
	if c.used {
		return false
	}
	c.used = true
	if time.Now().After(c.Expires) {
		return false
	}
	k, e := base64.StdEncoding.DecodeString(key)
	if e != nil || len(k) != ed25519.PublicKeySize {
		return false
	}
	sig, e := base64.StdEncoding.DecodeString(signature)
	return e == nil && ed25519.Verify(k, []byte(c.Context), sig)
}
func Fingerprint(key []byte) string {
	h := sha256.Sum256(key)
	s := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(h[:])
	var parts []string
	for len(s) > 4 {
		parts = append(parts, s[:4])
		s = s[4:]
	}
	return strings.Join(append(parts, s), "-")
}
