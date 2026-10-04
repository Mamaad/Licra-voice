CREATE TABLE youtube_activities (
 channel_id TEXT PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
 payload TEXT NOT NULL
);
