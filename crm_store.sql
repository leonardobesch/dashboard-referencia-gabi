-- Cópia local (D1) do PipeRun: pipelines 78790 (SDR) e 84566 (Closers).
CREATE TABLE IF NOT EXISTS crm_deal (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL,
  stage_id TEXT,
  started_in_stage_id TEXT,
  status INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT,
  person_id TEXT,
  origin_id TEXT,
  lost_reason_id TEXT,
  value REAL NOT NULL DEFAULT 0,
  title TEXT,
  created_at TEXT,
  created_day TEXT,
  lead_day TEXT,
  closed_at TEXT,
  closed_day TEXT,
  updated_at TEXT,
  ad_id TEXT,
  adset_id TEXT,
  campaign_id TEXT,
  meta_account TEXT,
  meta_lead_id TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  page_url TEXT,
  ad_name TEXT,
  campaign_name TEXT,
  sdr_scheduled_day TEXT,
  first_meeting_day TEXT,
  noshow_count INTEGER NOT NULL DEFAULT 0,
  extra_json TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_deal_created ON crm_deal(pipeline_id, created_day);
CREATE INDEX IF NOT EXISTS idx_crm_deal_closed ON crm_deal(pipeline_id, status, closed_day);
CREATE INDEX IF NOT EXISTS idx_crm_deal_person ON crm_deal(person_id, pipeline_id);
CREATE INDEX IF NOT EXISTS idx_crm_deal_ad ON crm_deal(ad_id);

CREATE TABLE IF NOT EXISTS crm_activity (
  id TEXT PRIMARY KEY,
  deal_id TEXT,
  kind TEXT NOT NULL,
  activity_type_id TEXT,
  status INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT,
  start_at TEXT,
  start_day TEXT,
  updated_at TEXT,
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_activity_day ON crm_activity(kind, start_day);
CREATE INDEX IF NOT EXISTS idx_crm_activity_deal ON crm_activity(deal_id);

CREATE TABLE IF NOT EXISTS crm_ref (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT,
  extra_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(kind, id)
);
