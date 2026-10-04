package control

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"github.com/coder/websocket"
	"licra/server/internal/config"
	"licra/server/internal/media"
	"licra/server/internal/protocol"
	"licra/server/internal/store"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func setup(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	lk := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("{}"))
	}))
	t.Cleanup(lk.Close)
	u, _ := url.Parse(lk.URL)
	port, _ := strconv.Atoi(u.Port())
	c := config.Defaults()
	c.LiveKit.InternalPort = port
	c.LiveKit.APIKey = "test"
	c.LiveKit.APISecret = "test-secret-more-than-32-characters"
	c.Database.Path = filepath.Join(t.TempDir(), "db")
	d, e := store.Open(c.Database.Path)
	if e != nil {
		t.Fatal(e)
	}
	a, e := New(c, d)
	if e != nil {
		t.Fatal(e)
	}
	h := httptest.NewServer(a.Handler())
	t.Cleanup(func() { a.Close(); h.Close(); d.Close() })
	return a, h
}
func connectTest(t *testing.T, h *httptest.Server) (*websocket.Conn, map[string]any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, e := websocket.Dial(ctx, "ws"+strings.TrimPrefix(h.URL, "http")+"/ws", nil)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { c.CloseNow() })
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	write(ctx, c, protocol.Message("CLIENT_HELLO", "hello", map[string]any{"protocol_version": 1, "client_version": "0.1.0", "nickname": "Alice", "device_public_key": base64.StdEncoding.EncodeToString(pub)}))
	m, e := read(ctx, c)
	if e != nil || m.Type != "SERVER_HELLO" {
		t.Fatal(m, e)
	}
	var p map[string]any
	json.Unmarshal(m.Payload, &p)
	sig := base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte(p["challenge_context"].(string))))
	write(ctx, c, protocol.Message("AUTHENTICATE", "auth", map[string]string{"signature": sig}))
	m, e = read(ctx, c)
	if e != nil || m.Type != "SNAPSHOT" {
		t.Fatal(m, e)
	}
	json.Unmarshal(m.Payload, &p)
	return c, p
}
func receive(t *testing.T, c *websocket.Conn, kind string) protocol.Envelope {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		m, e := read(ctx, c)
		if e != nil {
			t.Fatal(e)
		}
		if m.Type == kind {
			return m
		}
	}
}
func TestPresence(t *testing.T) {
	_, h := setup(t)
	c, p := connectTest(t, h)
	if len(p["users"].([]any)) != 1 {
		t.Fatal(p)
	}
	ctx := context.Background()
	write(ctx, c, protocol.Message("SET_NICKNAME", "n", map[string]string{"nickname": "Bob"}))
	m := receive(t, c, "USER_UPDATED")
	var u User
	json.Unmarshal(m.Payload, &u)
	if u.Nickname != "Bob" {
		t.Fatal(u)
	}
}

func TestOwnerChannelsAndPermissions(t *testing.T) {
	a, h := setup(t)
	token, e := a.AdminToken(false)
	if e != nil {
		t.Fatal(e)
	}
	c, p := connectTest(t, h)
	chs := p["channels"].([]any)
	if len(chs) != 5 {
		t.Fatal(chs)
	}
	ch := chs[0].(map[string]any)["id"].(string)
	send := func(kind string, v any) {
		t.Helper()
		if e := write(context.Background(), c, protocol.Message(kind, "op", v)); e != nil {
			t.Fatal(e)
		}
	}
	send("CREATE_CHANNEL", map[string]any{"name": "Forbidden", "audio_profile": "standard"})
	m := receive(t, c, "ERROR")
	if !strings.Contains(string(m.Payload), "PERMISSION_DENIED") {
		t.Fatal(m)
	}
	send("CLAIM_OWNER", map[string]string{"token": token})
	receive(t, c, "ACK")
	if _, e = a.AdminToken(false); e == nil {
		t.Fatal("token not consumed")
	}
	send("CREATE_CHANNEL", map[string]any{"name": "Tests", "audio_profile": "eco", "is_permanent": true})
	m = receive(t, c, "CHANNEL_CREATED")
	var channel Channel
	json.Unmarshal(m.Payload, &channel)
	if channel.ID == "" || channel.AudioProfile != "eco" {
		t.Fatal(channel)
	}
	receive(t, c, "ACK")
	send("UPDATE_CHANNEL", map[string]any{"id": channel.ID, "parent_id": channel.ID, "name": "Cycle", "audio_profile": "standard"})
	receive(t, c, "ERROR")
	send("JOIN_CHANNEL", map[string]any{"channel_id": ch})
	receive(t, c, "USER_MOVED")
	receive(t, c, "ACK")
	var fp string
	for _, u := range p["users"].([]any) {
		fp = u.(map[string]any)["fingerprint"].(string)
	}
	send("ASSIGN_ROLE", map[string]any{"fingerprint": fp, "role_id": "Owner", "remove": true})
	m = receive(t, c, "ERROR")
	if !strings.Contains(string(m.Payload), "LAST_OWNER") {
		t.Fatal(m)
	}
}

