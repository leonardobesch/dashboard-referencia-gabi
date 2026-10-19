// Arquivo local (PC) do Growth Funnel OS — histórico completo de Meta Ads + PipeRun em SQLite.
// - Busca os dados pelo Worker (/api/archive/*, requisição assinada): os tokens nunca saem do Cloudflare.
// - Usa o MESMO código de CRM do Worker (crm-store.js), então os números batem entre PC e Cloudflare.
// - Responde o painel para períodos longos em http://127.0.0.1:8789 (/api/history, /api/cache).
// - Quando está em dia, confirma ao Worker (/api/archive/ack) para o Cloudflare manter só 30 dias.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { webcrypto } from "node:crypto";
import zlib from "node:zlib";
import { crmSyncStep, enqueueCrmBackfill, crmFromStore, crmDailyFromStore, crmStoreStatus, dealExtra, saleJourney } from "../crm-store.js";
import { handleOptimizationApi } from "../optimization-worker.js";
import * as RC from "./comercial.mjs";
import { adLeads } from "../rc-shared.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, "config.json"), "utf8"));
const dataDir = path.join(here, "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "referencia-archive.sqlite");
const db = new DatabaseSync(dbPath);
db.exec(fs.readFileSync(path.join(here, "schema.sql"), "utf8"));
db.exec(fs.readFileSync(path.join(here, "..", "crm_store.sql"), "utf8"));
db.exec(`CREATE TABLE IF NOT EXISTS sync_state(key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`);
// Coluna nova (campos de venda/perfil) — bancos criados antes dela recebem via ALTER.
try { db.exec("ALTER TABLE crm_deal ADD COLUMN extra_json TEXT"); } catch {}
// Tabelas da aba Otimização (mesmas do D1) — no PC, sem limite de gravação.
db.exec(fs.readFileSync(path.join(here, "..", "schema_optimization.sql"), "utf8"));
db.exec(fs.readFileSync(path.join(here, "..", "meta_budget.sql"), "utf8"));

const log = (...a) => console.log(new Date().toISOString(), ...a);
const nowIso = () => new Date().toISOString();
const brToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const minDate = (a, b) => (a < b ? a : b);
const num = v => { const n = Number(v || 0); return Number.isFinite(n) ? n : 0; };

// ---------- Adaptador: SQLite local com a mesma interface do D1 (para reutilizar crm-store.js) ----------
const stmtCache = new Map();
const stmt = sql => { if (!stmtCache.has(sql)) stmtCache.set(sql, db.prepare(sql)); return stmtCache.get(sql); };
const clean = a => a.map(v => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v));
function wrap(sql, args = []) {
  return {
    bind: (...a) => wrap(sql, clean(a)),
    all: async () => ({ results: stmt(sql).all(...args) }),
    first: async () => stmt(sql).get(...args) ?? null,
    run: async () => ({ meta: { changes: stmt(sql).run(...args).changes } }),
    exec: () => stmt(sql).run(...args)
  };
}
RC.ensureTables(db);
const local = {
  DB: {
    prepare: sql => wrap(sql),
    batch: async list => { db.exec("BEGIN"); try { for (const s of list) s.exec(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; }
  }
};
const state = { get: k => stmt("SELECT value FROM sync_state WHERE key=?").get(k)?.value ?? null, set: (k, v) => stmt("INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").run(k, JSON.stringify(v), nowIso()) };
const stateVal = k => { const v = state.get(k); try { return v === null ? null : JSON.parse(v); } catch { return v; } };

// ---------- Ponte assinada com o Worker ----------
let signingKey = null;
async function workerJson(route, opt = {}) {
  signingKey ||= webcrypto.subtle.importKey("pkcs8", Buffer.from(cfg.archivePrivateKeyPkcs8, "base64"), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const url = new URL(route, cfg.workerUrl), method = String(opt.method || "GET").toUpperCase(), ts = String(Date.now());
  const sig = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey, new TextEncoder().encode(`${ts}\n${method}\n${url.pathname}${url.search}`));
  const headers = { accept: "application/json", "x-archive-ts": ts, "x-archive-signature": Buffer.from(sig).toString("base64") };
  if (opt.body) headers["content-type"] = "application/json";
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { method, headers, body: opt.body });
    const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    if (r.ok && !j.error) return j;
    if (attempt >= 3 || r.status === 401 || r.status === 400) throw new Error(j.error || `HTTP ${r.status}`);
    await new Promise(res => setTimeout(res, 5000 * attempt));
  }
}
const pipeBridge = (resource, params) => workerJson(`/api/archive/crm-page?${new URLSearchParams({ resource, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })}`);

