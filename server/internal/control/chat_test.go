package control

import (
	"context"
	"encoding/json"
	"licra/server/internal/protocol"
	"licra/server/internal/store"
	"strings"
	"testing"
	"time"
)

func chatFixture(t *testing.T) (*Server, []*client, string) {
	s, _ := setup(t)
	s.Config.Chat.MessagesPerSecond = 1000
	s.Config.Chat.MessagesPerMinute = 10000
	s.Config.Chat.EditsPerMinute = 1000
	clients := []*client{}
	for _, name := range []string{"alice", "bob", "eve"} {
		fp := strings.Repeat(name[:1], 64)
		p := &client{user: User{ID: name, Fingerprint: fp, Nickname: name}, out: make(chan protocol.Envelope, 512), cancel: func() {}}
		s.DB.Exec("INSERT INTO devices VALUES (?,?,?)", fp, name, time.Now().Format(time.RFC3339))
		s.DB.Exec("INSERT INTO chat_peers VALUES (?,?)", fp, name)
		s.DB.Exec("INSERT INTO device_roles VALUES (?,'Guest','')", fp)
		s.clients[name] = p
		clients = append(clients, p)
	}
	s.reloadPolicy()
	channels, _ := s.channels()
	t.Cleanup(func() {
		s.mu.Lock()
		for _, p := range clients {
			delete(s.clients, p.user.ID)
		}
		s.mu.Unlock()
	})
	return s, clients, channels[0].ID
}
func chatCall(t *testing.T, s *Server, p *client, kind string, v any) (map[string]any, []protocol.Envelope) {
	t.Helper()
	s.mu.Lock()
	s.chatOperation(p, protocol.Message(kind, "test", v))
	events := []protocol.Envelope{}
	var result map[string]any
	for _, other := range s.clients {
		for len(other.out) > 0 {
			m := <-other.out
			events = append(events, m)
			if other == p && m.RequestID == "test" {
				json.Unmarshal(m.Payload, &result)
				if result == nil {
					result = map[string]any{}
				}
				result["_type"] = m.Type
			}
		}
	}
	s.mu.Unlock()
	if result == nil {
		t.Fatalf("no response %s", kind)
	}
	return result, events
}
func mustChat(t *testing.T, s *Server, p *client, kind string, v any) map[string]any {
	t.Helper()
	r, _ := chatCall(t, s, p, kind, v)
	if r["_type"] != "ACK" {
		t.Fatalf("%s: %v", kind, r)
	}
	return r
}
func TestChatPersistencePrivacyPaginationAndModeration(t *testing.T) {
	s, peers, ch := chatFixture(t)
	a, b, eve := peers[0], peers[1], peers[2]
	thread := mustChat(t, s, a, "CHAT_OPEN", map[string]any{"channel_id": ch})["thread_id"].(string)
	hostile := "<script>alert(1)</script> 😀\nhttps://example.com"
	first := mustChat(t, s, a, "CHAT_SEND", map[string]any{"thread_id": thread, "content": hostile, "author_fingerprint": eve.user.Fingerprint, "created_at": "fake"})
	if first["author_fingerprint"] != a.user.Fingerprint || first["created_at"] == "fake" || first["content"] != hostile {
		t.Fatal(first)
	}
	a.user.Nickname = "renamed"
	for i := 0; i < 65; i++ {
		mustChat(t, s, a, "CHAT_SEND", map[string]any{"thread_id": thread, "content": "page"})
	}
	recent := mustChat(t, s, b, "CHAT_HISTORY", map[string]any{"thread_id": thread})
	if len(recent["messages"].([]any)) != 50 || recent["has_more"] != true {
		t.Fatal(recent)
	}
	older := mustChat(t, s, b, "CHAT_HISTORY", map[string]any{"thread_id": thread, "before": recent["before"]})
	items := older["messages"].([]any)
	if len(items) != 16 || items[0].(map[string]any)["author_nickname_snapshot"] != "alice" {
		t.Fatal(older)
	}
	reply := mustChat(t, s, b, "CHAT_SEND", map[string]any{"thread_id": thread, "content": "reply", "reply_to_message_id": first["id"]})
	if reply["reply"].(map[string]any)["content"] != hostile {
		t.Fatal(reply)
	}
	mustChat(t, s, a, "CHAT_EDIT", map[string]any{"thread_id": thread, "message_id": first["id"], "content": "edited"})
	bad, _ := chatCall(t, s, b, "CHAT_EDIT", map[string]any{"thread_id": thread, "message_id": first["id"], "content": "stolen"})
	if bad["_type"] != "ERROR" {
		t.Fatal(bad)
	}
	deleted := mustChat(t, s, a, "CHAT_DELETE", map[string]any{"thread_id": thread, "message_id": first["id"]})
	if deleted["content"] != "" || deleted["deleted_at"] == nil {
		t.Fatal(deleted)
	}
	stored, _ := s.message(first["id"].(string))
	if stored.Content != "edited" {
		t.Fatal(stored)
	}
	dm := mustChat(t, s, a, "CHAT_OPEN", map[string]any{"peer_fingerprint": b.user.Fingerprint})["thread_id"].(string)
	reverse := mustChat(t, s, b, "CHAT_OPEN", map[string]any{"peer_fingerprint": a.user.Fingerprint})
	if dm != reverse["thread_id"] {
		t.Fatal("noncanonical")
	}
	bad, _ = chatCall(t, s, eve, "CHAT_HISTORY", map[string]any{"thread_id": dm})
	if bad["code"] != "PERMISSION_DENIED" {
		t.Fatal(bad)
	}
	delete(s.clients, b.user.ID)
	mustChat(t, s, a, "CHAT_SEND", map[string]any{"thread_id": dm, "content": "offline"})
	s.clients[b.user.ID] = b
	b.user.ChannelID = "unrelated"
	offline := mustChat(t, s, b, "CHAT_HISTORY", map[string]any{"thread_id": dm})
	if len(offline["messages"].([]any)) != 1 {
		t.Fatal(offline)
	}
	list := mustChat(t, s, b, "CHAT_LIST", map[string]any{})
	found := false
	for _, raw := range list["threads"].([]any) {
		v := raw.(map[string]any)
		if v["id"] == dm {
			found = true
			if v["unread"] != float64(1) {
				t.Fatal(v)
			}
		}
	}
	if !found {
		t.Fatal(list)
	}
	last := offline["messages"].([]any)[0].(map[string]any)["id"]
	mustChat(t, s, b, "CHAT_READ", map[string]any{"thread_id": dm, "message_id": last})
	bad, _ = chatCall(t, s, a, "CHAT_SEND", map[string]any{"thread_id": dm, "content": "cross reply", "reply_to_message_id": reply["id"]})
	if bad["code"] != "INVALID_INPUT" {
		t.Fatal(bad)
	}
	a.revoked = true
	bad, _ = chatCall(t, s, a, "CHAT_SEND", map[string]any{"thread_id": dm, "content": "banned"})
	if bad["code"] != "PERMISSION_DENIED" {
		t.Fatal(bad)
	}
}
func TestChatLimitsPermissionsRetentionAndTyping(t *testing.T) {
	s, p, ch := chatFixture(t)
	a := p[0]
	thread := mustChat(t, s, a, "CHAT_OPEN", map[string]any{"channel_id": ch})["thread_id"].(string)
	s.Config.Chat.ChannelHistoryLimit = 3
	for i := 0; i < 5; i++ {
		mustChat(t, s, a, "CHAT_SEND", map[string]any{"thread_id": thread, "content": "retained"})
	}
	var n int
	s.DB.QueryRow("SELECT count(*) FROM chat_messages WHERE thread_id=?", thread).Scan(&n)
	if n != 3 {
		t.Fatal(n)
	}
	s.Config.Chat.MaxMessageLength = 5
	bad, _ := chatCall(t, s, a, "CHAT_SEND", map[string]any{"thread_id": thread, "content": "too long"})
	if bad["code"] != "INVALID_INPUT" {
		t.Fatal(bad)
	}
	s.Config.Chat.MessagesPerMinute = 5
	bad, _ = chatCall(t, s, a, "CHAT_SEND", map[string]any{"thread_id": thread, "content": "limit"})
	if bad["code"] != "RATE_LIMITED" {
		t.Fatal(bad)
	}
	mustChat(t, s, a, "CHAT_TYPING", map[string]any{"thread_id": thread, "active": true})
	mustChat(t, s, a, "CHAT_TYPING", map[string]any{"thread_id": thread, "active": false})
	bad, _ = chatCall(t, s, a, "CHAT_TYPING", map[string]any{"thread_id": thread, "active": true})
	if bad["code"] != "RATE_LIMITED" {
		t.Fatal(bad)
	}
	s.DB.Exec("INSERT INTO channel_permission_overrides VALUES (?,'Guest','chat.channel.view','DENY')", ch)
	s.reloadPolicy()
	bad, _ = chatCall(t, s, a, "CHAT_HISTORY", map[string]any{"thread_id": thread})
	if bad["code"] != "PERMISSION_DENIED" {
		t.Fatal(bad)
	}
	s.Config.Chat.Enabled = false
	bad, _ = chatCall(t, s, a, "CHAT_LIST", map[string]any{})
	if bad["code"] != "CHAT_DISABLED" {
		t.Fatal(bad)
	}
}
func TestScreenGrantsAndRevocation(t *testing.T) {
	s, peers, ch := chatFixture(t)
	a := peers[0]
	a.user.ChannelID = ch
	s.Config.Screen.MaxSharesPerChannel = 1
	call := func(p *client, kind string, v any) map[string]any {
		t.Helper()
		s.mu.Lock()
		s.screenOperation(context.Background(), p, protocol.Message(kind, "screen", v))
		var result map[string]any
		for _, other := range peers {
			for len(other.out) > 0 {
				m := <-other.out
				if other == p && m.RequestID == "screen" {
					json.Unmarshal(m.Payload, &result)
				}
			}
		}
		s.mu.Unlock()
		return result
	}
	grant := call(a, "SCREEN_START", map[string]any{"quality": "auto", "fps": 30, "content": "auto"})
	claims, e := s.media().Verify(grant["token"].(string))
	if e != nil || claims.Video["room"] != "screen_"+ch || claims.Video["canPublishData"] != false || claims.Video["canPublishSources"].([]any)[0] != "screen_share" {
		t.Fatal(claims, e)
	}
	b := peers[1]
	b.user.ChannelID = ch
	limit := call(b, "SCREEN_START", map[string]any{"quality": "auto", "fps": 30, "content": "auto"})
	if limit["code"] != "SCREEN_LIMIT" {
		t.Fatal(limit)
	}
	s.DB.Exec("INSERT INTO channel_permission_overrides VALUES (?,'Guest','screen.watch','DENY')", ch)
	s.reloadPolicy()
	bad := call(b, "SCREEN_JOIN", map[string]any{})
	if bad["code"] != "PERMISSION_DENIED" {
		t.Fatal(bad)
	}
	s.DB.Exec("INSERT INTO channel_permission_overrides VALUES (?,'Guest','screen.share','DENY')", ch)
	s.reloadPolicy()
	s.mu.Lock()
	s.reconcileScreens()
	s.mu.Unlock()
	if a.screenActive || a.screenContext != nil {
		t.Fatal("sharing survived revocation")
	}
}