func TestBanExpiration(t *testing.T) {
	now := time.Now()
	if !activeBan(sql.NullString{}, now) || activeBan(sql.NullString{String: now.Add(-time.Second).Format(time.RFC3339), Valid: true}, now) || !activeBan(sql.NullString{String: now.Add(time.Hour).Format(time.RFC3339), Valid: true}, now) {
		t.Fatal("ban expiration")
	}
}
func TestModerationAndScopedMove(t *testing.T) {
	a, h := setup(t)
	token, e := a.AdminToken(false)
	if e != nil {
		t.Fatal(e)
	}
	owner, first := connectTest(t, h)
	guest, second := connectTest(t, h)
	send := func(c *websocket.Conn, kind string, p any) {
		t.Helper()
		if e := write(context.Background(), c, protocol.Message(kind, "op", p)); e != nil {
			t.Fatal(e)
		}
	}
	send(owner, "CLAIM_OWNER", map[string]string{"token": token})
	receive(t, owner, "ACK")
	target := second["self_id"].(string)
	chs := first["channels"].([]any)
	one := chs[0].(map[string]any)["id"].(string)
	two := chs[1].(map[string]any)["id"].(string)
	send(guest, "MOVE_USER", map[string]string{"user_id": first["self_id"].(string), "channel_id": one})
	m := receive(t, guest, "ERROR")
	if !strings.Contains(string(m.Payload), "PERMISSION_DENIED") {
		t.Fatal(m)
	}
	send(guest, "JOIN_CHANNEL", map[string]string{"channel_id": one})
	m = receive(t, guest, "VOICE_JOIN")
	var voice struct {
		Token string `json:"token"`
	}
	json.Unmarshal(m.Payload, &voice)
	receive(t, guest, "ACK")
	lk := media.Service{Key: a.Config.LiveKit.APIKey, Secret: a.Config.LiveKit.APISecret}
	claims, e := lk.Verify(voice.Token)
	if e != nil || claims.Subject != target || claims.Video["room"] != "channel_"+one {
		t.Fatal(claims, e)
	}
	send(owner, "MOVE_USER", map[string]string{"user_id": target, "channel_id": two})
	receive(t, owner, "ACK")
	receive(t, guest, "VOICE_JOIN")
	send(owner, "MUTE_USER", map[string]any{"user_id": target, "muted": true})
	receive(t, owner, "ACK")
	send(owner, "BAN_USER", map[string]any{"user_id": target, "reason": "test", "expires_at": time.Now().Add(time.Minute).UTC().Format(time.RFC3339)})
	receive(t, guest, "BAN")
	receive(t, owner, "ACK")
	var n int
	a.DB.QueryRow("SELECT count(*) FROM bans").Scan(&n)
	if n != 1 {
		t.Fatal(n)
	}
}
func TestKick(t *testing.T) {
	a, h := setup(t)
	token, _ := a.AdminToken(false)
	o, _ := connectTest(t, h)
	g, p := connectTest(t, h)
	write(context.Background(), o, protocol.Message("CLAIM_OWNER", "claim", map[string]string{"token": token}))
	receive(t, o, "ACK")
	write(context.Background(), o, protocol.Message("KICK_USER", "kick", map[string]string{"user_id": p["self_id"].(string), "reason": "test"}))
	receive(t, g, "KICK")
	receive(t, o, "ACK")
}
func TestPermissionRevocation(t *testing.T) {
	a, h := setup(t)
	token, _ := a.AdminToken(false)
	o, p := connectTest(t, h)
	write(context.Background(), o, protocol.Message("CLAIM_OWNER", "claim", map[string]string{"token": token}))
	receive(t, o, "ACK")
	ch := p["channels"].([]any)[0].(map[string]any)["id"].(string)
	g, snapshot := connectTest(t, h)
	write(context.Background(), g, protocol.Message("JOIN_CHANNEL", "join", map[string]string{"channel_id": ch}))
	receive(t, g, "VOICE_JOIN")
	receive(t, g, "ACK")
	write(context.Background(), o, protocol.Message("SET_OVERRIDE", "override", map[string]string{"channel_id": ch, "role_id": "Guest", "permission": "channel.join", "effect": "DENY"}))
	receive(t, g, "VOICE_LEFT")
	receive(t, o, "ACK")
	if snapshot["self_id"] == nil {
		t.Fatal(snapshot)
	}
}

