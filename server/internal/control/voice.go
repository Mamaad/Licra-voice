package control

import (
	"context"
	"licra/server/internal/media"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
)

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
	valid := p != nil && !p.revoked && p.voiceContext != nil && p.user.ChannelID != "" && claims.Video["room"] == "channel_"+p.user.ChannelID && s.allowed(p.user.Fingerprint, "channel.join", p.user.ChannelID)
	if valid && claims.Video["canPublish"] == true {
		valid = !p.user.ServerMuted && s.allowed(p.user.Fingerprint, "voice.speak", p.user.ChannelID)
	}
	var voiceContext context.Context
	if valid {
		voiceContext = p.voiceContext
		p.voiceProxies.Add(1)
	}
	s.mu.Unlock()
	if valid {
		defer p.voiceProxies.Done()
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
	proxy.ServeHTTP(w, r)
}
func (s *Server) disconnectVoice(ctx context.Context, p *client) error {
	if p.user.ChannelID == "" {
		return nil
	}
	if p.voiceCancel != nil {
		p.voiceCancel()
		p.voiceCancel = nil
	}
	p.voiceProxies.Wait()
	return s.media().Remove(ctx, p.user.ChannelID, p.user.ID)
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
