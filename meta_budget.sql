-- Orçamentos de campanhas e conjuntos (Meta), atualizados pelo cron 1x/hora. A aba Otimização só lê daqui.
CREATE TABLE IF NOT EXISTS meta_budget (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  account_id TEXT,
  campaign_id TEXT,
  name TEXT,
  daily_budget TEXT,
  lifetime_budget TEXT,
  status TEXT,
  effective_status TEXT,
  updated_at TEXT NOT NULL
);