func TestChatGlobalStorageAndHistoryDisabled(t *testing.T) {
	s, p, ch := chatFixture(t)
	a := p[0]
	thread := mustChat(t, s, a, "CHAT_OPEN", map[string]any{"channel_id": ch})["thread_id"].(string)
	s.Config.Chat.MaxStoredMessages = 3
	for i := 0; i < 8; i++ {
		mustChat(t, s, a, "CHAT_SEND", map[string]any{"thread_id": thread, "content": "global cap"})
	}
	var n int
	s.DB.QueryRow("SELECT count(*) FROM chat_messages").Scan(&n)
	if n != 3 || s.chatStored != 3 {
		t.Fatal(n, s.chatStored)
	}
	s.Config.Chat.HistoryEnabled = false
	mustChat(t, s, a, "CHAT_SEND", map[string]any{"thread_id": thread, "content": "live only"})
	r := mustChat(t, s, a, "CHAT_HISTORY", map[string]any{"thread_id": thread})
	if len(r["messages"].([]any)) != 0 {
		t.Fatal(r)
	}
}

func TestPrivateReadSurvivesSendRevocation(t *testing.T) {
	s, peers, _ := chatFixture(t)
	a, b := peers[0], peers[1]
	thread := mustChat(t, s, a, "CHAT_OPEN", map[string]any{"peer_fingerprint": b.user.Fingerprint})["thread_id"].(string)
	mustChat(t, s, a, "CHAT_SEND", map[string]any{"thread_id": thread, "content": "saved"})
	s.DB.Exec("UPDATE role_permissions SET effect='DENY' WHERE role_id='Guest' AND permission='chat.private.send'")
	s.reloadPolicy()
	r := mustChat(t, s, b, "CHAT_OPEN", map[string]any{"peer_fingerprint": a.user.Fingerprint})
	if len(r["messages"].([]any)) != 1 {
		t.Fatal(r)
	}
	r, _ = chatCall(t, s, b, "CHAT_SEND", map[string]any{"thread_id": thread, "content": "denied"})
	if r["_type"] != "ERROR" {
		t.Fatal(r)
	}
}