// ---------- Meta: anúncio × dia por conta ----------
const upsertAd = db.prepare(`INSERT INTO archive_meta_ad_daily(account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,day,
 spend,impressions,reach,frequency,clicks,inline_link_clicks,outbound_clicks,lpv,leads,ctr,cpc,cpm,views3,v25,v50,v75,v95,v100,thru,payload_json,synced_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(ad_id,day) DO UPDATE SET account_id=excluded.account_id,account_name=excluded.account_name,campaign_id=excluded.campaign_id,campaign_name=excluded.campaign_name,
 adset_id=excluded.adset_id,adset_name=excluded.adset_name,ad_name=excluded.ad_name,spend=excluded.spend,impressions=excluded.impressions,reach=excluded.reach,frequency=excluded.frequency,
 clicks=excluded.clicks,inline_link_clicks=excluded.inline_link_clicks,outbound_clicks=excluded.outbound_clicks,lpv=excluded.lpv,leads=excluded.leads,ctr=excluded.ctr,cpc=excluded.cpc,cpm=excluded.cpm,
 views3=excluded.views3,v25=excluded.v25,v50=excluded.v50,v75=excluded.v75,v95=excluded.v95,v100=excluded.v100,thru=excluded.thru,payload_json=excluded.payload_json,synced_at=excluded.synced_at`);
const upsertCreative = db.prepare(`INSERT INTO archive_meta_creatives(ad_id,payload_json,synced_at) VALUES(?,?,?) ON CONFLICT(ad_id) DO UPDATE SET payload_json=excluded.payload_json,synced_at=excluded.synced_at`);
const upsertEntity = db.prepare(`INSERT INTO archive_meta_entities(resource,entity_id,account_id,payload_json,synced_at) VALUES(?,?,?,?,?) ON CONFLICT(resource,entity_id) DO UPDATE SET account_id=excluded.account_id,payload_json=excluded.payload_json,synced_at=excluded.synced_at`);
const upsertRaw = db.prepare(`INSERT INTO archive_crm_entities(resource,entity_id,source_updated_at,payload_json,synced_at) VALUES(?,?,?,?,?) ON CONFLICT(resource,entity_id) DO UPDATE SET source_updated_at=excluded.source_updated_at,payload_json=excluded.payload_json,synced_at=excluded.synced_at`);

