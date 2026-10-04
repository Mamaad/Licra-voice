package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"testing"
	"time"
)

func TestChallenge(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	k := base64.StdEncoding.EncodeToString(pub)
	c := New("s", "0.1.0", "Alice", k)
	sig := base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte(c.Context)))
	if !c.Verify(k, sig) || c.Verify(k, sig) {
		t.Fatal("verify or replay")
	}
	c = New("s", "0.1.0", "Alice", k)
	c.Expires = time.Now().Add(-time.Second)
	sig = base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte(c.Context)))
	if c.Verify(k, sig) {
		t.Fatal("expired")
	}
	c = New("other", "0.1.0", "Alice", k)
	if c.Verify(k, sig) {
		t.Fatal("cross server")
	}
}
