PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS archive_meta_ad_daily (
  account_id TEXT NOT NULL,
  account_name TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  ad_id TEXT NOT NULL,
  ad_name TEXT,
  day TEXT NOT NULL,
  spend REAL NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  reach INTEGER NOT NULL DEFAULT 0,
  frequency REAL NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  inline_link_clicks INTEGER NOT NULL DEFAULT 0,
  outbound_clicks REAL NOT NULL DEFAULT 0,
  lpv INTEGER NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  ctr REAL NOT NULL DEFAULT 0,
  cpc REAL NOT NULL DEFAULT 0,
  cpm REAL NOT NULL DEFAULT 0,
  views3 INTEGER NOT NULL DEFAULT 0,
  v25 INTEGER NOT NULL DEFAULT 0,
  v50 INTEGER NOT NULL DEFAULT 0,
  v75 INTEGER NOT NULL DEFAULT 0,
  v95 INTEGER NOT NULL DEFAULT 0,
  v100 INTEGER NOT NULL DEFAULT 0,
  thru INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY(ad_id, day)
);

CREATE INDEX IF NOT EXISTS idx_archive_meta_ad_daily_day ON archive_meta_ad_daily(day);
CREATE INDEX IF NOT EXISTS idx_archive_meta_ad_daily_campaign ON archive_meta_ad_daily(campaign_id, day);
CREATE INDEX IF NOT EXISTS idx_archive_meta_ad_daily_account ON archive_meta_ad_daily(account_id, day);

CREATE TABLE IF NOT EXISTS archive_meta_creatives (
  ad_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS archive_meta_daily (
  day TEXT PRIMARY KEY,
  spend REAL NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  lpv INTEGER NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS archive_crm_entities (
  resource TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_updated_at TEXT,
  payload_json TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY(resource, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_archive_crm_resource_updated
ON archive_crm_entities(resource, source_updated_at);

CREATE TABLE IF NOT EXISTS archive_crm_daily (
  day TEXT PRIMARY KEY,
  opportunities INTEGER NOT NULL DEFAULT 0,
  meetings INTEGER NOT NULL DEFAULT 0,
  no_shows INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS archive_sync_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS archive_meta_entities (
  resource TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY(resource, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_archive_meta_entities_account
ON archive_meta_entities(account_id, resource);
