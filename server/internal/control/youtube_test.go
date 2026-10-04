package control

import (
	"encoding/json"
	"licra/server/internal/protocol"
	"licra/server/internal/store"
	"strings"
	"testing"
	"time"
)

func youtubeFixture(t *testing.T) (*Server, []*client, string) {
	s, peers, ch := chatFixture(t)
	for _, p := range peers {
		p.user.ChannelID = ch
	}
	s.DB.Exec("INSERT INTO device_roles VALUES (?,'Member','')", peers[0].user.Fingerprint)
	if e := s.reloadPolicy(); e != nil {
		t.Fatal(e)
	}
	return s, peers, ch
}
func youtubeCall(t *testing.T, s *Server, p *client, kind string, v map[string]any) map[string]any {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	if v == nil {
		v = map[string]any{}
	}
	if _, ok := v["revision"]; !ok {
		v["revision"] = s.youtube[p.user.ChannelID].Revision
	}
	s.youtubeOperation(p, protocol.Message(kind, "youtube-test", v))
	var result map[string]any
	for _, other := range s.clients {
		for len(other.out) > 0 {
			m := <-other.out
			if other == p && m.RequestID == "youtube-test" {
				json.Unmarshal(m.Payload, &result)
				if result == nil {
					result = map[string]any{}
				}
				result["_type"] = m.Type
			}
		}
	}
	if result == nil {
		t.Fatalf("no response %s", kind)
	}
	return result
}
func mustYouTube(t *testing.T, s *Server, p *client, kind string, v map[string]any) map[string]any {
	t.Helper()
	r := youtubeCall(t, s, p, kind, v)
	if r["_type"] != "ACK" {
		t.Fatalf("%s: %v", kind, r)
	}
	return r
}
func TestYouTubeControlQueuePermissionsAndCanonicalTime(t *testing.T) {
	s, peers, ch := youtubeFixture(t)
	a, b := peers[0], peers[1]
	for _, input := range []string{"https://youtu.be/M7lc1UVf-VE?t=2", "https://youtube.com/watch?v=M7lc1UVf-VE", "https://m.youtube.com/shorts/M7lc1UVf-VE", "M7lc1UVf-VE"} {
		id, ok := parseYouTubeID(input)
		if !ok || id != "M7lc1UVf-VE" {
			t.Fatal(input, id)
		}
	}
	for _, input := range []string{"https://youtube.com.evil/watch?v=M7lc1UVf-VE", "javascript:alert(1)", "https://x@youtube.com/watch?v=M7lc1UVf-VE", "https://youtu.be/M7lc1UVf-VE/more"} {
		if _, ok := parseYouTubeID(input); ok {
			t.Fatal(input)
		}
	}
	mustYouTube(t, s, a, "YOUTUBE_START", map[string]any{"video": "https://youtu.be/M7lc1UVf-VE", "started_by": "fake", "state": "PAUSED"})
	activity := s.youtube[ch]
	if activity.StartedBy != a.user.Fingerprint || activity.State != "PLAYING" {
		t.Fatal(activity)
	}
	mustYouTube(t, s, a, "YOUTUBE_DURATION", map[string]any{"duration": 600})
	mustYouTube(t, s, a, "YOUTUBE_SEEK", map[string]any{"position": 120})
	if pos := s.youtube[ch].position(time.Now().Add(8 * time.Second)); pos < 128 || pos > 129 {
		t.Fatal(pos)
	}
	mustYouTube(t, s, a, "YOUTUBE_PAUSE", nil)
	paused := s.youtube[ch]
	if paused.position(time.Now().Add(time.Hour)) != paused.Position {
		t.Fatal("pause advanced")
	}
	mustYouTube(t, s, a, "YOUTUBE_QUEUE_ADD", map[string]any{"video": "dQw4w9WgXcQ"})
	mustYouTube(t, s, a, "YOUTUBE_QUEUE_ADD", map[string]any{"video": "aqz-KE-bpKQ"})
	mustYouTube(t, s, a, "YOUTUBE_QUEUE_MOVE", map[string]any{"index": 1, "to": 0})
	if strings.Join(s.youtube[ch].Queue, ",") != "aqz-KE-bpKQ,dQw4w9WgXcQ" {
		t.Fatal(s.youtube[ch])
	}
	stale := youtubeCall(t, s, a, "YOUTUBE_PLAY", map[string]any{"revision": 0})
	if stale["code"] != "STALE_ACTIVITY" {
		t.Fatal(stale)
	}
	for _, kind := range []string{"YOUTUBE_START", "YOUTUBE_PLAY", "YOUTUBE_PAUSE", "YOUTUBE_SEEK", "YOUTUBE_STOP", "YOUTUBE_NEXT", "YOUTUBE_PREVIOUS", "YOUTUBE_QUEUE_ADD", "YOUTUBE_QUEUE_REMOVE", "YOUTUBE_QUEUE_MOVE", "YOUTUBE_QUEUE_CLEAR", "YOUTUBE_DURATION", "YOUTUBE_ENDED"} {
		r := youtubeCall(t, s, b, kind, map[string]any{"video": "M7lc1UVf-VE"})
		if r["code"] != "PERMISSION_DENIED" {
			t.Fatalf("%s %v", kind, r)
		}
	}
	mustYouTube(t, s, b, "YOUTUBE_GET", nil)
	b.user.ChannelID = ""
	if r := youtubeCall(t, s, b, "YOUTUBE_GET", map[string]any{"channel_id": ch}); r["code"] != "PERMISSION_DENIED" {
		t.Fatal(r)
	}
	mustYouTube(t, s, a, "YOUTUBE_NEXT", nil)
	if s.youtube[ch].VideoID != "aqz-KE-bpKQ" {
		t.Fatal(s.youtube[ch])
	}
	mustYouTube(t, s, a, "YOUTUBE_PREVIOUS", nil)
	if s.youtube[ch].VideoID != "M7lc1UVf-VE" {
		t.Fatal(s.youtube[ch])
	}
	mustYouTube(t, s, a, "YOUTUBE_QUEUE_REMOVE", map[string]any{"index": 0})
	mustYouTube(t, s, a, "YOUTUBE_QUEUE_CLEAR", nil)
	s.Config.YouTube.CommandsPerMinute = 1
	s.chatRates = map[string]bucket{}
	mustYouTube(t, s, a, "YOUTUBE_PAUSE", nil)
	if r := youtubeCall(t, s, a, "YOUTUBE_PLAY", nil); r["code"] != "RATE_LIMITED" {
		t.Fatal(r)
	}
}
func TestYouTubeEndDeadlineRestartAndIsolation(t *testing.T) {
	s, peers, ch := youtubeFixture(t)
	a := peers[0]
	mustYouTube(t, s, a, "YOUTUBE_START", map[string]any{"video": "M7lc1UVf-VE"})
	mustYouTube(t, s, a, "YOUTUBE_QUEUE_ADD", map[string]any{"video": "dQw4w9WgXcQ"})
	mustYouTube(t, s, a, "YOUTUBE_DURATION", map[string]any{"duration": .1})
	deadline := time.Now().Add(2 * time.Second)
	for {
		s.mu.Lock()
		id := s.youtube[ch].VideoID
		s.mu.Unlock()
		if id == "dQw4w9WgXcQ" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("queue did not advance")
		}
		time.Sleep(10 * time.Millisecond)
	}
	mustYouTube(t, s, a, "YOUTUBE_SEEK", map[string]any{"position": 37})
	r := youtubeCall(t, s, a, "YOUTUBE_GET", nil)
	if r["activity"].(map[string]any)["video_id"] != "dQw4w9WgXcQ" {
		t.Fatal(r)
	}
	channels, _ := s.channels()
	other := ""
	for _, c := range channels {
		if c.ID != ch {
			other = c.ID
			break
		}
	}
	a.user.ChannelID = other
	mustYouTube(t, s, a, "YOUTUBE_START", map[string]any{"video": "aqz-KE-bpKQ"})
	if s.youtube[ch].VideoID == s.youtube[other].VideoID {
		t.Fatal("channels not isolated")
	}
	d, e := store.Open(s.Config.Database.Path)
	if e != nil {
		t.Fatal(e)
	}
	defer d.Close()
	restarted, e := New(s.Config, d)
	if e != nil {
		t.Fatal(e)
	}
	defer restarted.Close()
	restored := restarted.youtube[ch]
	if restored.State != "PAUSED" || restored.Position != 37 || restored.Revision <= s.youtube[ch].Revision || restored.VideoID != "dQw4w9WgXcQ" {
		t.Fatal(restored)
	}
}

