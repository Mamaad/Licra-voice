package control

import (
	"context"
	"crypto/ed25519"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/coder/websocket"
	"github.com/google/uuid"
	"licra/server/internal/config"
	"licra/server/internal/identity"
	"licra/server/internal/permissions"
	"licra/server/internal/protocol"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode"
)

type User struct {
	ID          string `json:"id"`
	Fingerprint string `json:"fingerprint"`
	Nickname    string `json:"nickname"`
	ChannelID   string `json:"channel_id"`
	Muted       bool   `json:"muted"`
	Deafened    bool   `json:"deafened"`
	ServerMuted bool   `json:"server_muted"`
}
type client struct {
	user         User
	conn         *websocket.Conn
	out          chan protocol.Envelope
	cancel       context.CancelFunc
	ip           string
	window       time.Time
	requests     int
	sensitive    time.Time
	revoked      bool
	voiceContext context.Context
	voiceCancel  context.CancelFunc
	voiceProxies sync.WaitGroup
}
type bucket struct {
	start time.Time
	n     int
}

// ponytail: control mutations are serialized; move media I/O outside this lock if measured control latency requires it.
type Server struct {
	Config  config.Config
	DB      *sql.DB
	ID      string
	started time.Time
	mu      sync.Mutex
	clients map[string]*client
	rates   map[string]bucket
	policy  *permissions.Policy
	pending int
	closing bool
}

