package media

import (
	"github.com/golang-jwt/jwt/v5"
	"testing"
	"time"
)

func TestToken(t *testing.T) {
	s := Service{Key: "test", Secret: "a-test-secret-long-enough-for-hmac"}
	token, e := s.JoinToken("device", "Alice", "abc", false)
	if e != nil {
		t.Fatal(e)
	}
	c, e := s.Verify(token)
	if e != nil || c.Subject != "device" || c.Video["room"] != "channel_abc" || c.Video["canPublish"] != false {
		t.Fatal(c, e)
	}
	c.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Minute))
	token, _ = jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString([]byte(s.Secret))
	if _, e = s.Verify(token); e == nil {
		t.Fatal("expired token")
	}
	s.Secret = "wrong"
	if _, e = s.Verify(token); e == nil {
		t.Fatal("signature")
	}
}
