package control

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"licra/server/internal/protocol"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type chatThread struct {
	ID        string  `json:"id"`
	ChannelID *string `json:"channel_id"`
	A, B      sql.NullString
}
type ChatMessage struct {
	ID        string     `json:"id"`
	ThreadID  string     `json:"thread_id"`
	ChannelID *string    `json:"channel_id"`
	Author    string     `json:"author_fingerprint"`
	Nickname  string     `json:"author_nickname_snapshot"`
	Content   string     `json:"content"`
	Created   string     `json:"created_at"`
	Edited    *string    `json:"edited_at"`
	Deleted   *string    `json:"deleted_at"`
	ReplyID   *string    `json:"reply_to_message_id"`
	Reply     *chatQuote `json:"reply,omitempty"`
}
type chatQuote struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Content  string `json:"content"`
	Deleted  bool   `json:"deleted"`
}

func privateThreadID(server, a, b string) string {
	if a > b {
		a, b = b, a
	}
	h := sha256.Sum256([]byte(server + "\n" + a + "\n" + b))
	return "dm:" + hex.EncodeToString(h[:])
}
func (s *Server) chatThread(id string) (t chatThread, err error) {
	err = s.DB.QueryRow("SELECT id,channel_id,fingerprint_a,fingerprint_b FROM chat_threads WHERE id=? AND server_id=?", id, s.ID).Scan(&t.ID, &t.ChannelID, &t.A, &t.B)
	return
}
func (s *Server) chatAccess(p *client, t chatThread, permission string) bool {
	if p.revoked || !s.Config.Chat.Enabled {
		return false
	}
	if t.ChannelID != nil {
		return s.allowed(p.user.Fingerprint, "chat.channel.view", *t.ChannelID) && s.allowed(p.user.Fingerprint, permission, *t.ChannelID)
	}
	return t.A.String == p.user.Fingerprint || t.B.String == p.user.Fingerprint
}
func (s *Server) chatRate(fp, kind string, limit int, period time.Duration) bool {
	// Fingerprint keys survive control reconnects; prune to bound idle identities.
	now := time.Now()
	if len(s.chatRates) > 20000 {
		for k, b := range s.chatRates {
			if now.Sub(b.start) > time.Minute {
				delete(s.chatRates, k)
			}
		}
		if len(s.chatRates) > 20000 {
			return false
		}
	}
	key := fp + ":" + kind
	b := s.chatRates[key]
	if now.Sub(b.start) >= period {
		b = bucket{start: now}
	}
	b.n++
	s.chatRates[key] = b
	return b.n <= limit
}
func (s *Server) pruneChat() error {
	if time.Since(s.chatPruned) < 5*time.Minute {
		return nil
	}
	s.chatPruned = time.Now()
	res, e := s.DB.Exec("DELETE FROM chat_messages WHERE created_at < ?", time.Now().UTC().Add(-time.Duration(s.Config.Chat.RetentionDays)*24*time.Hour).Format(time.RFC3339Nano))
	if e != nil {
		return e
	}
	n, _ := res.RowsAffected()
	s.chatStored -= n
	_, e = s.DB.Exec("DELETE FROM chat_threads WHERE channel_id IS NULL AND created_at<? AND NOT EXISTS(SELECT 1 FROM chat_messages WHERE thread_id=chat_threads.id)", time.Now().UTC().Add(-time.Duration(s.Config.Chat.RetentionDays)*24*time.Hour).Format(time.RFC3339Nano))
	if e != nil {
		return e
	}
	return s.trimChatStorage()
}

const messageSelect = `SELECT CAST(m.id AS TEXT),m.thread_id,t.channel_id,m.author_fingerprint,m.author_nickname_snapshot,m.content,m.created_at,m.edited_at,m.deleted_at,CAST(m.reply_to_message_id AS TEXT),CAST(r.id AS TEXT),r.author_nickname_snapshot,r.content,r.deleted_at FROM chat_messages m JOIN chat_threads t ON t.id=m.thread_id LEFT JOIN chat_messages r ON r.id=m.reply_to_message_id AND r.thread_id=m.thread_id `

type scanner interface{ Scan(...any) error }