func TestChatSurvivesServerReopen(t *testing.T) {
	s, peers, ch := chatFixture(t)
	a, b := peers[0], peers[1]
	thread := mustChat(t, s, a, "CHAT_OPEN", map[string]any{"peer_fingerprint": b.user.Fingerprint})["thread_id"].(string)
	original := mustChat(t, s, a, "CHAT_SEND", map[string]any{"thread_id": thread, "content": "persisted after restart"})
	channelThread := mustChat(t, s, a, "CHAT_OPEN", map[string]any{"channel_id": ch})["thread_id"].(string)
	mustChat(t, s, a, "CHAT_SEND", map[string]any{"thread_id": channelThread, "content": "channel persisted"})
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
	restarted.clients[b.user.ID] = b
	defer delete(restarted.clients, b.user.ID)
	if restarted.ID != s.ID {
		t.Fatal("server identity changed")
	}
	r := mustChat(t, restarted, b, "CHAT_OPEN", map[string]any{"peer_fingerprint": a.user.Fingerprint})
	messages := r["messages"].([]any)
	if len(messages) != 1 || messages[0].(map[string]any)["id"] != original["id"] {
		t.Fatal(r)
	}
	r = mustChat(t, restarted, b, "CHAT_HISTORY", map[string]any{"thread_id": channelThread})
	if len(r["messages"].([]any)) != 1 {
		t.Fatal(r)
	}
}

func TestChatQuotaAfterChannelCascade(t *testing.T) {
	s, peers, ch := chatFixture(t)
	a := peers[0]
	s.Config.Chat.MaxStoredMessages = 2
	thread := mustChat(t, s, a, "CHAT_OPEN", map[string]any{"channel_id": ch})["thread_id"].(string)
	for i := 0; i < 2; i++ {
		mustChat(t, s, a, "CHAT_SEND", map[string]any{"thread_id": thread, "content": "old channel"})
	}
	if _, e := s.DB.Exec("DELETE FROM channels WHERE id=?", ch); e != nil {
		t.Fatal(e)
	}
	dm := mustChat(t, s, a, "CHAT_OPEN", map[string]any{"peer_fingerprint": peers[1].user.Fingerprint})["thread_id"].(string)
	mustChat(t, s, a, "CHAT_SEND", map[string]any{"thread_id": dm, "content": "keep this"})
	r := mustChat(t, s, a, "CHAT_HISTORY", map[string]any{"thread_id": dm})
	if len(r["messages"].([]any)) != 1 || s.chatStored != 1 {
		t.Fatal(r, s.chatStored)
	}
}
