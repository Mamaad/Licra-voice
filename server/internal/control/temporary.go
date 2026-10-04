package control

// PruneTemporary is called only for daemon startup, never by concurrent CLI commands.
func (s *Server) PruneTemporary() error {
	for {
		result, e := s.DB.Exec("DELETE FROM channels WHERE is_permanent=0 AND NOT EXISTS (SELECT 1 FROM channels child WHERE child.parent_id=channels.id)")
		if e != nil {
			return e
		}
		n, e := result.RowsAffected()
		if e != nil {
			return e
		}
		if n == 0 {
			break
		}
	}
	if _, e := s.DB.Exec("DELETE FROM device_roles WHERE channel_id<>'' AND channel_id NOT IN (SELECT id FROM channels)"); e != nil {
		return e
	}
	return s.reloadPolicy()
}
func (s *Server) cleanupTemporary(id string) {
	changed := false
	for id != "" {
		ch, ok := s.channel(id)
		if !ok || ch.IsPermanent {
			break
		}
		occupied := false
		for _, u := range s.clients {
			if u.user.ChannelID == id {
				occupied = true
				break
			}
		}
		if occupied {
			break
		}
		var children int
		if e := s.DB.QueryRow("SELECT count(*) FROM channels WHERE parent_id=?", id).Scan(&children); e != nil || children > 0 {
			break
		}
		if _, e := s.DB.Exec("DELETE FROM channels WHERE id=?", id); e != nil {
			break
		}
		s.DB.Exec("DELETE FROM device_roles WHERE channel_id=?", id)
		s.broadcast("CHANNEL_DELETED", map[string]string{"id": id})
		changed = true
		id = ""
		if ch.ParentID != nil {
			id = *ch.ParentID
		}
	}
	if changed {
		s.permissionsUpdated()
	}
}
func (s *Server) permanentUnderTemporary(parents map[string]string, permanent map[string]bool) bool {
	for id, isPermanent := range permanent {
		if !isPermanent {
			continue
		}
		for parent := parents[id]; parent != ""; parent = parents[parent] {
			if !permanent[parent] {
				return true
			}
		}
	}
	return false
}