func New(c config.Config, db *sql.DB) (*Server, error) {
	s := &Server{Config: c, DB: db, started: time.Now(), clients: map[string]*client{}, rates: map[string]bucket{}}
	id := uuid.NewString()
	if _, e := db.Exec("INSERT OR IGNORE INTO server_config VALUES ('id',?)", id); e != nil {
		return nil, e
	}
	if e := db.QueryRow("SELECT value FROM server_config WHERE key='id'").Scan(&s.ID); e != nil {
		return nil, e
	}
	if e := s.seed(); e != nil {
		return nil, e
	}
	if e := s.reloadPolicy(); e != nil {
		return nil, e
	}
	return s, nil
}
func (s *Server) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /health", s.health)
	m.HandleFunc("GET /ws", s.connect)
	m.HandleFunc("/livekit/", s.signaling)
	return m
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	n := len(s.clients)
	s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"status": "ok", "server_version": protocol.ServerVersion, "protocol_version": protocol.Version, "uptime": time.Since(s.started).Seconds(), "connected_clients": n})
}
func validName(n string, max int) bool {
	if strings.TrimSpace(n) == "" || len([]rune(n)) > max {
		return false
	}
	for _, r := range n {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}
func (s *Server) limit(ip string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if len(s.rates) > 10000 {
		for k, b := range s.rates {
			if now.Sub(b.start) > time.Minute {
				delete(s.rates, k)
			}
		}
		if len(s.rates) > 10000 {
			return false
		}
	}
	b := s.rates[ip]
	if now.Sub(b.start) > time.Minute {
		b = bucket{start: now}
	}
	b.n++
	s.rates[ip] = b
	return b.n <= s.Config.Security.HandshakeRateLimit
}
func read(ctx context.Context, c *websocket.Conn) (protocol.Envelope, error) {
	_, b, e := c.Read(ctx)
	var m protocol.Envelope
	if e != nil {
		return m, e
	}
	e = json.Unmarshal(b, &m)
	if len(m.RequestID) > 100 || len(m.Type) > 64 {
		return m, fmt.Errorf("invalid envelope")
	}
	return m, e
}
func write(ctx context.Context, c *websocket.Conn, m protocol.Envelope) error {
	b, e := json.Marshal(m)
	if e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return c.Write(ctx, websocket.MessageText, b)
}
func (s *Server) connect(w http.ResponseWriter, r *http.Request) {
	ip, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil {
		http.Error(w, "invalid peer", 400)
		return
	}
	if !s.limit(ip) {
		http.Error(w, "rate limited", 429)
		return
	}
	s.mu.Lock()
	if s.closing || s.pending >= s.Config.Server.MaxClients*2 {
		s.mu.Unlock()
		http.Error(w, "server busy", 503)
		return
	}
	s.pending++
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.pending--; s.mu.Unlock() }()
	c, e := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420"}})
	if e != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(65536)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	hs, end := context.WithTimeout(ctx, 10*time.Second)
	defer end()
	hello, e := read(hs, c)
	if e != nil || hello.Type != "CLIENT_HELLO" {
		return
	}
	var h struct {
		ProtocolVersion int      `json:"protocol_version"`
		ClientVersion   string   `json:"client_version"`
		Nickname        string   `json:"nickname"`
		PublicKey       string   `json:"device_public_key"`
		Platform        string   `json:"platform"`
		Capabilities    []string `json:"capabilities"`
	}
	if json.Unmarshal(hello.Payload, &h) != nil || !validName(h.Nickname, 32) {
		write(hs, c, protocol.Message("ERROR", hello.RequestID, map[string]string{"code": "INVALID_INPUT"}))
		return
	}
	if !protocol.Compatible(h.ProtocolVersion, h.ClientVersion, s.Config.Server.MinimumClientVersion) {
		write(hs, c, protocol.Message("ERROR", hello.RequestID, map[string]string{"code": "INCOMPATIBLE_VERSION", "minimum_client_version": s.Config.Server.MinimumClientVersion}))
		return
	}
	pub, e := base64.StdEncoding.DecodeString(h.PublicKey)
	if e != nil || len(pub) != ed25519.PublicKeySize {
		return
	}
	challenge := identity.New(s.ID, h.ClientVersion, h.Nickname, h.PublicKey)
	if write(hs, c, protocol.Message("SERVER_HELLO", hello.RequestID, map[string]any{"protocol_version": protocol.Version, "server_version": protocol.ServerVersion, "server_name": s.Config.Server.Name, "server_id": s.ID, "nonce": challenge.Nonce, "challenge_context": challenge.Context, "media_configuration": map[string]any{"signaling_path": "/livekit", "udp_port": s.Config.LiveKit.MediaUDPPort, "tcp_port": s.Config.LiveKit.MediaTCPPort}, "minimum_client_version": s.Config.Server.MinimumClientVersion, "features": []string{"voice"}})) != nil {
		return
	}
	auth, e := read(hs, c)
	var a struct {
		Signature string `json:"signature"`
	}
	if e != nil || auth.Type != "AUTHENTICATE" || json.Unmarshal(auth.Payload, &a) != nil || !challenge.Verify(h.PublicKey, a.Signature) {
		write(hs, c, protocol.Message("ERROR", auth.RequestID, map[string]string{"code": "AUTH_FAILED"}))
		return
	}
	p := &client{user: User{ID: uuid.NewString(), Fingerprint: identity.Fingerprint(pub), Nickname: h.Nickname}, conn: c, out: make(chan protocol.Envelope, 128), cancel: cancel, ip: ip}
	s.mu.Lock()
	if s.closing || len(s.clients) >= s.Config.Server.MaxClients {
		s.mu.Unlock()
		write(ctx, c, protocol.Message("ERROR", auth.RequestID, map[string]string{"code": "SERVER_FULL"}))
		return
	}
	for _, other := range s.clients {
		if other.user.Fingerprint == p.user.Fingerprint {
			s.mu.Unlock()
			write(ctx, c, protocol.Message("ERROR", auth.RequestID, map[string]string{"code": "IDENTITY_CONNECTED"}))
			return
		}
	}
	if _, e = s.DB.Exec("INSERT OR IGNORE INTO devices VALUES (?,?,?)", p.user.Fingerprint, h.PublicKey, time.Now().UTC().Format(time.RFC3339)); e != nil {
		s.mu.Unlock()
		return
	}
	if banned, e := s.banned(p.user.Fingerprint, ip); e != nil || banned {
		s.mu.Unlock()
		write(ctx, c, protocol.Message("ERROR", auth.RequestID, map[string]string{"code": "BANNED"}))
		return
	}
	s.clients[p.user.ID] = p
	if _, e = s.DB.Exec("INSERT OR IGNORE INTO device_roles VALUES (?,'Guest','')", p.user.Fingerprint); e != nil {
		delete(s.clients, p.user.ID)
		s.mu.Unlock()
		return
	}
	if e = s.reloadPolicy(); e != nil {
		delete(s.clients, p.user.ID)
		s.mu.Unlock()
		return
	}
	if !s.allowed(p.user.Fingerprint, "server.view", "") {
		delete(s.clients, p.user.ID)
		s.mu.Unlock()
		write(ctx, c, protocol.Message("ERROR", auth.RequestID, map[string]string{"code": "PERMISSION_DENIED"}))
		return
	}
	if e = s.snapshot(p, auth.RequestID); e != nil {
		delete(s.clients, p.user.ID)
		s.mu.Unlock()
		return
	}
	s.broadcast("USER_CONNECTED", p.user)
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		if e := s.disconnectVoice(context.Background(), p); e != nil {
			slog.Error("media disconnect", "error", e)
		}
		delete(s.clients, p.user.ID)
		s.broadcast("USER_DISCONNECTED", map[string]string{"id": p.user.ID})
		s.mu.Unlock()
	}()
	go s.writer(ctx, p)
	for {
		rd, stop := context.WithTimeout(ctx, 45*time.Second)
		m, e := read(rd, c)
		stop()
		if e != nil {
			return
		}
		s.mu.Lock()
		if time.Since(p.window) > time.Second {
			p.window = time.Now()
			p.requests = 0
		}
		p.requests++
		if p.requests > 30 {
			s.sendError(p, m.RequestID, "RATE_LIMITED")
			s.mu.Unlock()
			continue
		}
		if p.revoked {
			s.mu.Unlock()
			return
		}
		s.handle(ctx, p, m)
		s.mu.Unlock()
	}
}
func (s *Server) writer(ctx context.Context, p *client) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	defer p.cancel()
	for {
		select {
		case <-ctx.Done():
			return
		case m := <-p.out:
			if write(ctx, p.conn, m) != nil {
				return
			}
			if m.Type == "KICK" || m.Type == "BAN" {
				return
			}
		case <-ticker.C:
			if write(ctx, p.conn, protocol.Message("PING", "", nil)) != nil {
				return
			}
		}
	}
}
func (s *Server) send(p *client, kind, id string, data any) {
	select {
	case p.out <- protocol.Message(kind, id, data):
	default:
		p.cancel()
	}
}
func (s *Server) broadcast(kind string, data any) {
	m := protocol.Message(kind, "", data)
	for _, p := range s.clients {
		select {
		case p.out <- m:
		default:
			p.cancel()
		}
	}
}
func (s *Server) sendError(p *client, id, code string) {
	s.send(p, "ERROR", id, map[string]string{"code": code})
}
func (s *Server) users() []User {
	u := make([]User, 0, len(s.clients))
	for _, p := range s.clients {
		u = append(u, p.user)
	}
	return u
}
func (s *Server) handle(ctx context.Context, p *client, m protocol.Envelope) {
	switch m.Type {
	case "PING":
		s.send(p, "PONG", m.RequestID, nil)
	case "PONG":
	case "SET_NICKNAME":
		var v struct {
			Nickname string `json:"nickname"`
		}
		if json.Unmarshal(m.Payload, &v) != nil || !validName(v.Nickname, 32) {
			s.sendError(p, m.RequestID, "INVALID_INPUT")
			return
		}
		p.user.Nickname = v.Nickname
		s.broadcast("USER_UPDATED", p.user)
		s.send(p, "ACK", m.RequestID, nil)
	default:
		s.operation(ctx, p, m)
	}
}
func (s *Server) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closing = true
	for _, p := range s.clients {
		p.cancel()
		p.conn.CloseNow()
	}
}

var _ = slog.Info