func TestTemporaryChannels(t *testing.T) {
	a, h := setup(t)
	token, _ := a.AdminToken(false)
	c, _ := connectTest(t, h)
	write(context.Background(), c, protocol.Message("CLAIM_OWNER", "claim", map[string]string{"token": token}))
	receive(t, c, "ACK")
	write(context.Background(), c, protocol.Message("CREATE_CHANNEL", "create", map[string]any{"name": "Temporary", "audio_profile": "standard", "is_permanent": false}))
	m := receive(t, c, "CHANNEL_CREATED")
	var ch Channel
	json.Unmarshal(m.Payload, &ch)
	receive(t, c, "ACK")
	write(context.Background(), c, protocol.Message("JOIN_CHANNEL", "join", map[string]string{"channel_id": ch.ID}))
	receive(t, c, "VOICE_JOIN")
	receive(t, c, "ACK")
	write(context.Background(), c, protocol.Message("LEAVE_CHANNEL", "leave", nil))
	receive(t, c, "CHANNEL_DELETED")
	receive(t, c, "ACK")
	a.mu.Lock()
	_, exists := a.channel(ch.ID)
	a.mu.Unlock()
	if exists {
		t.Fatal("empty temporary channel retained")
	}
}

func TestBootstrapAvailability(t *testing.T) {
	app, host := setup(t)
	token, err := app.AdminToken(false)
	if err != nil {
		t.Fatal(err)
	}
	owner, before := connectTest(t, host)
	if before["server"].(map[string]any)["bootstrap_available"] != true {
		t.Fatal(before["server"])
	}
	write(context.Background(), owner, protocol.Message("CLAIM_OWNER", "claim", map[string]string{"token": token}))
	receive(t, owner, "ACK")
	_, after := connectTest(t, host)
	if after["server"].(map[string]any)["bootstrap_available"] != false {
		t.Fatal(after["server"])
	}
}

func TestMediaProxyCancellationClosesSilentClient(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, e := websocket.Accept(w, r, nil)
		if e != nil {
			return
		}
		defer c.CloseNow()
		<-ctx.Done()
	}))
	defer upstream.Close()
	target, _ := url.Parse(upstream.URL)
	proxy := httputil.NewSingleHostReverseProxy(target)
	done := make(chan struct{})
	h := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxy.ServeHTTP(mediaResponseWriter{w, ctx}, r.WithContext(ctx))
		close(done)
	}))
	defer h.Close()
	c, _, e := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(h.URL, "http"), nil)
	if e != nil {
		t.Fatal(e)
	}
	defer c.CloseNow()
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("proxy waited for silent client after cancellation")
	}
}
