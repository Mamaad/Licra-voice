package control

import (
	"context"
	"encoding/json"
	"licra/server/internal/protocol"
	"time"
)

type screenOptions struct {
	Quality string `json:"quality"`
	FPS     int    `json:"fps"`
	Content string `json:"content"`
}

func (s *Server) screenState() []map[string]any {
	out := []map[string]any{}
	for _, p := range s.clients {
		if p.screenActive && !p.revoked {
			out = append(out, map[string]any{"user_id": p.user.ID, "channel_id": p.user.ChannelID, "nickname": p.user.Nickname, "quality": p.screenOptions.Quality, "fps": p.screenOptions.FPS})
		}
	}
	return out
}
func (s *Server) sendScreenState(p *client) {
	shares := []map[string]any{}
	for _, share := range s.screenState() {
		ch := share["channel_id"].(string)
		if s.Config.Screen.Enabled && s.allowed(p.user.Fingerprint, "screen.watch", ch) {
			shares = append(shares, share)
		}
	}
	s.send(p, "SCREEN_STATE", "", map[string]any{"shares": shares})
}
func (s *Server) broadcastScreens() {
	for _, p := range s.clients {
		s.sendScreenState(p)
	}
}
func (s *Server) disconnectScreen(ctx context.Context, p *client) error {
	cancel := p.screenCancel
	p.screenCancel = nil
	p.screenContext = nil
	active := p.screenActive
	p.screenActive = false
	var err error
	if p.screenChannel != "" {
		ch := p.screenChannel
		p.screenChannel = ""
		err = s.media().RemoveRoomParticipant(ctx, "screen_"+ch, p.user.ID)
	}
	if cancel != nil {
		cancel()
	}
	p.screenProxies.Wait()
	if active {
		s.broadcastScreens()
	}
	return err
}

func (s *Server) screenOperation(ctx context.Context, p *client, m protocol.Envelope) {
	fail := func(code string) { s.sendError(p, m.RequestID, code) }
	if !s.Config.Screen.Enabled {
		fail("SCREEN_DISABLED")
		return
	}
	var v struct {
		screenOptions
		UserID string `json:"user_id"`
	}
	if json.Unmarshal(m.Payload, &v) != nil {
		fail("INVALID_INPUT")
		return
	}
	if m.Type == "SCREEN_STOP" {
		target := p
		if v.UserID != "" && v.UserID != p.user.ID {
			target = s.clients[v.UserID]
			if target == nil || target.user.ChannelID != p.user.ChannelID || !s.require(p, m.RequestID, "screen.stop_others", p.user.ChannelID) {
				fail("PERMISSION_DENIED")
				return
			}
		}
		watch := s.allowed(target.user.Fingerprint, "screen.watch", target.user.ChannelID)
		if watch && target.screenContext != nil {
			if e := s.media().ScreenPermission(ctx, target.user.ChannelID, target.user.ID, false, true); e != nil {
				if e := s.disconnectScreen(ctx, target); e != nil {
					target.cancel()
					fail("MEDIA_UNAVAILABLE")
					return
				}
				s.send(target, "SCREEN_REVOKED", "", nil)
				s.send(p, "ACK", m.RequestID, nil)
				return
			}
			target.screenActive = false
			s.broadcastScreens()
			s.send(target, "SCREEN_REVOKED", "", map[string]bool{"publishing_only": true})
		} else {
			if e := s.disconnectScreen(ctx, target); e != nil {
				target.cancel()
				fail("MEDIA_UNAVAILABLE")
				return
			}
			s.send(target, "SCREEN_REVOKED", "", nil)
		}
		s.send(p, "ACK", m.RequestID, nil)
		return
	}
	ch := p.user.ChannelID
	if ch == "" || !s.allowed(p.user.Fingerprint, "channel.join", ch) {
		fail("PERMISSION_DENIED")
		return
	}
	watch := s.allowed(p.user.Fingerprint, "screen.watch", ch)
	if m.Type == "SCREEN_START" {
		if !s.require(p, m.RequestID, "screen.share", ch) {
			return
		}
		if v.Quality != "auto" && v.Quality != "1080p" && v.Quality != "1440p" && v.Quality != "source" {
			fail("INVALID_INPUT")
			return
		}
		if (v.FPS != 30 && v.FPS != 60) || v.FPS > s.Config.Screen.MaxFPS {
			fail("INVALID_INPUT")
			return
		}
		if v.Content != "auto" && v.Content != "text" && v.Content != "motion" {
			fail("INVALID_INPUT")
			return
		}
		height := 1080
		if v.Quality == "1440p" {
			height = 1440
		}
		if v.Quality == "source" {
			height = s.Config.Screen.MaxHeight
		}
		if v.Quality == "auto" {
			height = min(height, s.Config.Screen.MaxHeight)
		}
		if height > s.Config.Screen.MaxHeight {
			fail("INVALID_INPUT")
			return
		}
		n := 0
		for _, other := range s.clients {
			if other.screenActive && other.user.ChannelID == ch && other != p {
				n++
			}
		}
		if n >= s.Config.Screen.MaxSharesPerChannel {
			fail("SCREEN_LIMIT")
			return
		}
		if p.screenActive {
			fail("SCREEN_ALREADY_ACTIVE")
			return
		}
		if p.screenContext != nil {
			if e := s.media().ScreenPermission(ctx, ch, p.user.ID, true, watch); e != nil {
				if e := s.disconnectScreen(ctx, p); e != nil {
					p.cancel()
					fail("MEDIA_UNAVAILABLE")
					return
				}
			}
		}
		p.screenActive = true
		p.screenStarted = time.Now()
		p.screenOptions = v.screenOptions
	} else if m.Type != "SCREEN_JOIN" || !watch {
		fail("PERMISSION_DENIED")
		return
	}
	if e := s.media().EnsureRoom(ctx, "screen_"+ch); e != nil {
		p.screenActive = false
		fail("MEDIA_UNAVAILABLE")
		return
	}
	if p.screenContext == nil {
		p.screenContext, p.screenCancel = context.WithCancel(context.Background())
		p.screenChannel = ch
	}
	token, e := s.media().ScreenToken(p.user.ID, p.user.Nickname, ch, p.screenActive, watch)
	if e != nil {
		p.screenActive = false
		fail("MEDIA_UNAVAILABLE")
		return
	}
	s.send(p, "ACK", m.RequestID, map[string]any{"token": token, "signaling_path": "/livekit", "channel_id": ch, "limits": s.Config.Screen, "can_watch": watch})
	s.broadcastScreens()
}
func (s *Server) reconcileScreens() {
	for _, p := range s.clients {
		if p.screenContext == nil {
			continue
		}
		ch := p.user.ChannelID
		watch := s.allowed(p.user.Fingerprint, "screen.watch", ch)
		publish := p.screenActive && s.allowed(p.user.Fingerprint, "screen.share", ch)
		if p.revoked || !s.Config.Screen.Enabled || ch == "" || ch != p.screenChannel || !s.allowed(p.user.Fingerprint, "channel.join", ch) || (!watch && !publish) {
			if e := s.disconnectScreen(context.Background(), p); e != nil {
				p.cancel()
			}
			s.send(p, "SCREEN_REVOKED", "", nil)
			continue
		}
		if p.screenActive && !publish {
			if e := s.disconnectScreen(context.Background(), p); e != nil {
				p.cancel()
			}
			s.send(p, "SCREEN_REVOKED", "", nil)
			continue
		}
		if e := s.media().ScreenPermission(context.Background(), ch, p.user.ID, publish, watch); e != nil {
			if e := s.disconnectScreen(context.Background(), p); e != nil {
				p.cancel()
			}
			s.send(p, "SCREEN_REVOKED", "", nil)
		}
	}
	s.broadcastScreens()
}

