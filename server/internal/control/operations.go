package control

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"licra/server/internal/permissions"
	"licra/server/internal/protocol"
	"time"
)

func decode(m protocol.Envelope, p any) bool { return json.Unmarshal(m.Payload, p) == nil }
func (s *Server) require(p *client, id, permission, ch string) bool {
	if !s.allowed(p.user.Fingerprint, permission, ch) {
		s.sendError(p, id, "PERMISSION_DENIED")
		return false
	}
	return true
}
func (s *Server) operation(ctx context.Context, p *client, m protocol.Envelope) {
	id := m.RequestID
	invalid := func() { s.sendError(p, id, "INVALID_INPUT") }
	dbError := func(e error) bool {
		if e != nil {
			s.sendError(p, id, "DATABASE_ERROR")
			return true
		}
		return false
	}
	switch m.Type {
	case "VOICE_STATE":
		var v struct {
			Muted    bool `json:"muted"`
			Deafened bool `json:"deafened"`
		}
		if !decode(m, &v) {
			invalid()
			return
		}
		p.user.Muted = v.Muted
		p.user.Deafened = v.Deafened
		s.broadcast("VOICE_STATE_UPDATED", p.user)
		s.send(p, "ACK", id, nil)
	case "REFRESH_VOICE":
		if p.user.ChannelID == "" {
			s.sendError(p, id, "CHANNEL_NOT_FOUND")
			return
		}
		s.join(ctx, p, p, id, p.user.ChannelID, "", false)
	case "LEAVE_CHANNEL":
		if e := s.disconnectVoice(ctx, p); e != nil {
			s.sendError(p, id, "MEDIA_UNAVAILABLE")
			return
		}
		p.user.ChannelID = ""
		s.send(p, "VOICE_LEFT", id, nil)
		s.broadcast("USER_MOVED", p.user)
		s.send(p, "ACK", id, nil)
	case "CLAIM_OWNER":
		var v struct {
			Token string `json:"token"`
		}
		if !decode(m, &v) || len(v.Token) > 128 {
			invalid()
			return
		}
		if time.Since(p.sensitive) < 2*time.Second {
			s.sendError(p, id, "RATE_LIMITED")
			return
		}
		p.sensitive = time.Now()
		if s.claim(p.user.Fingerprint, v.Token) != nil {
			s.sendError(p, id, "INVALID_ADMIN_TOKEN")
			return
		}
		s.permissionsUpdated()
		s.send(p, "ACK", id, nil)
		s.sendRoles()
	case "JOIN_CHANNEL":
		var v struct {
			ChannelID string `json:"channel_id"`
			Password  string `json:"password"`
		}
		if !decode(m, &v) || len(v.Password) > 72 {
			invalid()
			return
		}
		if !s.require(p, id, "channel.move_self", v.ChannelID) {
			return
		}
		s.join(ctx, p, p, id, v.ChannelID, v.Password, false)
	case "MOVE_USER":
		var v struct {
			UserID    string `json:"user_id"`
			ChannelID string `json:"channel_id"`
		}
		if !decode(m, &v) {
			invalid()
			return
		}
		target := s.clients[v.UserID]
		if target == nil {
			s.sendError(p, id, "USER_NOT_FOUND")
			return
		}
		if !s.require(p, id, "channel.move_others", target.user.ChannelID) || !s.require(p, id, "channel.move_others", v.ChannelID) {
			return
		}
		s.join(ctx, p, target, id, v.ChannelID, "", true)
	case "CREATE_CHANNEL", "UPDATE_CHANNEL":
		var v struct {
			Channel
			Password *string `json:"password"`
		}
		if !decode(m, &v) || !validName(v.Name, 64) || len(v.Description) > 2048 || v.MaxUsers < 0 || v.MaxUsers > 10000 || (v.AudioProfile != "eco" && v.AudioProfile != "standard" && v.AudioProfile != "high") || (v.Password != nil && len(*v.Password) > 72) {
			invalid()
			return
		}
		scope := ""
		if v.ParentID != nil {
			scope = *v.ParentID
			if _, ok := s.channel(scope); !ok {
				invalid()
				return
			}
		}
		permission := "channel.create"
		if m.Type == "UPDATE_CHANNEL" {
			permission = "channel.edit"
			if _, ok := s.channel(v.ID); !ok {
				s.sendError(p, id, "CHANNEL_NOT_FOUND")
				return
			}
			if !s.require(p, id, permission, v.ID) {
				return
			}
		}
		if !s.require(p, id, permission, scope) {
			return
		}
		chs, e := s.channels()
		if dbError(e) {
			return
		}
		if m.Type == "CREATE_CHANNEL" && len(chs) >= s.Config.Security.MaxChannels {
			s.sendError(p, id, "CHANNEL_LIMIT")
			return
		}
		parents := map[string]string{}
		for _, c := range chs {
			parents[c.ID] = ""
			if c.ParentID != nil {
				parents[c.ID] = *c.ParentID
			}
		}
		if m.Type == "CREATE_CHANNEL" {
			v.ID = uuid.NewString()
		}
		parents[v.ID] = scope
		for cid := range parents {
			if _, ok := permissions.Ancestors(cid, parents); !ok {
				invalid()
				return
			}
		}
		var hash any
		if v.Password != nil && *v.Password != "" {
			h, e := bcrypt.GenerateFromPassword([]byte(*v.Password), bcrypt.DefaultCost)
			if dbError(e) {
				return
			}
			hash = string(h)
		}
		now := time.Now().UTC().Format(time.RFC3339)
		if m.Type == "CREATE_CHANNEL" {
			_, e = s.DB.Exec("INSERT INTO channels(id,parent_id,name,description,sort_order,max_users,audio_profile,password_hash,is_permanent,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", v.ID, v.ParentID, v.Name, v.Description, v.SortOrder, v.MaxUsers, v.AudioProfile, hash, v.IsPermanent, now, now)
		} else {
			if v.Password == nil {
				c, _ := s.channel(v.ID)
				if c.passwordHash != "" {
					hash = c.passwordHash
				}
			}
			_, e = s.DB.Exec("UPDATE channels SET parent_id=?,name=?,description=?,sort_order=?,max_users=?,audio_profile=?,password_hash=?,is_permanent=?,updated_at=? WHERE id=?", v.ParentID, v.Name, v.Description, v.SortOrder, v.MaxUsers, v.AudioProfile, hash, v.IsPermanent, now, v.ID)
		}
		if dbError(e) {
			return
		}
		ch, _ := s.channel(v.ID)
		kind := "CHANNEL_CREATED"
		if m.Type == "UPDATE_CHANNEL" {
			kind = "CHANNEL_UPDATED"
		}
		s.broadcast(kind, ch)
		s.permissionsUpdated()
		if m.Type == "UPDATE_CHANNEL" {
			for _, u := range s.clients {
				if u.user.ChannelID == ch.ID {
					s.send(u, "VOICE_REJOIN_REQUIRED", "", nil)
				}
			}
		}
		s.send(p, "ACK", id, ch)
	case "DELETE_CHANNEL":
		var v struct {
			ID string `json:"id"`
		}
		if !decode(m, &v) {
			invalid()
			return
		}
		if _, ok := s.channel(v.ID); !ok {
			s.sendError(p, id, "CHANNEL_NOT_FOUND")
			return
		}
		if !s.require(p, id, "channel.delete", v.ID) {
			return
		}
		var n int
		if dbError(s.DB.QueryRow("SELECT count(*) FROM channels WHERE parent_id=?", v.ID).Scan(&n)) {
			return
		}
		if n > 0 {
			s.sendError(p, id, "CHANNEL_HAS_CHILDREN")
			return
		}
		for _, u := range s.clients {
			if u.user.ChannelID == v.ID {
				s.sendError(p, id, "CHANNEL_OCCUPIED")
				return
			}
		}
		_, e := s.DB.Exec("DELETE FROM channels WHERE id=?", v.ID)
		if dbError(e) {
			return
		}
		s.DB.Exec("DELETE FROM device_roles WHERE channel_id=?", v.ID)
		s.broadcast("CHANNEL_DELETED", map[string]string{"id": v.ID})
		s.permissionsUpdated()
		s.send(p, "ACK", id, nil)
	case "UPSERT_ROLE":
		var v Role
		if !decode(m, &v) || !validName(v.Name, 64) {
			invalid()
			return
		}
		action := "role.edit"
		if v.ID == "" {
			action = "role.create"
			v.ID = uuid.NewString()
		}
		if !s.require(p, id, action, "") || !s.require(p, id, "permissions.edit", "") {
			return
		}
		if v.ID == "Owner" {
			s.sendError(p, id, "PROTECTED_ROLE")
			return
		}
		for k, e := range v.Permissions {
			if !permissions.Valid(k) || !permissions.ValidEffect(e) {
				invalid()
				return
			}
		}
		tx, e := s.DB.Begin()
		if dbError(e) {
			return
		}
		defer tx.Rollback()
		_, e = tx.Exec("INSERT INTO roles(id,name) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name", v.ID, v.Name)
		if dbError(e) {
			return
		}
		_, e = tx.Exec("DELETE FROM role_permissions WHERE role_id=?", v.ID)
		if dbError(e) {
			return
		}
		for k, effect := range v.Permissions {
			_, e = tx.Exec("INSERT INTO role_permissions VALUES (?,?,?)", v.ID, k, effect)
			if dbError(e) {
				return
			}
		}
		if dbError(tx.Commit()) {
			return
		}
		s.permissionsUpdated()
		s.sendRoles()
		s.send(p, "ACK", id, nil)
	case "DELETE_ROLE":
		var v struct {
			ID string `json:"id"`
		}
		if !decode(m, &v) {
			invalid()
			return
		}
		if !s.require(p, id, "role.delete", "") {
			return
		}
		if v.ID == "Owner" || v.ID == "Guest" {
			s.sendError(p, id, "PROTECTED_ROLE")
			return
		}
		_, e := s.DB.Exec("DELETE FROM roles WHERE id=?", v.ID)
		if dbError(e) {
			return
		}
		s.permissionsUpdated()
		s.sendRoles()
		s.send(p, "ACK", id, nil)
	case "ASSIGN_ROLE":
		var v struct {
			Fingerprint string `json:"fingerprint"`
			RoleID      string `json:"role_id"`
			ChannelID   string `json:"channel_id"`
			Remove      bool   `json:"remove"`
		}
		if !decode(m, &v) {
			invalid()
			return
		}
		if !s.require(p, id, "role.assign", v.ChannelID) {
			return
		}
		if v.ChannelID != "" {
			if _, ok := s.channel(v.ChannelID); !ok {
				invalid()
				return
			}
		}
		if v.RoleID == "Owner" {
			if v.ChannelID != "" || !s.isOwner(p.user.Fingerprint) {
				s.sendError(p, id, "PROTECTED_ROLE")
				return
			}
			if v.Remove {
				var owners int
				if dbError(s.DB.QueryRow("SELECT count(*) FROM device_roles WHERE role_id='Owner' AND channel_id='' AND fingerprint<>?", v.Fingerprint).Scan(&owners)) {
					return
				}
				if owners == 0 {
					s.sendError(p, id, "LAST_OWNER")
					return
				}
			}
		}
		var e error
		if v.Remove {
			_, e = s.DB.Exec("DELETE FROM device_roles WHERE fingerprint=? AND role_id=? AND channel_id=?", v.Fingerprint, v.RoleID, v.ChannelID)
		} else {
			_, e = s.DB.Exec("INSERT OR IGNORE INTO device_roles VALUES (?,?,?)", v.Fingerprint, v.RoleID, v.ChannelID)
		}
		if dbError(e) {
			return
		}
		s.permissionsUpdated()
		s.send(p, "ACK", id, nil)
	case "SET_OVERRIDE":
		var v struct {
			ChannelID  string             `json:"channel_id"`
			RoleID     string             `json:"role_id"`
			Permission string             `json:"permission"`
			Effect     permissions.Effect `json:"effect"`
		}
		if !decode(m, &v) || !permissions.Valid(v.Permission) || !permissions.ValidEffect(v.Effect) {
			invalid()
			return
		}
		if !s.require(p, id, "permissions.edit", v.ChannelID) {
			return
		}
		if v.RoleID == "Owner" && !s.isOwner(p.user.Fingerprint) {
			s.sendError(p, id, "PROTECTED_ROLE")
			return
		}
		_, e := s.DB.Exec("INSERT INTO channel_permission_overrides VALUES (?,?,?,?) ON CONFLICT(channel_id,role_id,permission) DO UPDATE SET effect=excluded.effect", v.ChannelID, v.RoleID, v.Permission, v.Effect)
		if dbError(e) {
			return
		}
		s.permissionsUpdated()
		s.send(p, "ACK", id, nil)
	default:
		s.moderation(ctx, p, m)
	}
}
func (s *Server) isOwner(fp string) bool {
	var n int
	return s.DB.QueryRow("SELECT count(*) FROM device_roles WHERE fingerprint=? AND role_id='Owner' AND channel_id=''", fp).Scan(&n) == nil && n > 0
}
func (s *Server) sendRoles() {
	rs, e := s.roles()
	if e != nil {
		return
	}
	for _, p := range s.clients {
		if s.allowed(p.user.Fingerprint, "role.view", "") {
			s.send(p, "ROLE_UPDATED", "", map[string]any{"roles": rs})
		}
	}
}
func (s *Server) join(ctx context.Context, actor, target *client, id, ch, password string, force bool) {
	c, ok := s.channel(ch)
	if !ok {
		s.sendError(actor, id, "CHANNEL_NOT_FOUND")
		return
	}
	if !s.allowed(target.user.Fingerprint, "channel.join", ch) {
		s.sendError(actor, id, "PERMISSION_DENIED")
		return
	}
	n := 0
	for _, u := range s.clients {
		if u.user.ChannelID == ch && u != target {
			n++
		}
	}
	if c.MaxUsers > 0 && n >= c.MaxUsers && !s.allowed(actor.user.Fingerprint, "channel.join_full", ch) {
		s.sendError(actor, id, "CHANNEL_FULL")
		return
	}
	if c.HasPassword && target.user.ChannelID != ch && !s.allowed(actor.user.Fingerprint, "channel.join_password_bypass", ch) {
		if time.Since(actor.sensitive) < time.Second {
			s.sendError(actor, id, "RATE_LIMITED")
			return
		}
		actor.sensitive = time.Now()
		if force || bcrypt.CompareHashAndPassword([]byte(c.passwordHash), []byte(password)) != nil {
			s.sendError(actor, id, "CHANNEL_PASSWORD")
			return
		}
	}
	if e := s.media().Ensure(ctx, ch); e != nil {
		s.sendError(actor, id, "MEDIA_UNAVAILABLE")
		return
	}
	token, e := s.media().JoinToken(target.user.ID, target.user.Nickname, ch, !target.user.ServerMuted && s.allowed(target.user.Fingerprint, "voice.speak", ch))
	if e != nil {
		s.sendError(actor, id, "MEDIA_UNAVAILABLE")
		return
	}
	if e = s.disconnectVoice(ctx, target); e != nil {
		s.sendError(actor, id, "MEDIA_UNAVAILABLE")
		return
	}
	target.user.ChannelID = ch
	target.voiceContext, target.voiceCancel = context.WithCancel(context.Background())
	s.send(target, "VOICE_JOIN", id, map[string]any{"token": token, "signaling_path": "/livekit", "channel_id": ch, "audio_profile": c.AudioProfile, "can_speak": !target.user.ServerMuted && s.allowed(target.user.Fingerprint, "voice.speak", ch)})
	s.broadcast("USER_MOVED", target.user)
	s.send(actor, "ACK", id, nil)
}
