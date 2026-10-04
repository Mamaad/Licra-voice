package control

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"licra/server/internal/protocol"
	"net/netip"
	"os"
	"os/exec"
	"strings"
	"time"
)

func activeBan(expires sql.NullString, now time.Time) bool {
	if !expires.Valid {
		return true
	}
	t, e := time.Parse(time.RFC3339, expires.String)
	return e != nil || now.Before(t)
}
func (s *Server) banned(fp, ip string) (bool, error) {
	rows, e := s.DB.Query("SELECT fingerprint,ip_cidr,expires_at FROM bans")
	if e != nil {
		return true, e
	}
	defer rows.Close()
	addr, e := netip.ParseAddr(ip)
	if e != nil {
		return true, e
	}
	for rows.Next() {
		var fingerprint, cidr, expires sql.NullString
		if e = rows.Scan(&fingerprint, &cidr, &expires); e != nil {
			return true, e
		}
		if !activeBan(expires, time.Now()) {
			continue
		}
		if fingerprint.Valid && fingerprint.String == fp {
			return true, nil
		}
		if cidr.Valid {
			p, e := netip.ParsePrefix(cidr.String)
			if e == nil && p.Contains(addr) {
				return true, nil
			}
		}
	}
	return false, rows.Err()
}
func (s *Server) terminate(ctx context.Context, p *client, kind, reason string) error {
	p.revoked = true
	if e := s.disconnectVoice(ctx, p); e != nil {
		p.revoked = false
		return e
	}
	s.send(p, kind, "", map[string]string{"reason": reason})
	return nil
}
func (s *Server) moderation(ctx context.Context, p *client, m protocol.Envelope) {
	id := m.RequestID
	invalid := func() { s.sendError(p, id, "INVALID_INPUT") }
	var v struct {
		UserID      string  `json:"user_id"`
		Fingerprint string  `json:"fingerprint"`
		IPCIDR      string  `json:"ip_cidr"`
		Reason      string  `json:"reason"`
		ExpiresAt   *string `json:"expires_at"`
		Muted       bool    `json:"muted"`
		Nickname    string  `json:"nickname"`
		Name        string  `json:"name"`
		ID          string  `json:"id"`
	}
	if !decode(m, &v) || len(v.Reason) > 512 {
		invalid()
		return
	}
	target := s.clients[v.UserID]
	switch m.Type {
	case "KICK_USER", "BAN_USER", "MUTE_USER", "CHANGE_NICKNAME":
		if target == nil && m.Type != "BAN_USER" {
			s.sendError(p, id, "USER_NOT_FOUND")
			return
		}
		permission := map[string]string{"KICK_USER": "user.kick", "BAN_USER": "user.ban", "MUTE_USER": "voice.mute_others", "CHANGE_NICKNAME": "user.change_others_nickname"}[m.Type]
		scope := ""
		if target != nil {
			scope = target.user.ChannelID
		}
		if !s.require(p, id, permission, scope) {
			return
		}
		if target != nil && s.isOwner(target.user.Fingerprint) && !s.isOwner(p.user.Fingerprint) {
			s.sendError(p, id, "PROTECTED_ROLE")
			return
		}
		if m.Type == "BAN_USER" {
			if target != nil {
				v.Fingerprint = target.user.Fingerprint
			}
			if v.Fingerprint == "" && v.IPCIDR == "" {
				invalid()
				return
			}
			if len(v.Fingerprint) > 100 {
				invalid()
				return
			}
			if v.IPCIDR != "" {
				prefix, e := netip.ParsePrefix(v.IPCIDR)
				if e != nil {
					invalid()
					return
				}
				v.IPCIDR = prefix.Masked().String()
			}
			if v.ExpiresAt != nil {
				expiry, e := time.Parse(time.RFC3339, *v.ExpiresAt)
				if e != nil || !expiry.After(time.Now()) {
					invalid()
					return
				}
			}
			if !s.isOwner(p.user.Fingerprint) && s.isOwner(v.Fingerprint) {
				s.sendError(p, id, "PROTECTED_ROLE")
				return
			}
			var fp, cidr any
			if v.Fingerprint != "" {
				fp = v.Fingerprint
			}
			if v.IPCIDR != "" {
				cidr = v.IPCIDR
			}
			_, e := s.DB.Exec("INSERT INTO bans VALUES (?,?,?,?,?,?,?)", uuid.NewString(), fp, cidr, v.Reason, p.user.Fingerprint, time.Now().UTC().Format(time.RFC3339), v.ExpiresAt)
			if e != nil {
				s.sendError(p, id, "DATABASE_ERROR")
				return
			}
			for _, u := range s.clients {
				b, e := s.banned(u.user.Fingerprint, u.ip)
				if e != nil {
					s.sendError(p, id, "DATABASE_ERROR")
					return
				}
				if b {
					if e = s.terminate(ctx, u, "BAN", v.Reason); e != nil {
						u.revoked = true
						u.cancel()
					}
				}
			}
		} else if m.Type == "KICK_USER" {
			if e := s.terminate(ctx, target, "KICK", v.Reason); e != nil {
				s.sendError(p, id, "MEDIA_UNAVAILABLE")
				return
			}
		} else if m.Type == "MUTE_USER" {
			if target.user.ChannelID != "" {
				if e := s.media().Permission(ctx, target.user.ChannelID, target.user.ID, !v.Muted && s.allowed(target.user.Fingerprint, "voice.speak", target.user.ChannelID)); e != nil {
					s.sendError(p, id, "MEDIA_UNAVAILABLE")
					return
				}
			}
			target.user.ServerMuted = v.Muted
			s.broadcast("VOICE_STATE_UPDATED", target.user)
		} else {
			if !validName(v.Nickname, 32) {
				invalid()
				return
			}
			target.user.Nickname = v.Nickname
			s.broadcast("USER_UPDATED", target.user)
		}
		s.send(p, "ACK", id, nil)
	case "LIST_BANS":
		if !s.require(p, id, "user.ban", "") {
			return
		}
		rows, e := s.DB.Query("SELECT id,fingerprint,ip_cidr,reason,created_by,created_at,expires_at FROM bans ORDER BY created_at DESC")
		if e != nil {
			s.sendError(p, id, "DATABASE_ERROR")
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			var id, reason, by, created string
			var fp, cidr, expires *string
			if rows.Scan(&id, &fp, &cidr, &reason, &by, &created, &expires) != nil {
				s.sendError(p, m.RequestID, "DATABASE_ERROR")
				return
			}
			items = append(items, map[string]any{"id": id, "fingerprint": fp, "ip_cidr": cidr, "reason": reason, "created_by": by, "created_at": created, "expires_at": expires})
		}
		if rows.Err() != nil {
			s.sendError(p, id, "DATABASE_ERROR")
			return
		}
		s.send(p, "ACK", id, items)
	case "DELETE_BAN":
		if !s.require(p, id, "user.ban", "") {
			return
		}
		if _, e := s.DB.Exec("DELETE FROM bans WHERE id=?", v.ID); e != nil {
			s.sendError(p, id, "DATABASE_ERROR")
			return
		}
		s.send(p, "ACK", id, nil)
	case "LIST_DEVICE_ROLES":
		if !s.require(p, id, "role.view", "") {
			return
		}
		rows, e := s.DB.Query("SELECT fingerprint,role_id,channel_id FROM device_roles")
		if e != nil {
			s.sendError(p, id, "DATABASE_ERROR")
			return
		}
		defer rows.Close()
		items := []map[string]string{}
		for rows.Next() {
			var fp, role, ch string
			if rows.Scan(&fp, &role, &ch) != nil {
				s.sendError(p, id, "DATABASE_ERROR")
				return
			}
			items = append(items, map[string]string{"fingerprint": fp, "role_id": role, "channel_id": ch})
		}
		if rows.Err() != nil {
			s.sendError(p, id, "DATABASE_ERROR")
			return
		}
		s.send(p, "ACK", id, items)
	case "LIST_OVERRIDES":
		if !s.require(p, id, "permissions.view", "") {
			return
		}
		rows, e := s.DB.Query("SELECT channel_id,role_id,permission,effect FROM channel_permission_overrides")
		if e != nil {
			s.sendError(p, id, "DATABASE_ERROR")
			return
		}
		defer rows.Close()
		items := []map[string]string{}
		for rows.Next() {
			var ch, role, permission, effect string
			if rows.Scan(&ch, &role, &permission, &effect) != nil {
				s.sendError(p, id, "DATABASE_ERROR")
				return
			}
			items = append(items, map[string]string{"channel_id": ch, "role_id": role, "permission": permission, "effect": effect})
		}
		if rows.Err() != nil {
			s.sendError(p, id, "DATABASE_ERROR")
			return
		}
		s.send(p, "ACK", id, items)
	case "EDIT_SERVER":
		if !s.require(p, id, "server.edit", "") {
			return
		}
		if !validName(v.Name, 128) {
			invalid()
			return
		}
		_, e := s.DB.Exec("INSERT INTO server_config VALUES ('name',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", v.Name)
		if e != nil {
			s.sendError(p, id, "DATABASE_ERROR")
			return
		}
		s.Config.Server.Name = v.Name
		s.broadcast("SERVER_INFO_UPDATED", map[string]string{"name": v.Name})
		s.send(p, "ACK", id, nil)
	case "GET_SERVER_LOGS":
		if !s.require(p, id, "server.view_logs", "") {
			return
		}
		deadline, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		cmd := exec.CommandContext(deadline, "journalctl", "--user", "-u", "licra-server", "-n", "100", "--no-pager", "-o", "cat")
		data, e := cmd.Output()
		if e != nil {
			s.sendError(p, id, "LOGS_UNAVAILABLE")
			return
		}
		lines := []string{}
		for _, line := range bytes.Split(data, []byte("\n")) {
			var record map[string]any
			if json.Unmarshal(line, &record) == nil && !strings.Contains(strings.ToLower(string(line)), "token") && !strings.Contains(strings.ToLower(string(line)), "secret") {
				lines = append(lines, string(line))
			}
		}
		s.send(p, "ACK", id, map[string]any{"lines": lines})
	case "GET_SERVER_DIAGNOSTICS":
		if !s.require(p, id, "server.view_logs", "") {
			return
		}
		s.send(p, "ACK", id, map[string]any{"uptime": time.Since(s.started).Seconds(), "connected_clients": len(s.clients), "base_port": s.Config.Server.BasePort, "media_udp_port": s.Config.LiveKit.MediaUDPPort, "media_tcp_port": s.Config.LiveKit.MediaTCPPort, "log_source": "journalctl --user -u licra-server"})
	case "SHUTDOWN_SERVER":
		if !s.require(p, id, "server.shutdown", "") {
			return
		}
		s.send(p, "ACK", id, nil)
		go func() {
			time.Sleep(150 * time.Millisecond)
			if process, e := os.FindProcess(os.Getpid()); e == nil {
				process.Signal(os.Interrupt)
			}
		}()
	default:
		s.sendError(p, id, "UNKNOWN_OPERATION")
	}
}

var _ = json.Marshal
