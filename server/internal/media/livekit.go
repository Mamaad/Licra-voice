package media

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/golang-jwt/jwt/v5"
	"io"
	"net/http"
	"time"
)

type Service struct {
	URL, Key, Secret string
	HTTP             *http.Client
}
type Claims struct {
	jwt.RegisteredClaims
	Name  string         `json:"name,omitempty"`
	Video map[string]any `json:"video"`
}

func (s Service) token(identity, name string, grant map[string]any) (string, error) {
	now := time.Now()
	return jwt.NewWithClaims(jwt.SigningMethodHS256, Claims{RegisteredClaims: jwt.RegisteredClaims{Issuer: s.Key, Subject: identity, IssuedAt: jwt.NewNumericDate(now), NotBefore: jwt.NewNumericDate(now.Add(-2 * time.Second)), ExpiresAt: jwt.NewNumericDate(now.Add(45 * time.Second))}, Name: name, Video: grant}).SignedString([]byte(s.Secret))
}
func (s Service) JoinToken(identity, name, channel string, speak bool) (string, error) {
	return s.token(identity, name, map[string]any{"roomJoin": true, "room": "channel_" + channel, "canPublish": speak, "canSubscribe": true, "canPublishData": false, "canPublishSources": []string{"microphone"}})
}
func (s Service) Verify(token string) (*Claims, error) {
	c := new(Claims)
	_, e := jwt.ParseWithClaims(token, c, func(t *jwt.Token) (any, error) { return []byte(s.Secret), nil }, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(s.Key), jwt.WithExpirationRequired())
	return c, e
}
func (s Service) Call(ctx context.Context, method, room string, payload any, out any) error {
	grant := map[string]any{"roomAdmin": true, "room": room}
	if method == "CreateRoom" || method == "DeleteRoom" {
		grant["roomCreate"] = true
	}
	token, e := s.token("licra-control", "", grant)
	if e != nil {
		return e
	}
	body, e := json.Marshal(payload)
	if e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, e := http.NewRequestWithContext(ctx, "POST", s.URL+"/twirp/livekit.RoomService/"+method, bytes.NewReader(body))
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	client := s.HTTP
	if client == nil {
		client = http.DefaultClient
	}
	resp, e := client.Do(req)
	if e != nil {
		return fmt.Errorf("LiveKit unavailable: %w", e)
	}
	defer resp.Body.Close()
	b, e := io.ReadAll(io.LimitReader(resp.Body, 1048576))
	if e != nil {
		return e
	}
	if resp.StatusCode >= 300 {
		var v struct {
			Code string `json:"code"`
		}
		json.Unmarshal(b, &v)
		if method == "RemoveParticipant" && v.Code == "not_found" {
			return nil
		}
		return fmt.Errorf("LiveKit %s failed: status %d", method, resp.StatusCode)
	}
	if out != nil {
		return json.Unmarshal(b, out)
	}
	return nil
}
func (s Service) Ensure(ctx context.Context, ch string) error {
	return s.Call(ctx, "CreateRoom", "channel_"+ch, map[string]any{"name": "channel_" + ch, "empty_timeout": 60, "departure_timeout": 20}, nil)
}
func (s Service) Remove(ctx context.Context, ch, id string) error {
	if ch == "" {
		return nil
	}
	return s.Call(ctx, "RemoveParticipant", "channel_"+ch, map[string]string{"room": "channel_" + ch, "identity": id}, nil)
}
func (s Service) Permission(ctx context.Context, ch, id string, speak bool) error {
	return s.Call(ctx, "UpdateParticipant", "channel_"+ch, map[string]any{"room": "channel_" + ch, "identity": id, "permission": map[string]any{"can_publish": speak, "can_subscribe": true, "can_publish_data": false, "can_publish_sources": []int{2}}}, nil)
}
