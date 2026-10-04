CREATE TABLE chat_peers (fingerprint TEXT PRIMARY KEY REFERENCES devices(fingerprint) ON DELETE CASCADE, nickname TEXT NOT NULL);
CREATE TABLE chat_threads (
 id TEXT PRIMARY KEY, server_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 channel_id TEXT UNIQUE REFERENCES channels(id) ON DELETE CASCADE,
 fingerprint_a TEXT REFERENCES devices(fingerprint), fingerprint_b TEXT REFERENCES devices(fingerprint),
 CHECK ((channel_id IS NOT NULL AND fingerprint_a IS NULL AND fingerprint_b IS NULL) OR (channel_id IS NULL AND fingerprint_a IS NOT NULL AND fingerprint_b IS NOT NULL AND fingerprint_a < fingerprint_b)),
 UNIQUE(server_id,fingerprint_a,fingerprint_b)
);
CREATE TABLE chat_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
 author_fingerprint TEXT NOT NULL REFERENCES devices(fingerprint), author_nickname_snapshot TEXT NOT NULL,
 content TEXT NOT NULL, created_at TEXT NOT NULL, edited_at TEXT, deleted_at TEXT,
 reply_to_message_id INTEGER REFERENCES chat_messages(id) ON DELETE SET NULL
);
CREATE INDEX chat_messages_thread_cursor ON chat_messages(thread_id,id);
CREATE INDEX chat_messages_retention ON chat_messages(created_at);
CREATE TABLE chat_reads (
 fingerprint TEXT NOT NULL REFERENCES devices(fingerprint) ON DELETE CASCADE,
 thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
 message_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(fingerprint,thread_id)
);
