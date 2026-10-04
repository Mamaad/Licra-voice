package control

import (
	"encoding/json"
	"licra/server/internal/protocol"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var youtubeID = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

func parseYouTubeID(value string) (string, bool) {
	if youtubeID.MatchString(value) {
		return value, true
	}
	if len(value) > 2048 {
		return "", false
	}
	u, e := url.Parse(value)
	if e != nil || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.Port() != "" {
		return "", false
	}
	host := strings.ToLower(u.Hostname())
	path := strings.Split(strings.Trim(u.Path, "/"), "/")
	id := ""
	if host == "youtu.be" && len(path) == 1 {
		id = path[0]
	}
	if host == "youtube.com" || host == "www.youtube.com" || host == "m.youtube.com" || host == "music.youtube.com" {
		if u.Path == "/watch" {
			id = u.Query().Get("v")
		}
		if len(path) == 2 && (path[0] == "shorts" || path[0] == "embed" || path[0] == "live") {
			id = path[1]
		}
	}
	return id, youtubeID.MatchString(id)
}

type YouTubeActivity struct {
	ChannelID      string   `json:"channel_id"`
	VideoID        string   `json:"video_id"`
	State          string   `json:"state"`
	Position       float64  `json:"position_reference"`
	Reference      int64    `json:"reference_timestamp"`
	StartedBy      string   `json:"started_by"`
	Controller     string   `json:"controlled_by"`
	ControllerName string   `json:"controller_nickname"`
	Updated        int64    `json:"updated_at"`
	Revision       int64    `json:"revision"`
	Duration       float64  `json:"duration"`
	Queue          []string `json:"queue"`
	Previous       []string `json:"previous"`
}

func (a YouTubeActivity) position(now time.Time) float64 {
	pos := a.Position
	if a.State == "PLAYING" {
		pos += math.Max(0, float64(now.UnixMilli()-a.Reference)/1000)
	}
	if a.Duration > 0 {
		pos = math.Min(pos, a.Duration)
	}
	return math.Max(0, pos)
}
func (s *Server) loadYouTube() error {
	s.youtube = map[string]YouTubeActivity{}
	s.youtubeTimers = map[string]*time.Timer{}
	rows, e := s.DB.Query("SELECT channel_id,payload FROM youtube_activities")
	if e != nil {
		return e
	}
	for rows.Next() {
		var ch, raw string
		var a YouTubeActivity
		if e = rows.Scan(&ch, &raw); e != nil {
			rows.Close()
			return e
		}
		if e = json.Unmarshal([]byte(raw), &a); e != nil {
			rows.Close()
			return e
		}
		if a.State == "PLAYING" {
			a.State = "PAUSED"
			a.Reference = time.Now().UnixMilli()
			a.Updated = a.Reference
			a.Revision++
		}
		s.youtube[ch] = a
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	// No downtime advancement: after a crash, pause at the last persisted reference.
	for _, a := range s.youtube {
		if e = s.saveYouTube(a); e != nil {
			return e
		}
	}
	return nil
}
func (s *Server) saveYouTube(a YouTubeActivity) error {
	raw, e := json.Marshal(a)
	if e != nil {
		return e
	}
	_, e = s.DB.Exec("INSERT INTO youtube_activities VALUES (?,?) ON CONFLICT(channel_id) DO UPDATE SET payload=excluded.payload", a.ChannelID, string(raw))
	if e == nil {
		s.youtube[a.ChannelID] = a
	}
	return e
}
func (s *Server) visibleYouTube(p *client) *YouTubeActivity {
	if !s.Config.YouTube.Enabled || p.revoked || !s.allowed(p.user.Fingerprint, "youtube.view", p.user.ChannelID) {
		return nil
	}
	a, ok := s.youtube[p.user.ChannelID]
	if !ok {
		return nil
	}
	return &a
}
func (s *Server) sendYouTubeState(p *client) {
	s.send(p, "YOUTUBE_STATE", "", map[string]any{"channel_id": p.user.ChannelID, "activity": s.visibleYouTube(p), "server_time": time.Now().UnixMilli()})
}
func (s *Server) broadcastYouTube(ch string) {
	for _, p := range s.clients {
		if p.user.ChannelID == ch {
			s.sendYouTubeState(p)
		}
	}
}
func (s *Server) scheduleYouTube(a YouTubeActivity) {
	if t := s.youtubeTimers[a.ChannelID]; t != nil {
		t.Stop()
		delete(s.youtubeTimers, a.ChannelID)
	}
	if a.State != "PLAYING" || a.Duration <= 0 {
		return
	}
	delay := time.Duration(math.Max(0, a.Duration-a.position(time.Now())) * float64(time.Second))
	s.youtubeTimers[a.ChannelID] = time.AfterFunc(delay, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		current, ok := s.youtube[a.ChannelID]
		if s.closing || !ok || current.Revision != a.Revision || current.State != "PLAYING" {
			return
		}
		// A deleted channel must not resurrect an activity or leak a timer.
		if _, ok = s.policy.Parents[a.ChannelID]; !ok {
			delete(s.youtube, a.ChannelID)
			delete(s.youtubeTimers, a.ChannelID)
			return
		}
		s.advanceYouTube(&current)
		current.Revision++
		current.Controller = ""
		current.ControllerName = "Serveur"
		current.Updated = time.Now().UnixMilli()
		if s.saveYouTube(current) == nil {
			s.broadcastYouTube(a.ChannelID)
			s.scheduleYouTube(current)
		}
	})
}
func (s *Server) advanceYouTube(a *YouTubeActivity) {
	if a.VideoID != "" {
		a.Previous = append(a.Previous, a.VideoID)
		if len(a.Previous) > 20 {
			a.Previous = a.Previous[len(a.Previous)-20:]
		}
	}
	if len(a.Queue) == 0 {
		a.State = "STOPPED"
		a.Position = a.Duration
	} else {
		a.VideoID = a.Queue[0]
		a.Queue = a.Queue[1:]
		a.State = "PLAYING"
		a.Position = 0
		a.Duration = 0
	}
	a.Reference = time.Now().UnixMilli()
}
func (s *Server) youtubeOperation(p *client, m protocol.Envelope) {
	fail := func(code string) { s.sendError(p, m.RequestID, code) }
	if !s.Config.YouTube.Enabled {
		fail("YOUTUBE_DISABLED")
		return
	}
	if !s.chatRate(p.user.Fingerprint, "youtube_requests", 240, time.Minute) {
		fail("RATE_LIMITED")
		return
	}
	var v struct {
		ChannelID string  `json:"channel_id"`
		Video     string  `json:"video"`
		Position  float64 `json:"position"`
		Duration  float64 `json:"duration"`
		Index     int     `json:"index"`
		To        int     `json:"to"`
		Revision  *int64  `json:"revision"`
	}
	if json.Unmarshal(m.Payload, &v) != nil || len(v.ChannelID) > 100 || len(v.Video) > 2048 || math.IsNaN(v.Position) || math.IsInf(v.Position, 0) || v.Position < 0 || v.Position > 86400 || math.IsNaN(v.Duration) || math.IsInf(v.Duration, 0) || v.Duration < 0 || v.Duration > 86400 {
		fail("INVALID_INPUT")
		return
	}
	ch := p.user.ChannelID
	if ch == "" || (v.ChannelID != "" && v.ChannelID != ch) || p.revoked || !s.allowed(p.user.Fingerprint, "channel.join", ch) || !s.require(p, m.RequestID, "youtube.view", ch) {
		fail("PERMISSION_DENIED")
		return
	}
	a, exists := s.youtube[ch]
	if !exists {
		a = YouTubeActivity{ChannelID: ch, State: "STOPPED", Queue: []string{}, Previous: []string{}}
	}
	if m.Type == "YOUTUBE_GET" {
		s.send(p, "ACK", m.RequestID, map[string]any{"activity": s.visibleYouTube(p), "channel_id": ch, "server_time": time.Now().UnixMilli()})
		return
	}
	permission := ""
	switch m.Type {
	case "YOUTUBE_START":
		permission = "youtube.start"
		if exists && a.VideoID != "" && a.State != "STOPPED" {
			permission = "youtube.change_video"
		}
	case "YOUTUBE_PLAY", "YOUTUBE_PAUSE", "YOUTUBE_ENDED":
		permission = "youtube.control"
	case "YOUTUBE_SEEK":
		permission = "youtube.seek"
	case "YOUTUBE_NEXT", "YOUTUBE_PREVIOUS":
		permission = "youtube.change_video"
	case "YOUTUBE_DURATION":
		permission = "youtube.change_video"
		if a.StartedBy == p.user.Fingerprint {
			permission = "youtube.start"
		}
	case "YOUTUBE_STOP":
		permission = "youtube.stop"
	case "YOUTUBE_QUEUE_ADD", "YOUTUBE_QUEUE_REMOVE", "YOUTUBE_QUEUE_MOVE", "YOUTUBE_QUEUE_CLEAR":
		permission = "youtube.queue_manage"
	default:
		fail("INVALID_INPUT")
		return
	}
	if !s.require(p, m.RequestID, permission, ch) {
		return
	}
	if m.Type == "YOUTUBE_SEEK" && !s.require(p, m.RequestID, "youtube.control", ch) {
		return
	}
	if !s.chatRate(p.user.Fingerprint, "youtube_commands", s.Config.YouTube.CommandsPerMinute, time.Minute) {
		fail("RATE_LIMITED")
		return
	}
	if v.Revision == nil || *v.Revision != a.Revision {
		s.sendYouTubeState(p)
		fail("STALE_ACTIVITY")
		return
	}
	a.Queue = append([]string{}, a.Queue...)
	a.Previous = append([]string{}, a.Previous...)
	if a.State == "STOPPED" && (m.Type == "YOUTUBE_PLAY" || m.Type == "YOUTUBE_NEXT" || m.Type == "YOUTUBE_PREVIOUS") {
		if !s.require(p, m.RequestID, "youtube.start", ch) {
			return
		}
		if a.StartedBy == "" {
			a.StartedBy = p.user.Fingerprint
		}
	}
	now := time.Now()
	a.Position = a.position(now)
	a.Reference = now.UnixMilli()
	switch m.Type {
	case "YOUTUBE_START":
		if !s.chatRate(p.user.Fingerprint, "youtube_changes", s.Config.YouTube.ChangesPerMinute, time.Minute) {
			fail("RATE_LIMITED")
			return
		}
		id, ok := parseYouTubeID(v.Video)
		if !ok {
			fail("INVALID_INPUT")
			return
		}
		if a.VideoID != "" {
			a.Previous = append(a.Previous, a.VideoID)
			if len(a.Previous) > 20 {
				a.Previous = a.Previous[len(a.Previous)-20:]
			}
		}
		a.VideoID = id
		a.State = "PLAYING"
		a.Position = 0
		a.Duration = 0
		a.StartedBy = p.user.Fingerprint
	case "YOUTUBE_PLAY":
		if a.VideoID == "" {
			fail("INVALID_INPUT")
			return
		}
		if a.Duration > 0 && a.Position >= a.Duration {
			a.Position = 0
		}
		a.State = "PLAYING"
	case "YOUTUBE_PAUSE":
		if a.VideoID == "" {
			fail("INVALID_INPUT")
			return
		}
		a.State = "PAUSED"
	case "YOUTUBE_SEEK":
		if a.VideoID == "" || (a.Duration > 0 && v.Position > a.Duration) {
			fail("INVALID_INPUT")
			return
		}
		a.Position = v.Position
	case "YOUTUBE_STOP":
		a.State = "STOPPED"
	case "YOUTUBE_NEXT":
		if len(a.Queue) == 0 {
			fail("INVALID_INPUT")
			return
		}
		s.advanceYouTube(&a)
	case "YOUTUBE_PREVIOUS":
		if len(a.Previous) == 0 || len(a.Queue) >= s.Config.YouTube.MaxQueue {
			fail("INVALID_INPUT")
			return
		}
		if a.VideoID != "" {
			a.Queue = append([]string{a.VideoID}, a.Queue...)
		}
		a.VideoID = a.Previous[len(a.Previous)-1]
		a.Previous = a.Previous[:len(a.Previous)-1]
		a.State = "PLAYING"
		a.Position = 0
		a.Duration = 0
	case "YOUTUBE_DURATION":
		if a.VideoID == "" || a.Duration > 0 || v.Duration <= 0 {
			fail("INVALID_INPUT")
			return
		}
		a.Duration = v.Duration
	case "YOUTUBE_ENDED":
		if a.State != "PLAYING" || a.Duration <= 0 || a.Position < a.Duration-1 {
			fail("INVALID_INPUT")
			return
		}
		s.advanceYouTube(&a)
	case "YOUTUBE_QUEUE_ADD":
		id, ok := parseYouTubeID(v.Video)
		if !ok || len(a.Queue) >= s.Config.YouTube.MaxQueue {
			fail("INVALID_INPUT")
			return
		}
		a.Queue = append(a.Queue, id)
	case "YOUTUBE_QUEUE_REMOVE", "YOUTUBE_QUEUE_MOVE":
		if v.Index < 0 || v.Index >= len(a.Queue) {
			fail("INVALID_INPUT")
			return
		}
		if m.Type == "YOUTUBE_QUEUE_REMOVE" {
			a.Queue = append(a.Queue[:v.Index:v.Index], a.Queue[v.Index+1:]...)
		} else {
			if v.To < 0 || v.To >= len(a.Queue) {
				fail("INVALID_INPUT")
				return
			}
			items := append([]string{}, a.Queue...)
			item := items[v.Index]
			items = append(items[:v.Index], items[v.Index+1:]...)
			items = append(items, "")
			copy(items[v.To+1:], items[v.To:])
			items[v.To] = item
			a.Queue = items
		}
	case "YOUTUBE_QUEUE_CLEAR":
		a.Queue = []string{}
	}
	a.Revision++
	a.Updated = now.UnixMilli()
	a.Controller = p.user.Fingerprint
	a.ControllerName = p.user.Nickname
	if e := s.saveYouTube(a); e != nil {
		fail("DATABASE_ERROR")
		return
	}
	s.scheduleYouTube(a)
	s.broadcastYouTube(ch)
	s.send(p, "ACK", m.RequestID, map[string]any{"activity": a, "channel_id": ch, "server_time": time.Now().UnixMilli()})
}