function storeMeta(payload) {
  const stamp = nowIso(); let rows = 0;
  db.exec("BEGIN");
  try {
    for (const acc of payload.accounts || []) {
      for (const r of acc.rows || []) {
        const day = String(r.date_start || r.day || ""), adId = String(r.ad_id || "");
        if (!day || !adId) continue;
        upsertAd.run(String(r.account_id || acc.accountId || ""), String(r.account_name || ""), String(r.campaign_id || ""), String(r.campaign_name || ""), String(r.adset_id || ""), String(r.adset_name || ""), adId, String(r.ad_name || ""), day,
          num(r.spend), num(r.impressions), num(r.reach), num(r.frequency), num(r.clicks), num(r.inline_link_clicks), num(r.outbound_clicks), num(r.lpv), num(r.leads), num(r.ctr), num(r.cpc), num(r.cpm),
          num(r.views3), num(r.v25), num(r.v50), num(r.v75), num(r.v95), num(r.v100), num(r.thru), JSON.stringify(r), stamp);
        rows++;
      }
      for (const c of acc.creatives || []) if (c?.id) upsertCreative.run(String(c.id), JSON.stringify(c), stamp);
      for (const [resource, items] of Object.entries(acc.entities || {})) for (const it of items || []) if (it?.id) upsertEntity.run(resource, String(it.id), String(acc.accountId || ""), JSON.stringify(it), stamp);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  return rows;
}
// Busca uma janela; se a Meta recusar (volume), divide em janelas menores até 1 dia.
async function metaWindow(accountId, since, until, extra = "") {
  try {
    return storeMeta(await workerJson(`/api/archive/meta?since=${since}&until=${until}&account_id=${accountId}${extra}`));
  } catch (e) {
    // Limite de chamadas da Meta: não insistir (piora o bloqueio). Interrompe o ciclo; o próximo retoma do mesmo ponto.
    if (/too many calls|rate limit|request limit/i.test(e.message)) throw Object.assign(new Error("Meta limitou chamadas — retomando no próximo ciclo"), { rateLimited: true });
    if (since === until) { log("Meta falhou", accountId, since, e.message); const failed = stateVal("meta_failed_days") || []; failed.push([accountId, since]); state.set("meta_failed_days", failed.slice(-500)); return 0; }
    const mid = addDays(since, Math.floor((Date.parse(until) - Date.parse(since)) / 172800000));
    return (await metaWindow(accountId, since, mid, extra)) + (await metaWindow(accountId, addDays(mid, 1), until, extra));
  }
}
async function accountIds() { return (await workerJson("/api/archive/status")).accountIds || []; }
async function syncMeta() {
  const end = brToday(), ids = await accountIds(); let rows = 0, pending = 0;
  // 1) Prioridade: estrutura e status atuais (campanhas/conjuntos/anúncios) 1x/dia e os últimos dias (a Meta ainda ajusta).
  for (const id of ids) {
    if (stateVal(`meta_entities_${id}`) !== end) { await metaWindow(id, end, end, "&entities=1"); state.set(`meta_entities_${id}`, end); log("Meta estrutura ok", id); }
    rows += await metaWindow(id, addDays(end, -Number(cfg.hotRefreshDays || 3) + 1), end);
  }
  if (stateVal("meta_recent_done") !== end) { for (const id of ids) rows += await metaWindow(id, addDays(end, -29), end); state.set("meta_recent_done", end); }
  // 2) Histórico antigo só depois, e em pausa por 1 h após um bloqueio da Meta (para não gastar a cota).
  if (Date.now() < Number(stateVal("meta_cooldown_until") || 0)) return { rows, accountsPending: -1, cooldown: true };
  try {
    const failed = stateVal("meta_failed_days") || [];
    for (const [id, day] of failed.slice(0, 20)) { rows += await metaWindow(id, day, day); state.set("meta_failed_days", (stateVal("meta_failed_days") || []).filter(([x, d]) => !(x === id && d === day))); }
    for (const id of ids) {
      let next = stateVal(`meta_next_${id}`) || cfg.initialSince || "2024-01-01", chunks = 0;
      while (next <= end && chunks < Number(cfg.backfillChunksPerSync || 8)) { const until = minDate(addDays(next, 6), end); rows += await metaWindow(id, next, until); chunks++; next = addDays(until, 1); state.set(`meta_next_${id}`, next); }
      if (next <= end) pending++;
    }
  } catch (e) { if (e.rateLimited) { state.set("meta_cooldown_until", Date.now() + 3600000); log("Meta limitou o histórico — pausa de 1 h"); return { rows, accountsPending: -1, cooldown: true }; } throw e; }
  state.set("meta_backfill_complete", pending === 0);
  return { rows, accountsPending: pending };
}
// ---------- CRM: mesma cópia incremental do Worker, sem limite de passos ----------
async function syncCrm() {
  if (!stateVal("crm_backfill_enqueued")) {
    const n = await enqueueCrmBackfill(local, pipeBridge, cfg.initialSince || "2024-01-01", brToday());
    state.set("crm_backfill_enqueued", true); log("CRM: histórico enfileirado", n, "blocos");
  }
  const onRows = async (job, rows) => {
    const stamp = nowIso(), resource = job.res === "deals" ? "deals" : `activities_${job.kind}`;
    // Registro bruto completo, comprimido (deflate) — ler com zlib.inflateSync(payload_json).
    db.exec("BEGIN"); try { for (const r of rows) if (r?.id) upsertRaw.run(resource, String(r.id), String(r.updated_at || ""), zlib.deflateSync(JSON.stringify(r)), stamp); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
  };
  let r, steps = 0;
  do { r = await crmSyncStep(local, pipeBridge, 40, { onRows }); steps++; if (r.pages) log("CRM passo", JSON.stringify(r).slice(0, 220)); } while (r.pending > 0 && steps < Number(cfg.crmStepsPerSync || 40));
  return r;
}


// ---------- PC → Cloudflare: envia só o que mudou (janela quente de 30 dias) ----------
async function pushToCloud() {
  const since = stateVal("push_at") || "", startedAt = nowIso(), hot = addDays(brToday(), -29), act = v => (String(v).startsWith("act_") ? String(v) : `act_${v}`);
  const q = (sql, ...a) => db.prepare(sql).all(...a), sent = {};
  const send = async (table, rows) => { for (let i = 0; i < rows.length; i += 300) { await workerJson("/api/archive/push", { method: "POST", body: JSON.stringify({ tables: { [table]: rows.slice(i, i + 300) } }) }); } sent[table] = (sent[table] || 0) + rows.length; };
  // Meta anúncio × dia e totais por conta × dia
  // Meta vai ao Cloudflare no máximo 1x por hora (limite de gravações do D1 grátis).
  const metaSince = stateVal("push_meta_at") || "", metaDue = !metaSince || Date.now() - new Date(metaSince).getTime() > 55 * 60000;
  const ad = metaDue ? q(`SELECT * FROM archive_meta_ad_daily WHERE day>=? AND synced_at>?`, hot, metaSince) : [];
  if (metaDue) state.set("push_meta_at", startedAt);
  await send("meta_ad_day", ad.map(r => ({ ad_id: r.ad_id, day: r.day, account_id: act(r.account_id), account_name: r.account_name, campaign_id: r.campaign_id, campaign_name: r.campaign_name, adset_id: r.adset_id, adset_name: r.adset_name, ad_name: r.ad_name, spend: r.spend, impressions: r.impressions, reach: r.reach, clicks: r.clicks, inline_link_clicks: r.inline_link_clicks, outbound_clicks: r.outbound_clicks, lpv: r.lpv, leads: r.leads, views3: r.views3, v25: r.v25, v50: r.v50, v75: r.v75, v95: r.v95, v100: r.v100, thru: r.thru, updated_at: r.synced_at })));
  const days = [...new Set(ad.map(r => r.day))];
  if (days.length) await send("meta_daily_fact", q(`SELECT account_id,day,SUM(spend) spend,SUM(impressions) impressions,SUM(inline_link_clicks) clicks,SUM(lpv) lpv,SUM(leads) leads FROM archive_meta_ad_daily WHERE day IN (${days.map(() => "?").join(",")}) GROUP BY account_id,day`, ...days).map(r => ({ ...r, account_id: act(r.account_id), updated_at: startedAt })));
  // Criativos (formato do cache do Cloudflare)
  if (metaDue) await send("creative_cache", q(`SELECT ad_id,payload_json,synced_at FROM archive_meta_creatives WHERE synced_at>?`, metaSince).map(r => { let c = {}; try { c = JSON.parse(r.payload_json); } catch {} return c?.creative ? { ad_id: r.ad_id, creative_json: JSON.stringify({ ...c.creative, _ad_created_time: c.created_time || "", _ad_status: c.effective_status || c.status || "", _ad_name: c.name || "" }), updated_at: r.synced_at } : null; }).filter(Boolean));
  // CRM (30 dias), referências e orçamentos/status
  await send("crm_deal", q(`SELECT * FROM crm_deal WHERE synced_at>? AND (created_day>=? OR closed_day>=? OR substr(updated_at,1,10)>=?)`, since, hot, hot, hot));
  await send("crm_activity", q(`SELECT * FROM crm_activity WHERE synced_at>? AND start_day>=?`, since, hot));
  await send("crm_ref", q(`SELECT * FROM crm_ref WHERE updated_at>?`, since));
  const ents = q(`SELECT resource,account_id,payload_json FROM archive_meta_entities WHERE resource IN ('campaigns','adsets') AND synced_at>?`, since);
  await send("meta_budget", ents.map(r => { let x = {}; try { x = JSON.parse(r.payload_json); } catch {} return x.id ? { id: String(x.id), level: r.resource === "campaigns" ? "campaign" : "adset", account_id: String(r.account_id), campaign_id: String(x.campaign_id || x.id), name: String(x.name || ""), daily_budget: String(x.daily_budget || ""), lifetime_budget: String(x.lifetime_budget || ""), status: String(x.status || ""), effective_status: String(x.effective_status || ""), updated_at: startedAt } : null; }).filter(Boolean));
  await send("sync_state", [{ key: "meta_synced_at", value: startedAt, updated_at: startedAt }, { key: "crm_incremental_at", value: JSON.stringify(stateVal("crm_incremental_at") || startedAt), updated_at: startedAt }]);
  state.set("push_at", startedAt);
  return sent;
}

let syncing = false, lastResult = null;
// Rápido (a cada 5 min): CRM incremental + histórico de etapas + pacote pronto para o Cloudflare.
async function rcExtras() {
  try { const m = await workerJson("/api/archive/loss-real"); for (const [id, v] of Object.entries(m || {})) db.prepare("INSERT INTO rc_loss_real(deal_id,reason,note,at) VALUES(?,?,?,?) ON CONFLICT(deal_id) DO UPDATE SET reason=excluded.reason,note=excluded.note,at=excluded.at").run(id, v.reason, v.note || "", v.at || ""); } catch (e) { log("Motivos reais:", e.message); }
  try { const x = await RC.syncExtras(db, pipeBridge, state, log); if (x.stageHistory) log("Etapas", JSON.stringify(x)); } catch (e) { log("Etapas falhou:", e.message); }
  try { await RC.syncTrack(db, workerJson, state, log); } catch (e) { log("Visitas falhou:", e.message); }
  try { const t = Date.now(), body = JSON.stringify(RC.snapshot(db)); await workerJson("/api/archive/snapshot", { method: "POST", body }); log("Pacote enviado", Math.round(body.length / 1024) + "KB", (Date.now() - t) + "ms"); } catch (e) { log("Pacote falhou:", e.message); }
}
// Respostas pesadas prontas para o Cloudflare (o painel abre na hora fora do PC).
async function workerPutRaw(route, buf) {
  signingKey ||= webcrypto.subtle.importKey("pkcs8", Buffer.from(cfg.archivePrivateKeyPkcs8, "base64"), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const url = new URL(route, cfg.workerUrl), ts = String(Date.now()), sig = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey, new TextEncoder().encode(`${ts}\nPOST\n${url.pathname}${url.search}`));
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/octet-stream", "x-archive-ts": ts, "x-archive-signature": Buffer.from(sig).toString("base64") }, body: buf });
  const j = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`); return j;
}
let precomputeAt = 0;
async function precompute(force = false) {
  if (!force && Date.now() - precomputeAt < 20 * 60000) return; precomputeAt = Date.now();
  const t0 = Date.now(), today = brToday(), range = n => [addDays(today, -(n - 1)), today], jobs = [];
  for (const n of [7, 30, 90]) jobs.push(["cache", ...range(n)]);
  for (const seg of ["GERAL", "EXTERIOR"]) for (const n of [7, 30]) jobs.push(["opt", seg, ...range(n)]);
  let bytes = 0;
  for (const job of jobs) {
    try {
      let body;
      if (job[0] === "cache") {
        const [, since, until] = job, ads = metaAds(since, until), ids = [...new Set(ads.map(a => String(a.ad_id)))];
        body = JSON.stringify({ ads, daily: metaDaily(since, until), creatives: creatives(ids), crm: await crmFromStore(local, since, until), cachedAccounts: new Set(ads.map(a => a.account_id)).size, totalAccounts: null, lastUpdated: stateVal("last_successful_sync"), source: "pc-pronto" });
      } else {
        const [, seg, since, until] = job, path = `/api/optimization/data?${new URLSearchParams({ segment: seg, since, until })}`;
        const r = await optimizationApi({ method: "GET", url: path }, new URL(path, "http://127.0.0.1"), undefined); if (!r.ok) throw new Error(`HTTP ${r.status}`); body = await r.text();
      }
      const gz = zlib.gzipSync(Buffer.from(body), { level: 6 }); bytes += gz.length;
      await workerPutRaw(`/api/archive/precomputed?key=${encodeURIComponent(job.join("|"))}`, gz);
    } catch (e) { log("Pré-cálculo falhou", job.join("|"), e.message); }
  }
  log("Pré-cálculo enviado", jobs.length, "telas", Math.round(bytes / 1024) + "KB", (Date.now() - t0) + "ms");
}
async function fastSync() {
  if (syncing) return; syncing = true;
  try { await syncCrm(); } catch (e) { log("CRM rápido falhou:", e.message); } finally { syncing = false; }
  await rcExtras();
  try { await precompute(); } catch (e) { log("Pré-cálculo:", e.message); }
}
async function syncAll() {
  if (syncing) return { ok: false, busy: true };
  syncing = true; const started = nowIso();
  try {
    const crm = await syncCrm(); await rcExtras(); const meta = await syncMeta();
    try { await precompute(); } catch (e) { log("Pré-cálculo:", e.message); }
    refreshBudgets();
    let pushed = null; try { pushed = await pushToCloud(); log("Enviado ao Cloudflare", JSON.stringify(pushed)); } catch (e) { log("Envio ao Cloudflare falhou:", e.message); }
    let ack = null;
    const crmState = await crmStoreStatus(local);
    if (meta.accountsPending === 0 && crmState.queue === 0 && crmState.incrementalAt) {
      ack = await workerJson("/api/archive/ack", { method: "POST", body: JSON.stringify({ archivedThrough: brToday() }) });
      state.set("archive_ack", { at: nowIso(), ack });
    }
    state.set("last_successful_sync", nowIso());
    lastResult = { ok: true, started, finished: nowIso(), meta, crm, ack };
    log("Sync ok", JSON.stringify({ meta, crmPending: crm.pending, ack: ack?.purged ?? null }));
  } catch (e) {
    state.set("last_sync_error", String(e.stack || e)); lastResult = { ok: false, started, error: e.message }; log("Sync falhou", e.message);
  } finally { syncing = false; }
  return lastResult;
}

// ---------- Consultas para o painel (mesmo formato do Worker) ----------
function metaHistory(since, until) {
  return stmt(`SELECT day,SUM(spend) spend,SUM(impressions) impressions,SUM(inline_link_clicks) clicks,SUM(lpv) lpv,SUM(leads) leads FROM archive_meta_ad_daily WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day`).all(since, until);
}
function metaAds(since, until) {
  return stmt(`SELECT account_id,MAX(account_name) account_name,MAX(campaign_id) campaign_id,MAX(campaign_name) campaign_name,MAX(adset_id) adset_id,MAX(adset_name) adset_name,ad_id,MAX(ad_name) ad_name,
    ? date_start,? date_stop,SUM(spend) spend,SUM(impressions) impressions,SUM(reach) reach,SUM(clicks) clicks,SUM(inline_link_clicks) inline_link_clicks,SUM(outbound_clicks) outbound_clicks,
    SUM(lpv) lpv,SUM(leads) leads,SUM(views3) views3,SUM(v25) v25,SUM(v50) v50,SUM(v75) v75,SUM(v95) v95,SUM(v100) v100,SUM(thru) thru
    FROM archive_meta_ad_daily WHERE day BETWEEN ? AND ? GROUP BY ad_id,account_id`).all(since, until, since, until).map(a => ({
    ...a, ctr: a.impressions ? 100 * a.clicks / a.impressions : 0, cpc: a.clicks ? a.spend / a.clicks : 0, cpm: a.impressions ? 1000 * a.spend / a.impressions : 0, frequency: a.reach ? a.impressions / a.reach : 0
  }));
}
function metaDaily(since, until) {
  return stmt(`SELECT account_id,MAX(account_name) account_name,day date_start,day date_stop,SUM(spend) spend,SUM(impressions) impressions,SUM(reach) reach,SUM(clicks) clicks,SUM(inline_link_clicks) inline_link_clicks,SUM(leads) leads,SUM(lpv) lpv
    FROM archive_meta_ad_daily WHERE day BETWEEN ? AND ? GROUP BY account_id,day ORDER BY day`).all(since, until);
}
function creatives(adIds) {
  const out = [];
  for (let i = 0; i < adIds.length; i += 400) {
    const part = adIds.slice(i, i + 400);
    for (const r of db.prepare(`SELECT ad_id,payload_json FROM archive_meta_creatives WHERE ad_id IN (${part.map(() => "?").join(",")})`).all(...part)) {
      try { const c = JSON.parse(r.payload_json); if (c?.creative) out.push({ id: String(r.ad_id), creative: { ...c.creative, _ad_created_time: c.created_time || "", _ad_status: c.effective_status || c.status || "", _ad_name: c.name || "" } }); } catch {}
    }
  }
  return out;
}
function coverage() {
  const m = stmt(`SELECT MIN(day) a,MAX(day) b,COUNT(*) n FROM archive_meta_ad_daily`).get(), c = stmt(`SELECT MIN(created_day) a,MAX(created_day) b,COUNT(*) n FROM crm_deal`).get();
  return { meta: m, crm: c, metaBackfillComplete: !!stateVal("meta_backfill_complete"), lastSync: stateVal("last_successful_sync"), ack: stateVal("archive_ack") };
}

// ---------- Aba Otimização rodando no PC (mesmo motor do Worker: optimization-worker.js) ----------
let accountsCache = null, storedCache = null;
async function accountsList() {
  if (accountsCache && Date.now() - accountsCache.at < 6 * 3600000) return accountsCache.data;
  try { const j = await workerJson("/api/archive/accounts"); accountsCache = { at: Date.now(), data: j.data || [] }; }
  catch { accountsCache = { at: Date.now() - 5 * 3600000, data: (await accountIds()).map(id => ({ id, name: stmt("SELECT MAX(account_name) n FROM archive_meta_ad_daily WHERE account_id=?").get(id)?.n || id, currency: "BRL" })) }; }
  return accountsCache.data;
}
async function storedConfig() {
  if (storedCache && Date.now() - storedCache.at < 300000) return storedCache.data;
  // Assinado: o painel tem login e só deixa passar o PC com assinatura.
  const data = await workerJson("/api/config"); if (data?.selectedAccountIds) storedCache = { at: Date.now(), data }; return data;
}
// Configuração da Otimização: na primeira vez, copia a do Cloudflare (segmentações, premissas, mapeamento).
async function seedOptimizationConfig() {
  if (stmt("SELECT COUNT(*) n FROM optimization_segments").get().n) return;
  try {
    const j = await workerJson("/api/optimization/config"), now = nowIso();
    for (const s of j.segments || []) { const cols = Object.keys(s); db.prepare(`INSERT OR REPLACE INTO optimization_segments(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`).run(...cols.map(c => s[c] ?? null)); }
    for (const [k, v] of Object.entries(j.settings || {})) stmt("INSERT OR REPLACE INTO optimization_settings(key,value_json,updated_at) VALUES(?,?,?)").run(k, JSON.stringify(v), now);
    log("Otimização: configuração copiada do Cloudflare", (j.segments || []).length, "segmentações");
  } catch (e) { log("Otimização: não copiou configuração", e.message); }
}
// Orçamentos de campanhas/conjuntos a partir do inventário salvo (archive_meta_entities).
function refreshBudgets() {
  const up = db.prepare(`INSERT OR REPLACE INTO meta_budget(id,level,account_id,campaign_id,name,daily_budget,lifetime_budget,status,effective_status,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`), now = nowIso();
  db.exec("BEGIN");
  try {
    for (const r of stmt(`SELECT resource,account_id,payload_json FROM archive_meta_entities WHERE resource IN ('campaigns','adsets')`).all()) {
      let x; try { x = JSON.parse(r.payload_json); } catch { continue; }
      up.run(String(x.id), r.resource === "campaigns" ? "campaign" : "adset", String(r.account_id), String(x.campaign_id || x.id), String(x.name || ""), String(x.daily_budget || ""), String(x.lifetime_budget || ""), String(x.status || ""), String(x.effective_status || ""), now);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}
async function localPersistentCache(env, ids, since, until, opts = {}) {
  // A Meta devolve account_id sem "act_" nos insights; a lista de contas usa com "act_".
  const act = v => (String(v).startsWith("act_") ? String(v) : `act_${v}`), set = new Set((ids || []).map(act));
  const ads = metaAds(since, until).map(a => ({ ...a, account_id: act(a.account_id) })).filter(a => set.has(a.account_id));
  const daily = metaDaily(since, until).map(r => ({ ...r, account_id: act(r.account_id) })).filter(r => set.has(r.account_id));
  const crea = opts.light && !opts.creatives ? [] : creatives([...new Set(ads.map(a => String(a.ad_id)))]);
  return { ads, daily, creatives: crea, crm: await crmFromStore(local, since, until, { light: !!opts.light }), cachedAccounts: new Set(ads.map(a => a.account_id)).size, totalAccounts: set.size, lastUpdated: stateVal("last_successful_sync") };
}
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
async function optimizationApi(req, u, body) {
  await seedOptimizationConfig();
  const webReq = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: { "content-type": "application/json" }, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
  const filterRcAccountIds = list => { const ok = new Set((accountsCache?.data || []).map(a => String(a.id))); return [...new Set((list || []).map(String))].filter(id => !ok.size || ok.has(id)); };
  await accountsList();
  const deps = {
    json: jsonResponse, reqJson: async r => { try { return await r.json(); } catch { return {}; } }, filterRcAccountIds,
    getMetaConfig: async () => ({}), getAccounts: async () => accountsList(),
    loadPersistentCache: localPersistentCache, getPipeToken: async () => "", syncPipeRun: (t, s, u2) => crmFromStore(local, s, u2), saveCrmPeriod: async () => {},
    syncNow: async () => { syncAll(); return { ok: true, message: "Sincronização iniciada no PC; os números atualizam em instantes." }; },
    metaGet: async (p, params) => workerJson(`/api/archive/meta-object?${new URLSearchParams({ id: p, fields: params?.fields || "id" })}`),
    metaPost: async (id, params) => workerJson("/api/archive/meta-action", { method: "POST", body: JSON.stringify({ id, params }) })
  };
  return handleOptimizationApi(webReq, local, u, await storedConfig(), deps);
}
// Tudo que não é local é repassado ao Worker (ex.: /api/config, /api/crm/pipelines).
async function proxyToWorker(req, u, body) {
  signingKey ||= webcrypto.subtle.importKey("pkcs8", Buffer.from(cfg.archivePrivateKeyPkcs8, "base64"), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const ts = String(Date.now()), sig = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey, new TextEncoder().encode(`${ts}
${req.method}
${u.pathname}${u.search}`));
  const r = await fetch(new URL(u.pathname + u.search, cfg.workerUrl), { method: req.method, headers: { "content-type": "application/json", "x-archive-ts": ts, "x-archive-signature": Buffer.from(sig).toString("base64") }, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
  return new Response(await r.arrayBuffer(), { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json" } });
}
const readBody = req => new Promise(res => { const parts = []; req.on("data", c => parts.push(c)); req.on("end", () => res(Buffer.concat(parts))); });

function cors(req) {
  const origin = req.headers.origin || "", allowed = new Set([cfg.dashboardOrigin, "http://localhost:8789", "http://127.0.0.1:8789"].filter(Boolean));
  return { "access-control-allow-origin": allowed.has(origin) ? origin : cfg.dashboardOrigin, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type", "access-control-allow-private-network": "true", vary: "Origin" };
}
function send(req, res, status, data) { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors(req) }); res.end(JSON.stringify(data)); }
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors(req)); res.end(); return; }
  const u = new URL(req.url, "http://127.0.0.1"), since = u.searchParams.get("since"), until = u.searchParams.get("until");
  try {
    if (req.method === "GET" && u.pathname === "/api/status") return send(req, res, 200, { ok: true, syncing, dbPath, dbBytes: fs.statSync(dbPath).size, coverage: coverage(), crm: await crmStoreStatus(local), lastResult });
    if ((u.pathname === "/api/history" || u.pathname === "/api/cache") && (!since || !until)) return send(req, res, 400, { error: "Informe since e until." });
    if (req.method === "GET" && u.pathname === "/api/history") return send(req, res, 200, { metaDaily: metaHistory(since, until), crmDaily: await crmDailyFromStore(local, since, until), since, until, scope: "referencia-capital", source: "arquivo-local", coverage: coverage() });
    if (req.method === "GET" && u.pathname === "/api/cache") {
      const ads = metaAds(since, until), ids = [...new Set(ads.map(a => String(a.ad_id)))];
      return send(req, res, 200, { ads, daily: metaDaily(since, until), creatives: creatives(ids), crm: await crmFromStore(local, since, until), cachedAccounts: new Set(ads.map(a => a.account_id)).size, totalAccounts: null, lastUpdated: stateVal("last_successful_sync"), source: "arquivo-local" });
    }
    if (u.pathname.startsWith("/api/rc/")) {
      const k = u.pathname.slice(8), p = u.searchParams;
      if (req.method === "GET" && k === "board") return send(req, res, 200, { ...RC.board(db, p.get("pipeline") || RC.SDR, { owner: p.get("owner") || "", limit: Number(p.get("limit") || 80) }), source: "pc" });
      if (req.method === "GET" && k === "deal") return send(req, res, 200, await RC.dealDetail(db, pipeBridge, p.get("id") || "", { fresh: p.get("fresh") === "1" }));
      if (req.method === "GET" && k === "ad-leads") return send(req, res, 200, await adLeads(async (sql, ...a) => db.prepare(sql).all(...a), { adId: p.get("ad_id"), since: p.get("since"), until: p.get("until"), kind: p.get("kind") }));
      if (req.method === "GET" && k === "comercial") return send(req, res, 200, { ...RC.comercial(db, p.get("day") || undefined), source: "pc" });
      if (req.method === "GET" && k === "alerts") return send(req, res, 200, { ...RC.alerts(db), source: "pc" });
      if (req.method === "GET" && k === "loss") return send(req, res, 200, { ...RC.lossReasons(db, p.get("since") || "2026-08-01"), source: "pc" });
      if (req.method === "POST" && k === "loss-real") { const b = JSON.parse((await readBody(req)).toString() || "{}"); RC.saveRealLoss(db, b.deal_id, b.reason, b.note); try { await workerJson("/api/archive/loss-real", { method: "POST", body: JSON.stringify(b) }); } catch (e) { log("Motivo real não foi para a nuvem:", e.message); } return send(req, res, 200, { ok: true }); }
      return send(req, res, 404, { error: "Rota não encontrada." });
    }
    if (req.method === "POST" && u.pathname === "/api/sync") return send(req, res, 200, await syncAll());
    if (req.method === "GET" && u.pathname === "/api/crm/sale") return send(req, res, 200, await saleJourney(local, u.searchParams.get("id") || ""));
    if (req.method === "POST" && u.pathname === "/api/sync-now") { syncAll(); return send(req, res, 200, { ok: true, message: "Sincronização iniciada no PC." }); }
    if (u.pathname.startsWith("/api/")) {
      const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
      const r = u.pathname.startsWith("/api/optimization/") ? await optimizationApi(req, u, body) : await proxyToWorker(req, u, body);
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/json; charset=utf-8", "cache-control": "no-store", ...cors(req) });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    return send(req, res, 404, { error: "Endpoint local não encontrado." });
  } catch (e) { return send(req, res, 500, { error: e.message }); }
});
const port = Number(cfg.port || 8789);
// Já existe uma instância rodando (ex.: iniciada pelo Windows): esta encerra sem mexer no banco.
server.on("error", e => { if (e.code === "EADDRINUSE") { log("Serviço já está rodando na porta", port); process.exit(0); } throw e; });
server.listen(port, "127.0.0.1", () => {
  log(`Arquivo local Referência Capital: http://127.0.0.1:${port}`);
  // Uma vez: rebaixar a estrutura (campanhas/conjuntos/anúncios) já com orçamento e link de destino.
  if (!stateVal("entities_budget_v2")) { for (const r of stmt("SELECT key FROM sync_state WHERE key LIKE 'meta_entities_%'").all()) stmt("DELETE FROM sync_state WHERE key=?").run(r.key); state.set("entities_budget_v2", true); }
  try { refreshBudgets(); } catch (e) { log("Orçamentos:", e.message); }
  // Uma vez: preenche extra_json dos negócios do Closer a partir do registro bruto já salvo.
  if (!stateVal("extra_json_v1")) {
    try {
      const rows = stmt(`SELECT d.id,e.payload_json p FROM crm_deal d JOIN archive_crm_entities e ON e.resource='deals' AND e.entity_id=d.id WHERE d.pipeline_id='84566' AND d.extra_json IS NULL`).all(), up = db.prepare("UPDATE crm_deal SET extra_json=? WHERE id=?");
      db.exec("BEGIN"); let n = 0;
      for (const r of rows) { try { const raw = typeof r.p === "string" ? r.p : zlib.inflateSync(r.p).toString(); up.run(dealExtra(JSON.parse(raw).customFields) || "", r.id); n++; } catch {} }
      db.exec("COMMIT"); state.set("extra_json_v1", true); log("Campos de venda preenchidos:", n);
    } catch (e) { try { db.exec("ROLLBACK"); } catch {} log("extra_json:", e.message); }
  }
  setTimeout(syncAll, 2000);
  setInterval(syncAll, Math.max(5, Number(cfg.syncMinutes || 15)) * 60000);
  setInterval(fastSync, 5 * 60000);
});