// Screen capture reservations expire if a picker is abandoned or no video track is published.
func (s *Server) screenMaintenance(ctx context.Context) {
	tick := time.NewTicker(10 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			s.mu.Lock()
			for _, p := range s.clients {
				if p.screenActive {
					var participants struct {
						Participants []struct {
							Identity string `json:"identity"`
							Tracks   []struct {
								Type          string `json:"type"`
								Source        string `json:"source"`
								Width, Height uint32
								Layers        []struct{ Bitrate uint32 }
							} `json:"tracks"`
						} `json:"participants"`
					}
					if e := s.media().Call(ctx, "ListParticipants", "screen_"+p.user.ChannelID, map[string]any{"room": "screen_" + p.user.ChannelID}, &participants); e != nil {
						continue
					}
					valid := false
					for _, peer := range participants.Participants {
						if peer.Identity == p.user.ID {
							count := 0
							valid = true
							for _, t := range peer.Tracks {
								if t.Source != "SCREEN_SHARE" || t.Type != "VIDEO" {
									valid = false
								}
								count++
								if t.Height > uint32(s.Config.Screen.MaxHeight) || t.Width > uint32(s.Config.Screen.MaxHeight*2) {
									valid = false
								}
							}
							if count != 1 {
								valid = false
							}
						}
					}
					if !valid && time.Since(p.screenStarted) < 45*time.Second {
						empty := true
						for _, peer := range participants.Participants {
							if peer.Identity == p.user.ID && len(peer.Tracks) > 0 {
								empty = false
							}
						}
						if empty {
							continue
						}
					}
					if !valid {
						if e := s.disconnectScreen(ctx, p); e != nil {
							p.cancel()
						}
						s.send(p, "SCREEN_REVOKED", "", nil)
					}
				}
			}
			s.mu.Unlock()
		}
	}
}
