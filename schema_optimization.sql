CREATE TABLE IF NOT EXISTS meta_ad_daily_fact (
  account_id TEXT NOT NULL,
  day TEXT NOT NULL,
  campaign_id TEXT,
  campaign_name TEXT,
  adset_id TEXT,
  adset_name TEXT,
  ad_id TEXT NOT NULL,
  ad_name TEXT,
  spend REAL NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(account_id, ad_id, day)
);
CREATE INDEX IF NOT EXISTS idx_meta_ad_daily_fact_day ON meta_ad_daily_fact(day);
CREATE INDEX IF NOT EXISTS idx_meta_ad_daily_fact_ad ON meta_ad_daily_fact(ad_id);

CREATE TABLE IF NOT EXISTS crm_ad_daily_fact (
  day TEXT NOT NULL,
  ad_id TEXT NOT NULL,
  opportunities INTEGER NOT NULL DEFAULT 0,
  meetings INTEGER NOT NULL DEFAULT 0,
  no_shows INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0,
  stage_counts_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(day, ad_id)
);
CREATE INDEX IF NOT EXISTS idx_crm_ad_daily_fact_ad ON crm_ad_daily_fact(ad_id);

CREATE TABLE IF NOT EXISTS optimization_segments (
  segment_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  name_contains TEXT NOT NULL DEFAULT '',
  budget REAL NOT NULL DEFAULT 0,
  lead_target INTEGER NOT NULL DEFAULT 0,
  cpl_target REAL NOT NULL DEFAULT 30,
  zero_lead_extra_spend REAL NOT NULL DEFAULT 5,
  min_spend REAL NOT NULL DEFAULT 30,
  min_leads INTEGER NOT NULL DEFAULT 3,
  min_hours INTEGER NOT NULL DEFAULT 24,
  min_impressions INTEGER NOT NULL DEFAULT 1500,
  scale_threshold REAL NOT NULL DEFAULT 80,
  maintain_threshold REAL NOT NULL DEFAULT 65,
  reduce_threshold REAL NOT NULL DEFAULT 45,
  max_increase_pct REAL NOT NULL DEFAULT 30,
  max_decrease_pct REAL NOT NULL DEFAULT 30,
  cascade_pause INTEGER NOT NULL DEFAULT 1,
  weight_cpl REAL NOT NULL DEFAULT 35,
  weight_volume REAL NOT NULL DEFAULT 15,
  weight_appointment REAL NOT NULL DEFAULT 15,
  weight_meeting1 REAL NOT NULL DEFAULT 10,
  weight_meeting2 REAL NOT NULL DEFAULT 10,
  weight_sale REAL NOT NULL DEFAULT 15,
  target_appointment_rate REAL NOT NULL DEFAULT 20,
  target_meeting1_rate REAL NOT NULL DEFAULT 60,
  target_meeting2_rate REAL NOT NULL DEFAULT 50,
  target_sale_rate REAL NOT NULL DEFAULT 25,
  weight_1d REAL NOT NULL DEFAULT 50,
  weight_7d REAL NOT NULL DEFAULT 30,
  weight_30d REAL NOT NULL DEFAULT 20,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS optimization_stage_mapping (
  semantic_stage TEXT PRIMARY KEY,
  stage_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS optimization_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS optimization_recommendations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  segment_key TEXT NOT NULL,
  account_id TEXT,
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT NOT NULL,
  score REAL,
  action TEXT NOT NULL,
  budget_owner_type TEXT,
  budget_owner_id TEXT,
  current_budget REAL,
  suggested_budget REAL,
  status TEXT NOT NULL DEFAULT 'SUGGESTION_AVAILABLE',
  snapshot_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_opt_rec_ad ON optimization_recommendations(ad_id);
CREATE INDEX IF NOT EXISTS idx_opt_rec_status ON optimization_recommendations(status);

CREATE TABLE IF NOT EXISTS optimization_actions (
  id TEXT PRIMARY KEY,
  recommendation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  executed_at TEXT,
  account_id TEXT,
  entity_type TEXT,
  entity_id TEXT,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  request_json TEXT,
  response_json TEXT,
  status TEXT NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_opt_actions_rec ON optimization_actions(recommendation_id);

CREATE TABLE IF NOT EXISTS fx_rates (
  rate_date TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(rate_date, base_currency, quote_currency, source)
);