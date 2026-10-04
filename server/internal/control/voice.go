package control

import (
	"bufio"
	"context"
	"licra/server/internal/media"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
)

// Close the client half too: ReverseProxy may wait for both directions after a backend EOF.
type mediaResponseWriter struct {
	http.ResponseWriter
	ctx context.Context
}

func (w mediaResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w mediaResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	conn, rw, e := http.NewResponseController(w.ResponseWriter).Hijack()
	if e == nil {
		context.AfterFunc(w.ctx, func() { _ = conn.Close() })
	}
	return conn, rw, e
}

func (s *Server) media() media.Service {
	return media.Service{URL: "http://127.0.0.1:" + strconv.Itoa(s.Config.LiveKit.InternalPort), Key: s.Config.LiveKit.APIKey, Secret: s.Config.LiveKit.APISecret}
}
func (s *Server) signaling(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/livekit")
	origin := r.Header.Get("Origin")
	allowedOrigin := origin == "" || origin == "tauri://localhost" || origin == "http://tauri.localhost" || origin == "https://tauri.localhost" || origin == "http://localhost:1420" || origin == "http://127.0.0.1:1420"
	if !allowedOrigin {
		http.Error(w, "origin denied", 403)
		return
	}
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Add("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	}
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != "GET" {
		http.Error(w, "method denied", 405)
		return
	}
	if path != "/rtc" && path != "/rtc/v1" && path != "/rtc/validate" && path != "/rtc/v1/validate" {
		http.NotFound(w, r)
		return
	}
	token := r.URL.Query().Get("access_token")
	if token == "" {
		token = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	}
	claims, e := s.media().Verify(token)
	if e != nil {
		http.Error(w, "invalid media credentials", 401)
		return
	}
	s.mu.Lock()
	p := s.clients[claims.Subject]
	valid := p != nil && !p.revoked && p.user.ChannelID != "" && s.allowed(p.user.Fingerprint, "channel.join", p.user.ChannelID)
	screen := claims.Video["room"] == "screen_"+func() string {
		if p != nil {
			return p.user.ChannelID
		}
		return ""
	}()
	var voiceContext context.Context
	if valid && screen {
		valid = s.Config.Screen.Enabled && p.screenContext != nil
		if claims.Video["canPublish"] == true {
			valid = valid && p.screenActive && s.allowed(p.user.Fingerprint, "screen.share", p.user.ChannelID)
		}
		if claims.Video["canSubscribe"] == true {
			valid = valid && s.allowed(p.user.Fingerprint, "screen.watch", p.user.ChannelID)
		}
		if valid {
			voiceContext = p.screenContext
			p.screenProxies.Add(1)
		}
	} else if valid {
		valid = p.voiceContext != nil && claims.Video["room"] == "channel_"+p.user.ChannelID
		if claims.Video["canPublish"] == true {
			valid = valid && !p.user.ServerMuted && s.allowed(p.user.Fingerprint, "voice.speak", p.user.ChannelID)
		}
		if valid {
			voiceContext = p.voiceContext
			p.voiceProxies.Add(1)
		}
	}
	s.mu.Unlock()
	if valid {
		if screen {
			defer p.screenProxies.Done()
		} else {
			defer p.voiceProxies.Done()
		}
		ctx, cancel := context.WithCancel(r.Context())
		stop := context.AfterFunc(voiceContext, cancel)
		defer stop()
		defer cancel()
		r = r.WithContext(ctx)
	}
	if !valid {
		http.Error(w, "media permission denied", 403)
		return
	}
	target, _ := url.Parse(s.media().URL)
	proxy := httputil.NewSingleHostReverseProxy(target)
	original := proxy.Director
	proxy.Director = func(req *http.Request) {
		original(req)
		req.URL.Path = path
		req.Header.Del("X-Forwarded-For")
		req.Header.Del("X-Forwarded-Host")
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		if origin != "" {
			resp.Header.Set("Access-Control-Allow-Origin", origin)
			resp.Header.Add("Vary", "Origin")
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) { http.Error(w, "media unavailable", 502) }
	proxy.ServeHTTP(mediaResponseWriter{w, r.Context()}, r)
}
func (s *Server) disconnectVoice(ctx context.Context, p *client) error {
	if e := s.disconnectScreen(ctx, p); e != nil {
		return e
	}
	if p.user.ChannelID == "" {
		return nil
	}
	cancel := p.voiceCancel
	p.voiceCancel = nil
	p.voiceContext = nil
	// Let LiveKit send its definitive leave before closing the signaling proxy.
	// Closing the proxy first can race participant reconnect/negotiation teardown.
	err := s.media().Remove(ctx, p.user.ChannelID, p.user.ID)
	if cancel != nil {
		cancel()
	}
	p.voiceProxies.Wait()
	return err
}
func (s *Server) reconcileVoice() {
	for _, p := range s.clients {
		ch := p.user.ChannelID
		if ch == "" {
			continue
		}
		if !s.allowed(p.user.Fingerprint, "channel.join", ch) {
			if e := s.disconnectVoice(context.Background(), p); e != nil {
				p.cancel()
				slog.Error("media revocation failed", "error", e)
				continue
			}
			p.user.ChannelID = ""
			s.send(p, "VOICE_LEFT", "", nil)
			s.broadcast("USER_MOVED", p.user)
			continue
		}
		if p.revoked {
			continue
		}
		if e := s.media().Permission(context.Background(), ch, p.user.ID, !p.user.ServerMuted && s.allowed(p.user.Fingerprint, "voice.speak", ch)); e != nil {
			s.send(p, "VOICE_REJOIN_REQUIRED", "", nil)
		}
	}
}