func TestYouTubeAtomicSeekRightsAndViewRevocation(t *testing.T) {
	s, peers, ch := youtubeFixture(t)
	a, b := peers[0], peers[1]
	mustYouTube(t, s, a, "YOUTUBE_START", map[string]any{"video": "M7lc1UVf-VE"})
	s.DB.Exec("INSERT INTO roles VALUES ('controller-only','Controller only',0)")
	s.DB.Exec("INSERT INTO role_permissions VALUES ('controller-only','youtube.control','ALLOW')")
	s.DB.Exec("INSERT INTO device_roles VALUES (?,'controller-only','')", b.user.Fingerprint)
	s.reloadPolicy()
	mustYouTube(t, s, b, "YOUTUBE_PAUSE", nil)
	if r := youtubeCall(t, s, b, "YOUTUBE_SEEK", map[string]any{"position": 12}); r["code"] != "PERMISSION_DENIED" {
		t.Fatal(r)
	}
	s.DB.Exec("INSERT INTO role_permissions VALUES ('controller-only','youtube.seek','ALLOW')")
	s.reloadPolicy()
	mustYouTube(t, s, b, "YOUTUBE_SEEK", map[string]any{"position": 12})
	s.DB.Exec("INSERT INTO role_permissions VALUES ('controller-only','youtube.view','DENY')")
	s.mu.Lock()
	s.permissionsUpdated()
	state := s.visibleYouTube(b)
	s.mu.Unlock()
	if state != nil {
		t.Fatal("revoked viewer still sees activity")
	}
	if r := youtubeCall(t, s, b, "YOUTUBE_GET", nil); r["code"] != "PERMISSION_DENIED" {
		t.Fatal(r)
	}
	if s.youtube[ch].Position != 12 {
		t.Fatal("revocation changed activity")
	}
	// A starter can report the official player duration without change-video rights.
	s.DB.Exec("DELETE FROM role_permissions WHERE role_id='controller-only' AND permission='youtube.view'")
	s.DB.Exec("INSERT INTO role_permissions VALUES ('controller-only','youtube.start','ALLOW')")
	s.DB.Exec("INSERT INTO role_permissions VALUES ('controller-only','youtube.change_video','DENY')")
	s.reloadPolicy()
	mustYouTube(t, s, a, "YOUTUBE_STOP", nil)
	mustYouTube(t, s, b, "YOUTUBE_START", map[string]any{"video": "aqz-KE-bpKQ"})
	mustYouTube(t, s, b, "YOUTUBE_DURATION", map[string]any{"duration": 635})
	if s.youtube[ch].Duration != 635 || s.youtube[ch].StartedBy != b.user.Fingerprint {
		t.Fatal("starter metadata rejected", s.youtube[ch])
	}
	s.Config.YouTube.Enabled = false
	if r := youtubeCall(t, s, a, "YOUTUBE_GET", nil); r["code"] != "YOUTUBE_DISABLED" {
		t.Fatal(r)
	}
}
