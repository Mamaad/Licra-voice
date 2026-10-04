package control

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"fmt"
	"github.com/google/uuid"
	"licra/server/internal/permissions"
	"os"
	"path/filepath"
	"time"
)

type Channel struct {
	ID           string  `json:"id"`
	ParentID     *string `json:"parent_id"`
	Name         string  `json:"name"`
	Description  string  `json:"description"`
	SortOrder    int     `json:"sort_order"`
	MaxUsers     int     `json:"max_users"`
	AudioProfile string  `json:"audio_profile"`
	HasPassword  bool    `json:"has_password"`
	IsPermanent  bool    `json:"is_permanent"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
	passwordHash string
}
type Role struct {
	ID          string                        `json:"id"`
	Name        string                        `json:"name"`
	Protected   bool                          `json:"protected"`
	Permissions map[string]permissions.Effect `json:"permissions"`
}

func (s *Server) seed() error {
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for _, p := range permissions.Names {
		res, err := tx.Exec("INSERT OR IGNORE INTO permissions VALUES (?)", p)
		e = err
		if e != nil {
			return e
		}
		added, _ := res.RowsAffected()
		if added > 0 {
			for _, role := range []string{"Owner", "Administrator", "Moderator", "Member", "Guest"} {
				var n int
				tx.QueryRow("SELECT count(*) FROM roles WHERE id=?", role).Scan(&n)
				if n == 1 && defaultPermission(role, p) {
					if _, e = tx.Exec("INSERT OR IGNORE INTO role_permissions VALUES (?,?,'ALLOW')", role, p); e != nil {
						return e
					}
				}
			}
		}
	}
	for _, name := range []string{"Owner", "Administrator", "Moderator", "Member", "Guest"} {
		if _, e = tx.Exec("INSERT OR IGNORE INTO roles VALUES (?,?,?)", name, name, name == "Owner"); e != nil {
			return e
		}
	}
	var initialized string
	e = tx.QueryRow("SELECT value FROM server_config WHERE key='seeded'").Scan(&initialized)
	if e == sql.ErrNoRows {
		for _, role := range []string{"Owner", "Administrator", "Moderator", "Member", "Guest"} {
			for _, p := range permissions.Names {
				allow := defaultPermission(role, p)
				if allow {
					if _, e = tx.Exec("INSERT INTO role_permissions VALUES (?,?,'ALLOW')", role, p); e != nil {
						return e
					}
				}
			}
		}
		now := time.Now().UTC().Format(time.RFC3339)
		general := uuid.NewString()
		for _, ch := range []struct {
			id     string
			parent any
			name   string
		}{{general, nil, "Général"}, {uuid.NewString(), general, "Discussion"}, {uuid.NewString(), general, "AFK"}, {uuid.NewString(), nil, "Gaming"}, {uuid.NewString(), nil, "Dev"}} {
			if _, e = tx.Exec("INSERT INTO channels(id,parent_id,name,audio_profile,created_at,updated_at) VALUES (?,?,?,?,?,?)", ch.id, ch.parent, ch.name, s.Config.Voice.DefaultProfile, now, now); e != nil {
				return e
			}
		}
		if _, e = tx.Exec("INSERT INTO server_config VALUES ('seeded','1')"); e != nil {
			return e
		}
	} else if e != nil {
		return e
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	var name string
	if e = s.DB.QueryRow("SELECT value FROM server_config WHERE key='name'").Scan(&name); e == nil {
		s.Config.Server.Name = name
	} else if e != sql.ErrNoRows {
		return e
	}
	return nil
}
func (s *Server) channels() ([]Channel, error) {
	rows, e := s.DB.Query("SELECT id,parent_id,name,description,sort_order,max_users,audio_profile,password_hash,is_permanent,created_at,updated_at FROM channels ORDER BY sort_order,name,id")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Channel{}
	for rows.Next() {
		var c Channel
		var hash sql.NullString
		if e = rows.Scan(&c.ID, &c.ParentID, &c.Name, &c.Description, &c.SortOrder, &c.MaxUsers, &c.AudioProfile, &hash, &c.IsPermanent, &c.CreatedAt, &c.UpdatedAt); e != nil {
			return nil, e
		}
		c.HasPassword = hash.Valid
		c.passwordHash = hash.String
		out = append(out, c)
	}
	return out, rows.Err()
}
func (s *Server) channel(id string) (Channel, bool) {
	all, e := s.channels()
	if e != nil {
		return Channel{}, false
	}
	for _, c := range all {
		if c.ID == id {
			return c, true
		}
	}
	return Channel{}, false
}
func (s *Server) allowed(fp, permission, ch string) bool { return s.policy.Allowed(fp, permission, ch) }
func (s *Server) reloadPolicy() error {
	p := &permissions.Policy{Parents: map[string]string{}, Assignments: map[string][]permissions.Assignment{}, Rules: map[string]map[string]permissions.Effect{}, Overrides: map[string]map[string]map[string]permissions.Effect{}}
	chs, e := s.channels()
	if e != nil {
		s.policy = nil
		return e
	}
	for _, c := range chs {
		p.Parents[c.ID] = ""
		if c.ParentID != nil {
			p.Parents[c.ID] = *c.ParentID
		}
	}
	queries := []string{"SELECT fingerprint,role_id,channel_id FROM device_roles", "SELECT role_id,permission,effect FROM role_permissions", "SELECT channel_id,role_id,permission,effect FROM channel_permission_overrides"}
	for i, q := range queries {
		rows, e := s.DB.Query(q)
		if e != nil {
			s.policy = nil
			return e
		}
		for rows.Next() {
			var a, b, c, d string
			if i < 2 {
				e = rows.Scan(&a, &b, &c)
			} else {
				e = rows.Scan(&a, &b, &c, &d)
			}
			if e != nil {
				rows.Close()
				s.policy = nil
				return e
			}
			switch i {
			case 0:
				p.Assignments[a] = append(p.Assignments[a], permissions.Assignment{Role: b, Channel: c})
			case 1:
				if p.Rules[a] == nil {
					p.Rules[a] = map[string]permissions.Effect{}
				}
				p.Rules[a][b] = permissions.Effect(c)
			case 2:
				if p.Overrides[a] == nil {
					p.Overrides[a] = map[string]map[string]permissions.Effect{}
				}
				if p.Overrides[a][b] == nil {
					p.Overrides[a][b] = map[string]permissions.Effect{}
				}
				p.Overrides[a][b][c] = permissions.Effect(d)
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			s.policy = nil
			return e
		}
	}
	s.policy = p
	return nil
}
func (s *Server) permissionMap(fp, ch string) map[string]bool {
	m := map[string]bool{}
	for _, p := range permissions.Names {
		m[p] = s.allowed(fp, p, ch)
	}
	return m
}
func (s *Server) roles() ([]Role, error) {
	rows, e := s.DB.Query("SELECT id,name,protected FROM roles ORDER BY name")
	if e != nil {
		return nil, e
	}
	out := []Role{}
	for rows.Next() {
		var r Role
		if e = rows.Scan(&r.ID, &r.Name, &r.Protected); e != nil {
			rows.Close()
			return nil, e
		}
		r.Permissions = map[string]permissions.Effect{}
		out = append(out, r)
	}
	err := rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for i := range out {
		rows, e = s.DB.Query("SELECT permission,effect FROM role_permissions WHERE role_id=?", out[i].ID)
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var p string
			var effect permissions.Effect
			if e = rows.Scan(&p, &effect); e != nil {
				rows.Close()
				return nil, e
			}
			out[i].Permissions[p] = effect
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}
func (s *Server) permissionsUpdated() {
	if s.reloadPolicy() != nil {
		for _, p := range s.clients {
			p.cancel()
		}
		return
	}
	for _, p := range s.clients {
		if !s.allowed(p.user.Fingerprint, "server.view", "") {
			p.revoked = true
			s.send(p, "KICK", "", map[string]string{"reason": "Server permission revoked"})
		}
	}
	s.reconcileVoice()
	s.reconcileScreens()
	chs, _ := s.channels()
	for _, p := range s.clients {
		cm := map[string]map[string]bool{}
		for _, c := range chs {
			cm[c.ID] = s.permissionMap(p.user.Fingerprint, c.ID)
		}
		s.send(p, "PERMISSIONS_UPDATED", "", map[string]any{"permissions": s.permissionMap(p.user.Fingerprint, ""), "channel_permissions": cm})
	}
}
func (s *Server) snapshot(p *client, id string) error {
	chs, e := s.channels()
	if e != nil {
		return e
	}
	rs := []Role{}
	if s.allowed(p.user.Fingerprint, "role.view", "") {
		rs, e = s.roles()
		if e != nil {
			return e
		}
	}
	cm := map[string]map[string]bool{}
	for _, c := range chs {
		cm[c.ID] = s.permissionMap(p.user.Fingerprint, c.ID)
	}
	s.send(p, "SNAPSHOT", id, map[string]any{"server": map[string]any{"name": s.Config.Server.Name, "id": s.ID, "bootstrap_available": s.bootstrapAvailable()}, "self_id": p.user.ID, "channels": chs, "users": s.users(), "roles": rs, "permissions": s.permissionMap(p.user.Fingerprint, ""), "channel_permissions": cm, "chat": s.Config.Chat, "screen": s.Config.Screen})
	s.chatUnread(p)
	s.sendScreenState(p)
	return nil
}
func (s *Server) seedPath() string {
	return filepath.Join(filepath.Dir(s.Config.Database.Path), "bootstrap.seed")
}
func (s *Server) derivedToken(seed []byte) string {
	h := hmac.New(sha256.New, seed)
	h.Write([]byte("licra:owner:" + s.ID))
	return hex.EncodeToString(h.Sum(nil))
}
func (s *Server) AdminToken(regenerate bool) (string, error) {
	var hash string
	e := s.DB.QueryRow("SELECT value FROM server_config WHERE key='bootstrap_hash'").Scan(&hash)
	if e != nil && e != sql.ErrNoRows {
		return "", e
	}
	if !regenerate && hash == "consumed" {
		return "", fmt.Errorf("bootstrap token consumed; use --regenerate")
	}
	if hash != "" && !regenerate {
		seed, e := os.ReadFile(s.seedPath())
		if e != nil {
			return "", e
		}
		token := s.derivedToken(seed)
		h := sha256.Sum256([]byte(token))
		if hex.EncodeToString(h[:]) != hash {
			return "", fmt.Errorf("bootstrap seed mismatch; use --regenerate")
		}
		return token, nil
	}
	seed := make([]byte, 32)
	rand.Read(seed)
	if e = os.WriteFile(s.seedPath(), seed, 0600); e != nil {
		return "", e
	}
	if e = os.Chmod(s.seedPath(), 0600); e != nil {
		return "", e
	}
	token := s.derivedToken(seed)
	h := sha256.Sum256([]byte(token))
	_, e = s.DB.Exec("INSERT INTO server_config VALUES ('bootstrap_hash',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", hex.EncodeToString(h[:]))
	return token, e
}
func (s *Server) BootstrapNeeded() bool {
	var n int
	return s.DB.QueryRow("SELECT count(*) FROM server_config WHERE key='bootstrap_hash'").Scan(&n) == nil && n == 0
}
func (s *Server) claim(fp, token string) error {
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var expected string
	if e = tx.QueryRow("SELECT value FROM server_config WHERE key='bootstrap_hash'").Scan(&expected); e != nil {
		return e
	}
	h := sha256.Sum256([]byte(token))
	if subtle.ConstantTimeCompare([]byte(expected), []byte(hex.EncodeToString(h[:]))) != 1 {
		return fmt.Errorf("invalid token")
	}
	if _, e = tx.Exec("INSERT OR IGNORE INTO device_roles VALUES (?,'Owner','')", fp); e != nil {
		return e
	}
	if _, e = tx.Exec("UPDATE server_config SET value='consumed' WHERE key='bootstrap_hash'"); e != nil {
		return e
	}
	if e = tx.Commit(); e != nil {
		return e
	}
	if e = os.Remove(s.seedPath()); e != nil && !os.IsNotExist(e) {
		return e
	}
	return nil
}

func (s *Server) bootstrapAvailable() bool {
	var value string
	return s.DB.QueryRow("SELECT value FROM server_config WHERE key='bootstrap_hash'").Scan(&value) == nil && value != "consumed"
}

func defaultPermission(role, p string) bool {
	return role == "Owner" || role == "Administrator" || (role == "Moderator" && (p == "user.kick" || p == "voice.mute_others" || p == "channel.move_others" || p == "role.view" || p == "chat.channel.delete_others" || p == "chat.moderation.view_deleted" || p == "screen.stop_others")) || p == "server.view" || p == "channel.join" || p == "channel.move_self" || p == "voice.speak" || p == "screen.share" || p == "screen.watch" || p == "chat.channel.view" || p == "chat.channel.send" || p == "chat.channel.history" || p == "chat.channel.edit_own" || p == "chat.channel.delete_own" || p == "chat.private.send"
}