func scanMessage(row scanner) (m ChatMessage, err error) {
	var rid, name, content, deleted sql.NullString
	err = row.Scan(&m.ID, &m.ThreadID, &m.ChannelID, &m.Author, &m.Nickname, &m.Content, &m.Created, &m.Edited, &m.Deleted, &m.ReplyID, &rid, &name, &content, &deleted)
	if rid.Valid {
		m.Reply = &chatQuote{rid.String, name.String, content.String, deleted.Valid}
	}
	return
}
func (s *Server) message(id string) (ChatMessage, error) {
	return scanMessage(s.DB.QueryRow(messageSelect+"WHERE m.id=?", id))
}
func (s *Server) visibleMessage(p *client, m ChatMessage) ChatMessage {
	scope := ""
	if m.ChannelID != nil {
		scope = *m.ChannelID
	}
	mod := m.ChannelID != nil && s.allowed(p.user.Fingerprint, "chat.moderation.view_deleted", scope)
	if m.Deleted != nil && !mod {
		m.Content = ""
	}
	if m.Reply != nil {
		q := *m.Reply
		if q.Deleted && !mod {
			q.Content = ""
		}
		m.Reply = &q
	}
	return m
}
func (s *Server) chatEvent(t chatThread, kind string, m ChatMessage) {
	prefix := "CHAT_MESSAGE_"
	if t.ChannelID == nil {
		prefix = "PRIVATE_MESSAGE_"
	}
	for _, p := range s.clients {
		if s.chatAccess(p, t, "chat.channel.view") {
			s.send(p, prefix+kind, "", s.visibleMessage(p, m))
			s.chatUnread(p, t.ID)
		}
	}
}
func (s *Server) chatSummaries(p *client, only ...string) ([]map[string]any, error) {
	threadID := ""
	if len(only) > 0 {
		threadID = only[0]
	}
	rows, e := s.DB.Query(`SELECT t.id,t.channel_id,t.fingerprint_a,t.fingerprint_b,
 COALESCE((SELECT MAX(id) FROM chat_messages WHERE thread_id=t.id),0),
 (SELECT COUNT(*) FROM chat_messages WHERE thread_id=t.id AND id>COALESCE((SELECT message_id FROM chat_reads WHERE thread_id=t.id AND fingerprint=?),0) AND author_fingerprint<>? AND deleted_at IS NULL),
 COALESCE(pa.nickname,t.fingerprint_a,''),COALESCE(pb.nickname,t.fingerprint_b,'')
 FROM chat_threads t LEFT JOIN chat_peers pa ON pa.fingerprint=t.fingerprint_a LEFT JOIN chat_peers pb ON pb.fingerprint=t.fingerprint_b
 WHERE t.server_id=? AND (t.channel_id IS NOT NULL OR t.fingerprint_a=? OR t.fingerprint_b=?) AND (?='' OR t.id=?)`, p.user.Fingerprint, p.user.Fingerprint, s.ID, p.user.Fingerprint, p.user.Fingerprint, threadID, threadID)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var t chatThread
		var last, unread int64
		var a, b string
		if e = rows.Scan(&t.ID, &t.ChannelID, &t.A, &t.B, &last, &unread, &a, &b); e != nil {
			return nil, e
		}
		if !s.chatAccess(p, t, "chat.channel.view") {
			continue
		}
		peer, name := t.A.String, a
		if peer == p.user.Fingerprint {
			peer, name = t.B.String, b
		}
		out = append(out, map[string]any{"id": t.ID, "channel_id": t.ChannelID, "peer_fingerprint": peer, "peer_nickname": name, "last_id": strconv.FormatInt(last, 10), "unread": unread})
	}
	return out, rows.Err()
}
func (s *Server) chatUnread(p *client, only ...string) {
	if !s.Config.Chat.Enabled {
		return
	}
	out, e := s.chatSummaries(p, only...)
	if e == nil {
		s.send(p, "CHAT_UNREAD", "", map[string]any{"threads": out, "partial": len(only) > 0})
	}
}
func (s *Server) chatOperation(p *client, m protocol.Envelope) {
	id := m.RequestID
	fail := func(code string) { s.sendError(p, id, code) }
	if !s.Config.Chat.Enabled {
		fail("CHAT_DISABLED")
		return
	}
	if !s.chatRate(p.user.Fingerprint, "requests", 240, time.Minute) {
		fail("RATE_LIMITED")
		return
	}
	if e := s.pruneChat(); e != nil {
		fail("DATABASE_ERROR")
		return
	}
	var v struct {
		ThreadID  string  `json:"thread_id"`
		ChannelID string  `json:"channel_id"`
		Peer      string  `json:"peer_fingerprint"`
		Content   string  `json:"content"`
		MessageID string  `json:"message_id"`
		Before    string  `json:"before"`
		ReplyID   *string `json:"reply_to_message_id"`
		Active    bool    `json:"active"`
	}
	if json.Unmarshal(m.Payload, &v) != nil || len(v.ThreadID) > 100 || len(v.ChannelID) > 100 || len(v.Peer) > 64 || len(v.MessageID) > 20 || len(v.Before) > 20 {
		fail("INVALID_INPUT")
		return
	}
	if m.Type == "CHAT_LIST" {
		out, e := s.chatSummaries(p)
		if e != nil {
			fail("DATABASE_ERROR")
			return
		}
		s.send(p, "ACK", id, map[string]any{"threads": out})
		return
	}
	if m.Type == "CHAT_OPEN" {
		var threads int
		if s.DB.QueryRow("SELECT count(*) FROM chat_threads").Scan(&threads) != nil {
			fail("DATABASE_ERROR")
			return
		}
		candidate := "channel:" + v.ChannelID
		if v.Peer != "" {
			candidate = privateThreadID(s.ID, p.user.Fingerprint, v.Peer)
		}
		var exists int
		s.DB.QueryRow("SELECT count(*) FROM chat_threads WHERE id=?", candidate).Scan(&exists)
		if exists == 0 && threads >= s.Config.Chat.MaxThreads {
			fail("CHAT_STORAGE_LIMIT")
			return
		}

		if v.ChannelID != "" {
			if _, ok := s.channel(v.ChannelID); !ok {
				fail("CHANNEL_NOT_FOUND")
				return
			}
			if !s.require(p, id, "chat.channel.view", v.ChannelID) {
				return
			}
			v.ThreadID = "channel:" + v.ChannelID
			_, e := s.DB.Exec("INSERT OR IGNORE INTO chat_threads(id,server_id,channel_id) VALUES (?,?,?)", v.ThreadID, s.ID, v.ChannelID)
			if e != nil {
				fail("DATABASE_ERROR")
				return
			}
		} else if v.Peer != "" && v.Peer != p.user.Fingerprint {
			if exists == 0 && !s.require(p, id, "chat.private.send", "") {
				return
			}
			var n int
			if s.DB.QueryRow("SELECT count(*) FROM devices WHERE fingerprint=?", v.Peer).Scan(&n) != nil || n != 1 {
				fail("INVALID_INPUT")
				return
			}
			v.ThreadID = privateThreadID(s.ID, p.user.Fingerprint, v.Peer)
			a, b := p.user.Fingerprint, v.Peer
			if a > b {
				a, b = b, a
			}
			_, e := s.DB.Exec("INSERT OR IGNORE INTO chat_threads(id,server_id,fingerprint_a,fingerprint_b) VALUES (?,?,?,?)", v.ThreadID, s.ID, a, b)
			if e != nil {
				fail("DATABASE_ERROR")
				return
			}
		} else {
			fail("INVALID_INPUT")
			return
		}
	}
	t, e := s.chatThread(v.ThreadID)
	if e != nil || !s.chatAccess(p, t, "chat.channel.view") {
		fail("PERMISSION_DENIED")
		return
	}
	switch m.Type {
	case "CHAT_OPEN", "CHAT_HISTORY":
		if m.Type == "CHAT_HISTORY" && t.ChannelID != nil && !s.require(p, id, "chat.channel.history", *t.ChannelID) {
			return
		}
		cursor := int64(9223372036854775807)
		if v.Before != "" {
			cursor, e = strconv.ParseInt(v.Before, 10, 64)
			if e != nil || cursor < 1 {
				fail("INVALID_INPUT")
				return
			}
		}
		messages := []ChatMessage{}
		more := false
		if s.Config.Chat.HistoryEnabled && (t.ChannelID == nil || s.allowed(p.user.Fingerprint, "chat.channel.history", *t.ChannelID)) {
			rows, e := s.DB.Query(messageSelect+"WHERE m.thread_id=? AND m.id<? ORDER BY m.id DESC LIMIT 51", t.ID, cursor)
			if e != nil {
				fail("DATABASE_ERROR")
				return
			}
			for rows.Next() {
				msg, err := scanMessage(rows)
				if err != nil {
					rows.Close()
					fail("DATABASE_ERROR")
					return
				}
				messages = append(messages, s.visibleMessage(p, msg))
			}
			err := rows.Err()
			rows.Close()
			if err != nil {
				fail("DATABASE_ERROR")
				return
			}
			more = len(messages) > 50
			if more {
				messages = messages[:50]
			}
		}
		next := ""
		if len(messages) > 0 {
			next = messages[len(messages)-1].ID
		}
		for a, b := 0, len(messages)-1; a < b; a, b = a+1, b-1 {
			messages[a], messages[b] = messages[b], messages[a]
		}
		s.send(p, "ACK", id, map[string]any{"thread_id": t.ID, "messages": messages, "before": next, "has_more": more})
	case "CHAT_READ":
		seq, e := strconv.ParseInt(v.MessageID, 10, 64)
		var n int
		if e != nil || seq < 1 || s.DB.QueryRow("SELECT count(*) FROM chat_messages WHERE id=? AND thread_id=?", seq, t.ID).Scan(&n) != nil || n != 1 {
			fail("INVALID_INPUT")
			return
		}
		_, e = s.DB.Exec("INSERT INTO chat_reads VALUES (?,?,?) ON CONFLICT(fingerprint,thread_id) DO UPDATE SET message_id=MAX(message_id,excluded.message_id)", p.user.Fingerprint, t.ID, seq)
		if e != nil {
			fail("DATABASE_ERROR")
			return
		}
		s.chatUnread(p, t.ID)
		s.send(p, "ACK", id, nil)
	case "CHAT_TYPING":
		permission := "chat.private.send"
		scope := ""
		if t.ChannelID != nil {
			permission = "chat.channel.send"
			scope = *t.ChannelID
		}
		if !s.require(p, id, permission, scope) {
			return
		}
		if !s.chatRate(p.user.Fingerprint, "typing", s.Config.Chat.TypingPerSecond, time.Second) {
			fail("RATE_LIMITED")
			return
		}
		kind := "TYPING_STOPPED"
		if v.Active {
			kind = "TYPING_STARTED"
		}
		for _, other := range s.clients {
			if other != p && s.chatAccess(other, t, "chat.channel.view") {
				s.send(other, kind, "", map[string]any{"thread_id": t.ID, "fingerprint": p.user.Fingerprint, "nickname": p.user.Nickname})
			}
		}
		s.send(p, "ACK", id, nil)
	case "CHAT_SEND":
		permission, scope := "chat.private.send", ""
		if t.ChannelID != nil {
			permission, scope = "chat.channel.send", *t.ChannelID
		}
		if !s.require(p, id, permission, scope) {
			return
		}
		if t.ChannelID == nil {
			peer := t.A.String
			if peer == p.user.Fingerprint {
				peer = t.B.String
			}
			banned, err := s.chatPeerBanned(peer)
			if err != nil || banned {
				fail("PERMISSION_DENIED")
				return
			}
		}
		if !utf8.ValidString(v.Content) || strings.TrimSpace(v.Content) == "" || utf8.RuneCountInString(v.Content) > s.Config.Chat.MaxMessageLength {
			fail("INVALID_INPUT")
			return
		}
		if !s.chatRate(p.user.Fingerprint, "send-second", s.Config.Chat.MessagesPerSecond, time.Second) || !s.chatRate(p.user.Fingerprint, "send-minute", s.Config.Chat.MessagesPerMinute, time.Minute) {
			fail("RATE_LIMITED")
			return
		}
		if v.ReplyID != nil {
			var n int
			if len(*v.ReplyID) > 20 || s.DB.QueryRow("SELECT count(*) FROM chat_messages WHERE id=? AND thread_id=?", *v.ReplyID, t.ID).Scan(&n) != nil || n != 1 {
				fail("INVALID_INPUT")
				return
			}
		}
		res, e := s.DB.Exec("INSERT INTO chat_messages(thread_id,author_fingerprint,author_nickname_snapshot,content,created_at,reply_to_message_id) VALUES (?,?,?,?,?,?)", t.ID, p.user.Fingerprint, p.user.Nickname, v.Content, time.Now().UTC().Format(time.RFC3339Nano), v.ReplyID)
		if e != nil {
			fail("DATABASE_ERROR")
			return
		}
		s.chatStored++
		seq, _ := res.LastInsertId()
		msg, e := s.message(strconv.FormatInt(seq, 10))
		if e != nil {
			fail("DATABASE_ERROR")
			return
		}
		limit := s.Config.Chat.ChannelHistoryLimit
		if t.ChannelID == nil {
			limit = s.Config.Chat.PrivateHistoryLimit
		}
		if !s.Config.Chat.HistoryEnabled {
			limit = 1
		}
		trim, e := s.DB.Exec("DELETE FROM chat_messages WHERE thread_id=? AND id < COALESCE((SELECT id FROM chat_messages WHERE thread_id=? ORDER BY id DESC LIMIT 1 OFFSET ?),0)", t.ID, t.ID, limit-1)
		if e != nil {
			fail("DATABASE_ERROR")
			return
		}
		removed, _ := trim.RowsAffected()
		s.chatStored -= removed
		if e = s.trimChatStorage(); e != nil {
			fail("DATABASE_ERROR")
			return
		}
		s.chatEvent(t, "CREATED", msg)
		s.send(p, "ACK", id, s.visibleMessage(p, msg))
	case "CHAT_EDIT", "CHAT_DELETE":
		msg, e := s.message(v.MessageID)
		if e != nil || msg.ThreadID != t.ID || msg.Deleted != nil {
			fail("INVALID_INPUT")
			return
		}
		own := msg.Author == p.user.Fingerprint
		if t.ChannelID == nil {
			if !own || !s.require(p, id, "chat.private.send", "") {
				fail("PERMISSION_DENIED")
				return
			}
		} else {
			permission := "chat.channel.edit_own"
			if m.Type == "CHAT_DELETE" {
				permission = "chat.channel.delete_own"
				if !own {
					permission = "chat.channel.delete_others"
				}
			} else if !own {
				fail("PERMISSION_DENIED")
				return
			}
			if !s.require(p, id, permission, *t.ChannelID) {
				return
			}
		}
		if !s.chatRate(p.user.Fingerprint, "edit", s.Config.Chat.EditsPerMinute, time.Minute) {
			fail("RATE_LIMITED")
			return
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		kind := "EDITED"
		if m.Type == "CHAT_EDIT" {
			if !utf8.ValidString(v.Content) || strings.TrimSpace(v.Content) == "" || utf8.RuneCountInString(v.Content) > s.Config.Chat.MaxMessageLength {
				fail("INVALID_INPUT")
				return
			}
			_, e = s.DB.Exec("UPDATE chat_messages SET content=?,edited_at=? WHERE id=?", v.Content, now, msg.ID)
		} else {
			kind = "DELETED"
			_, e = s.DB.Exec("UPDATE chat_messages SET deleted_at=? WHERE id=?", now, msg.ID)
		}
		if e != nil {
			fail("DATABASE_ERROR")
			return
		}
		msg, e = s.message(msg.ID)
		if e != nil {
			fail("DATABASE_ERROR")
			return
		}
		s.chatEvent(t, kind, msg)
		s.send(p, "ACK", id, s.visibleMessage(p, msg))
	default:
		fail("UNKNOWN_MESSAGE")
	}
}

func (s *Server) chatPeerBanned(fp string) (bool, error) {
	rows, e := s.DB.Query("SELECT expires_at FROM bans WHERE fingerprint=?", fp)
	if e != nil {
		return true, e
	}
	defer rows.Close()
	for rows.Next() {
		var expires sql.NullString
		if e = rows.Scan(&expires); e != nil {
			return true, e
		}
		if activeBan(expires, time.Now()) {
			return true, nil
		}
	}
	return false, rows.Err()
}

func (s *Server) trimChatStorage() error {
	if s.chatStored <= int64(s.Config.Chat.MaxStoredMessages) {
		return nil
	}
	// Channel deletion cascades can lower the actual count outside the chat path.
	if e := s.DB.QueryRow("SELECT count(*) FROM chat_messages").Scan(&s.chatStored); e != nil {
		return e
	}
	excess := s.chatStored - int64(s.Config.Chat.MaxStoredMessages)
	if excess <= 0 {
		return nil
	}
	res, e := s.DB.Exec("DELETE FROM chat_messages WHERE id <= (SELECT id FROM chat_messages ORDER BY id LIMIT 1 OFFSET ?)", excess-1)
	if e == nil {
		n, _ := res.RowsAffected()
		s.chatStored -= n
	}
	return e
}
