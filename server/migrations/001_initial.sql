CREATE TABLE server_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE channels (
 id TEXT PRIMARY KEY, parent_id TEXT REFERENCES channels(id) ON DELETE RESTRICT,
 name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
 max_users INTEGER NOT NULL DEFAULT 0 CHECK(max_users >= 0), audio_profile TEXT NOT NULL DEFAULT 'standard' CHECK(audio_profile IN ('eco','standard','high')),
 password_hash TEXT, is_permanent INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE devices (fingerprint TEXT PRIMARY KEY, public_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, protected INTEGER NOT NULL DEFAULT 0);
CREATE TABLE permissions (name TEXT PRIMARY KEY);
CREATE TABLE role_permissions (role_id TEXT REFERENCES roles(id) ON DELETE CASCADE, permission TEXT REFERENCES permissions(name), effect TEXT NOT NULL CHECK(effect IN ('ALLOW','DENY','INHERIT')), PRIMARY KEY(role_id,permission));
CREATE TABLE device_roles (fingerprint TEXT REFERENCES devices(fingerprint) ON DELETE CASCADE, role_id TEXT REFERENCES roles(id) ON DELETE CASCADE, channel_id TEXT NOT NULL DEFAULT '', PRIMARY KEY(fingerprint,role_id,channel_id));
CREATE TABLE channel_permission_overrides (channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE, role_id TEXT REFERENCES roles(id) ON DELETE CASCADE, permission TEXT REFERENCES permissions(name), effect TEXT NOT NULL CHECK(effect IN ('ALLOW','DENY','INHERIT')), PRIMARY KEY(channel_id,role_id,permission));
CREATE TABLE bans (id TEXT PRIMARY KEY, fingerprint TEXT, ip_cidr TEXT, reason TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, CHECK(fingerprint IS NOT NULL OR ip_cidr IS NOT NULL));
CREATE INDEX bans_fingerprint ON bans(fingerprint);
CREATE INDEX channels_parent ON channels(parent_id);
