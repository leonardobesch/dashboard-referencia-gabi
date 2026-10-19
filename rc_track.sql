CREATE TABLE IF NOT EXISTS rc_track(sid TEXT PRIMARY KEY, vid TEXT, host TEXT, path TEXT, url TEXT, ref TEXT, q_json TEXT, first_json TEXT, ad_id TEXT, utm_source TEXT, utm_campaign TEXT, utm_content TEXT, fbclid TEXT,
  ua TEXT, device TEXT, w INTEGER, h INTEGER, lang TEXT, ip TEXT, country TEXT, region TEXT, city TEXT, lat REAL, lon REAL, tz TEXT,
  started_at TEXT, last_at TEXT, dur INTEGER, scroll INTEGER, clicks_json TEXT, form INTEGER, email TEXT, phone TEXT, name TEXT, last_kind TEXT);
CREATE INDEX IF NOT EXISTS ix_track_last ON rc_track(last_at);
