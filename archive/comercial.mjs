// Visão comercial da Referência Capital (só leitura no PipeRun; o que é nosso fica no SQLite do PC).
// - Sincroniza histórico de etapas (stageHistories) e nomes dos motivos de perda.
// - Monta: quadro do CRM, ficha/linha do tempo do lead, aba Comercial (SDRs ao vivo) e alertas.
// - Gera um pacote único (snapshot) que o PC envia ao Cloudflare para o painel abrir na hora.

import { SDR, CLOSER, MEETING_STATUS, REAL_LOSS, brNow, minsBetween, normSource, buildDetail, stripHtml } from "../rc-shared.js";
export { SDR, CLOSER, MEETING_STATUS, REAL_LOSS, normSource };
const GESTORES = new Set(["86651"]); // Danilo (gestor comercial): fora dos rankings
const SLA_MIN = 15, STALE_DAYS = 7, ONLINE_MIN = 15;

export function ensureTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS crm_stage_history(id TEXT PRIMARY KEY, deal_id TEXT, in_stage_id TEXT, out_stage_id TEXT, in_user_id TEXT, out_user_id TEXT, in_date TEXT, out_date TEXT);
    CREATE INDEX IF NOT EXISTS ix_sh_deal ON crm_stage_history(deal_id, in_date);
    CREATE INDEX IF NOT EXISTS ix_sh_date ON crm_stage_history(in_date);
    CREATE TABLE IF NOT EXISTS crm_note(id TEXT PRIMARY KEY, deal_id TEXT, user_id TEXT, user_name TEXT, created_at TEXT, is_copy INTEGER, auto INTEGER, text TEXT);
    CREATE INDEX IF NOT EXISTS ix_note_deal ON crm_note(deal_id, created_at);
    CREATE INDEX IF NOT EXISTS ix_note_date ON crm_note(created_at);
    CREATE TABLE IF NOT EXISTS crm_call(id TEXT PRIMARY KEY, deal_id TEXT, user_id TEXT, created_at TEXT, start_at TEXT, duration INTEGER, is_copy INTEGER, record_url TEXT);
    CREATE INDEX IF NOT EXISTS ix_call_deal ON crm_call(deal_id, created_at);
    CREATE INDEX IF NOT EXISTS ix_call_date ON crm_call(created_at);
    CREATE TABLE IF NOT EXISTS rc_track(sid TEXT PRIMARY KEY, vid TEXT, host TEXT, path TEXT, url TEXT, ref TEXT, q_json TEXT, first_json TEXT, ad_id TEXT, utm_source TEXT, utm_campaign TEXT, utm_content TEXT, fbclid TEXT, ua TEXT, device TEXT, w INTEGER, h INTEGER, lang TEXT, ip TEXT, country TEXT, region TEXT, city TEXT, lat REAL, lon REAL, tz TEXT, started_at TEXT, last_at TEXT, dur INTEGER, scroll INTEGER, clicks_json TEXT, form INTEGER, email TEXT, phone TEXT, name TEXT, last_kind TEXT, deal_id TEXT);
    CREATE INDEX IF NOT EXISTS ix_rtrack_vid ON rc_track(vid);
    CREATE INDEX IF NOT EXISTS ix_rtrack_start ON rc_track(started_at);
    CREATE INDEX IF NOT EXISTS ix_rtrack_deal ON rc_track(deal_id);
    CREATE TABLE IF NOT EXISTS rc_deal_detail(deal_id TEXT PRIMARY KEY, json TEXT, fetched_at TEXT);
    CREATE TABLE IF NOT EXISTS rc_loss_real(deal_id TEXT PRIMARY KEY, reason TEXT, note TEXT, at TEXT);
    CREATE INDEX IF NOT EXISTS ix_deal_pipe_status ON crm_deal(pipeline_id, status, stage_id);
    CREATE INDEX IF NOT EXISTS ix_deal_owner ON crm_deal(owner_id, pipeline_id, status);`);
}

// ---------- Sincronização extra ----------
export async function syncExtras(db, pipeBridge, state, log) {
  const rows = j => Array.isArray(j?.data) ? j.data : [];
  // Motivos de perda (1x por dia)
  const lrAt = state.get("lost_reasons_at");
  if (!lrAt || Date.now() - new Date(JSON.parse(lrAt)).getTime() > 20 * 3600000) {
    const put = db.prepare(`INSERT INTO crm_ref(kind,id,name,extra_json,updated_at) VALUES('lostReason',?,?,'{}',?) ON CONFLICT(kind,id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`);
    let page = 1, n = 0; const now = new Date().toISOString();
    for (;;) { const j = await pipeBridge("lostReasons", { page, show: 200 }); for (const r of rows(j)) { put.run(String(r.id), String(r.name || ""), now); n++; } if (page >= Number(j?.meta?.total_pages || 1)) break; page++; }
    state.set("lost_reasons_at", now); log("Motivos de perda:", n);
  }
  // Histórico de etapas: reprocessa ontem e hoje; avança o histórico em até 6 dias por ciclo (desde 01/08).
  const put = db.prepare(`INSERT INTO crm_stage_history(id,deal_id,in_stage_id,out_stage_id,in_user_id,out_user_id,in_date,out_date) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET out_stage_id=excluded.out_stage_id,out_user_id=excluded.out_user_id,out_date=excluded.out_date`);
  const today = brNow().slice(0, 10), addDays = (s, n) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  let cursor = JSON.parse(state.get("sh_cursor") || '"2026-08-01"');
  const days = new Set([addDays(today, -1), today]);
  for (let i = 0; i < 15 && cursor < addDays(today, -1); i++) { days.add(cursor); cursor = addDays(cursor, 1); }
  let saved = 0;
  for (const day of [...days].sort()) {
    let page = 1;
    for (;;) {
      const j = await pipeBridge("stageHistories", { in_date_start: `${day} 00:00:00`, in_date_end: `${day} 23:59:59`, page, show: 200 });
      db.exec("BEGIN"); try { for (const r of rows(j)) { put.run(String(r.id), String(r.deal_id), String(r.in_stage_id ?? ""), String(r.out_stage_id ?? ""), String(r.in_user_id ?? ""), String(r.out_user_id ?? ""), String(r.in_date || ""), String(r.out_date || "")); saved++; } db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
      if (page >= Number(j?.meta?.total_pages || 1)) break; page++;
    }
  }
  state.set("sh_cursor", cursor);
  const notes = await syncByDay(db, pipeBridge, state, "notes", "2026-09-01", (r, put) => put.run(String(r.id), String(r.deal_id ?? ""), String(r.user_id ?? ""), String(r.user_name || ""), String(r.created_at || ""), r.flags?.its_a_copy ? 1 : 0, /Equipe TI|, IA$/.test(r.user_name || "") ? 1 : 0, stripHtml(r.text).slice(0, 4000)),
    `INSERT INTO crm_note(id,deal_id,user_id,user_name,created_at,is_copy,auto,text) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET text=excluded.text`);
  const calls = await syncByDay(db, pipeBridge, state, "calls", "2026-09-01", (r, put) => put.run(String(r.id), String(r.deal_id ?? ""), String(r.from_user_id || r.user_id || ""), String(r.created_at || ""), String(r.start_at || ""), Number(r.duration || 0), r.its_a_copy ? 1 : 0, String(r.record_url || "")),
    `INSERT INTO crm_call(id,deal_id,user_id,created_at,start_at,duration,is_copy,record_url) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET duration=excluded.duration,record_url=excluded.record_url,start_at=excluded.start_at`);
  return { stageHistory: saved, cursor, notes, calls };
}

// Puxa um recurso do PipeRun por dia de criação (ontem + hoje sempre; histórico avança 10 dias por ciclo).
async function syncByDay(db, pipeBridge, state, res, start, row, sql) {
  const put = db.prepare(sql), today = brNow().slice(0, 10), add = (s, n) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  let cursor = JSON.parse(state.get(`${res}_cursor`) || JSON.stringify(start)); const days = new Set([add(today, -1), today]);
  for (let i = 0; i < 10 && cursor < add(today, -1); i++) { days.add(cursor); cursor = add(cursor, 1); }
  let n = 0;
  for (const day of [...days].sort()) for (let page = 1; ; page++) {
    const j = await pipeBridge(res, { created_at_start: `${day} 00:00:00`, created_at_end: `${day} 23:59:59`, page, show: 200 }), rows = Array.isArray(j?.data) ? j.data : [];
    db.exec("BEGIN"); try { for (const r of rows) { row(r, put); n++; } db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
    if (page >= Number(j?.meta?.total_pages || 1)) break;
  }
  state.set(`${res}_cursor`, cursor); return n;
}

// ---------- Rastreador: traz as visitas do Cloudflare e liga ao lead do CRM ----------
export async function syncTrack(db, workerJson, state, log) {
  const cols = ["sid","vid","host","path","url","ref","q_json","first_json","ad_id","utm_source","utm_campaign","utm_content","fbclid","ua","device","w","h","lang","ip","country","region","city","lat","lon","tz","started_at","last_at","dur","scroll","clicks_json","form","email","phone","name","last_kind"];
  const put = db.prepare(`INSERT INTO rc_track(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")}) ON CONFLICT(sid) DO UPDATE SET ${cols.slice(1).map(c => `${c}=excluded.${c}`).join(",")}`);
  let since = JSON.parse(state.get("track_since") || '"2000-01-01 00:00:00"'), n = 0;
  for (let i = 0; i < 10; i++) {
    const j = await workerJson(`/api/archive/track?since=${encodeURIComponent(since)}${i === 0 ? "&purge=1" : ""}`), rows = j.rows || [];
    db.exec("BEGIN"); try { for (const x of rows) { put.run(...cols.map(c => x[c] ?? null)); n++; } db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
    if (rows.length) since = rows[rows.length - 1].last_at;
    if (rows.length < 2000) break;
  }
  state.set("track_since", since);
  // Liga visitante → lead: e-mail ou telefone digitado na página aparece na nota do formulário no PipeRun.
  const open = db.prepare(`SELECT sid,vid,email,phone,started_at FROM rc_track WHERE deal_id IS NULL AND (email<>'' OR phone<>'') AND started_at>=datetime('now','-3 hours','-10 day')`).all();
  const byEmail = db.prepare(`SELECT deal_id FROM crm_note WHERE created_at>=? AND text LIKE ? ORDER BY created_at LIMIT 1`), setDeal = db.prepare(`UPDATE rc_track SET deal_id=? WHERE vid=? AND deal_id IS NULL`);
  let linked = 0;
  for (const t of open) {
    const day = String(t.started_at).slice(0, 10), digits = String(t.phone || "").replace(/\D/g, "").slice(-8);
    const hit = (t.email && byEmail.get(`${day} 00:00:00`, `%${t.email}%`)) || (digits.length === 8 && byEmail.get(`${day} 00:00:00`, `%${digits}%`));
    if (hit?.deal_id) { setDeal.run(String(hit.deal_id), t.vid); linked++; }
  }
  if (n || linked) log("Visitas", JSON.stringify({ novas: n, ligadasALead: linked }));
  return { n, linked };
}

// ---------- Leituras ----------
function refs(db) {
  const m = k => new Map(db.prepare(`SELECT id,name,extra_json FROM crm_ref WHERE kind=?`).all(k).map(r => [String(r.id), { name: r.name, ...JSON.parse(r.extra_json || "{}") }]));
  return { stage: m("stage"), user: m("user"), lost: m("lostReason"), origin: m("origin") };
}
const firstStage = (R, pipe) => [...R.stage.entries()].filter(([, s]) => s.pipeline_id === pipe).sort((a, b) => a[1].order - b[1].order)[0]?.[0];

// Momento em que cada negócio entrou na etapa atual (último registro do histórico).
function stageSince(db, ids) {
  const out = new Map(); if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    for (const r of db.prepare(`SELECT deal_id,MAX(in_date) d FROM crm_stage_history WHERE deal_id IN (${part.map(() => "?").join(",")}) GROUP BY deal_id`).all(...part)) out.set(String(r.deal_id), r.d);
  }
  return out;
}

export function board(db, pipe = SDR, { owner = "", limit = 80 } = {}) {
  const R = refs(db), now = brNow();
  const stages = [...R.stage.entries()].filter(([, s]) => s.pipeline_id === pipe).sort((a, b) => a[1].order - b[1].order);
  const deals = db.prepare(`SELECT id,stage_id,owner_id,title,created_at,updated_at,value,utm_source,campaign_name,ad_name,noshow_count,extra_json FROM crm_deal WHERE pipeline_id=? AND status=0 AND deleted=0 ${owner ? "AND owner_id=?" : ""} AND created_day>=date('now','-120 day')`).all(...(owner ? [pipe, owner] : [pipe]));
  const since = stageSince(db, deals.map(d => String(d.id)));
  const cols = stages.map(([id, s]) => ({ id, name: s.name, count: 0, stale: 0, deals: [] })), byId = new Map(cols.map(c => [c.id, c]));
  for (const d of deals) {
    const c = byId.get(String(d.stage_id)); if (!c) continue;
    const inStage = since.get(String(d.id)) || d.created_at, ageMin = Math.max(0, Math.round(minsBetween(inStage, now)));
    c.count++; if (ageMin > STALE_DAYS * 1440) c.stale++;
    c.deals.push({ id: String(d.id), title: d.title, owner: R.user.get(String(d.owner_id))?.name || "—", ownerId: String(d.owner_id), createdAt: d.created_at, inStageAt: inStage, ageMin, value: d.value, source: normSource(d.utm_source), campaign: d.campaign_name, noshow: d.noshow_count });
  }
  // Novos: mais recentes primeiro (velocidade); demais etapas: mais parados primeiro.
  for (const c of cols) { c.deals.sort((a, b) => c === cols[0] ? a.ageMin - b.ageMin : b.ageMin - a.ageMin); c.deals = c.deals.slice(0, limit); }
  const owners = [...new Set(deals.map(d => String(d.owner_id)))].map(id => ({ id, name: R.user.get(id)?.name || id })).sort((a, b) => a.name.localeCompare(b.name));
  return { pipeline: pipe, at: now, columns: cols, owners, totalOpen: deals.length };
}


// Ficha do lead: dados + linha do tempo (etapas, formulário, notas, ligações, reuniões, perda).
export async function dealDetail(db, pipeBridge, id, { fresh = false } = {}) {
  const R = refs(db), d = db.prepare(`SELECT * FROM crm_deal WHERE id=?`).get(String(id));
  if (!d) return { error: "Negócio não encontrado no arquivo." };
  const cached = db.prepare(`SELECT json,fetched_at FROM rc_deal_detail WHERE deal_id=?`).get(String(id));
  let live = cached && !fresh && Date.now() - new Date(cached.fetched_at).getTime() < 10 * 60000 ? JSON.parse(cached.json) : null;
  if (!live) {
    const get = async r => { try { const j = await pipeBridge(r, { deal_id: id, show: 200 }); return (j.data || []).filter(x => String(x.deal_id) === String(id)); } catch (e) { return { error: e.message }; } };
    const [notes, history, calls] = await Promise.all([get("notes"), get("stageHistories"), get("calls")]);
    live = { notes, history, calls };
    db.prepare(`INSERT INTO rc_deal_detail(deal_id,json,fetched_at) VALUES(?,?,?) ON CONFLICT(deal_id) DO UPDATE SET json=excluded.json,fetched_at=excluded.fetched_at`).run(String(id), JSON.stringify(live), new Date().toISOString());
  }
  // Negócio irmão no outro funil (mesma pessoa)
  const related = d.person_id ? db.prepare(`SELECT id,pipeline_id,stage_id,status,owner_id,created_at,closed_at,lost_reason_id FROM crm_deal WHERE person_id=? AND id<>?`).all(d.person_id, d.id) : [];
  const meetings = db.prepare(`SELECT a.* FROM crm_activity a WHERE a.deal_id IN (${[d.id, ...related.map(r => r.id)].map(() => "?").join(",")}) ORDER BY start_at`).all(d.id, ...related.map(r => String(r.id)));
  const hist = Array.isArray(live.history) && live.history.length ? live.history : db.prepare(`SELECT * FROM crm_stage_history WHERE deal_id=?`).all(String(id));
  const real = db.prepare(`SELECT reason,note,at FROM rc_loss_real WHERE deal_id=?`).get(String(id)) || null;
  const det = buildDetail(d, R, { ...live, history: hist }, meetings, related, real, firstStage(R, d.pipeline_id));
  // Páginas visitadas (rastreador): todas as visitas do mesmo visitante ligado a este lead (ou ao negócio irmão).
  const ids = [String(d.id), ...related.map(x => String(x.id))];
  const vids = db.prepare(`SELECT DISTINCT vid FROM rc_track WHERE deal_id IN (${ids.map(() => "?").join(",")})`).all(...ids).map(x => x.vid);
  const visits = vids.length ? db.prepare(`SELECT host,path,url,ad_id,utm_source,utm_campaign,utm_content,device,country,region,city,started_at,dur,scroll,clicks_json,form FROM rc_track WHERE vid IN (${vids.map(() => "?").join(",")}) ORDER BY started_at`).all(...vids) : [];
  det.visits = visits.map(v => { let clicks = []; try { clicks = JSON.parse(v.clicks_json || "[]"); } catch {} return { at: v.started_at, page: (v.host || "") + (v.path || ""), url: v.url, ad: v.ad_id, source: normSource(v.utm_source), campaign: v.utm_campaign, device: v.device, place: [v.city, v.region, v.country].filter(Boolean).join(", "), dur: v.dur, scroll: v.scroll, clicks: clicks.length, clicked: clicks.map(c => c[3]).filter(Boolean).slice(0, 8), form: v.form }; });
  for (const v of det.visits) det.timeline.push({ at: v.at, kind: "visita", title: `Visitou ${v.page}`, text: [`${v.source}${v.ad ? " · anúncio " + v.ad : ""}`, `${v.device} · ${v.place}`, `${Math.round(v.dur / 60)} min ${v.dur % 60}s · rolou ${v.scroll}% · ${v.clicks} cliques${v.form === 2 ? " · ENVIOU o formulário" : v.form === 1 ? " · começou o formulário" : ""}`, v.clicked.length ? "Clicou em: " + v.clicked.join(", ") : ""].filter(Boolean).join("\n") });
  det.timeline.sort((x, y) => String(x.at).localeCompare(String(y.at)));
  return det;
}

export function saveRealLoss(db, dealId, reason, note) {
  db.prepare(`INSERT INTO rc_loss_real(deal_id,reason,note,at) VALUES(?,?,?,?) ON CONFLICT(deal_id) DO UPDATE SET reason=excluded.reason,note=excluded.note,at=excluded.at`).run(String(dealId), String(reason || ""), String(note || ""), brNow());
  return { ok: true };
}

// ---------- Comercial: time ao vivo ----------
export function comercial(db, day = brNow().slice(0, 10)) {
  const R = refs(db), now = brNow(), fs = firstStage(R, SDR);
  const leads = db.prepare(`SELECT id,owner_id,created_at,stage_id,status FROM crm_deal WHERE pipeline_id=? AND created_day=? AND deleted=0`).all(SDR, day);
  const ids = leads.map(l => String(l.id)), firstMove = new Map();
  for (let i = 0; i < ids.length; i += 500) { const part = ids.slice(i, i + 500); for (const r of db.prepare(`SELECT deal_id,MIN(in_date) d FROM crm_stage_history WHERE deal_id IN (${part.map(() => "?").join(",")}) AND in_stage_id<>? GROUP BY deal_id`).all(...part, fs)) firstMove.set(String(r.deal_id), r.d); }
  const mins = (sql, ...a) => { for (let i = 0; i < ids.length; i += 500) { const part = ids.slice(i, i + 500); for (const r of db.prepare(sql.replace('IDS', part.map(() => '?').join(','))).all(...part, ...a)) { const k = String(r.deal_id), cur = firstMove.get(k); if (r.d && (!cur || r.d < cur)) firstMove.set(k, r.d); } } };
  mins(`SELECT n.deal_id,MIN(n.created_at) d FROM crm_note n JOIN crm_deal x ON x.id=n.deal_id WHERE n.deal_id IN (IDS) AND n.auto=0 AND n.is_copy=0 AND n.created_at>x.created_at GROUP BY n.deal_id`);
  mins(`SELECT c.deal_id,MIN(c.created_at) d FROM crm_call c JOIN crm_deal x ON x.id=c.deal_id WHERE c.deal_id IN (IDS) AND c.is_copy=0 AND c.created_at>x.created_at GROUP BY c.deal_id`);
  const from = `${day} 00:00:00`, recent = db.prepare(`SELECT u,MAX(d) d,SUM(n) n FROM (SELECT in_user_id u,MAX(in_date) d,COUNT(*) n FROM crm_stage_history WHERE in_date>=? GROUP BY in_user_id UNION ALL SELECT user_id,MAX(created_at),COUNT(*) FROM crm_note WHERE created_at>=? AND auto=0 AND is_copy=0 GROUP BY user_id UNION ALL SELECT user_id,MAX(created_at),COUNT(*) FROM crm_call WHERE created_at>=? AND is_copy=0 GROUP BY user_id) GROUP BY u`).all(from, from, from);
  const lastAct = new Map(recent.map(r => [String(r.u), r])), sdr = new Map(), hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, leads: 0, contacted: 0, sumMin: 0 }));
  const row = id => { if (!sdr.has(id)) { const la = lastAct.get(id); sdr.set(id, { id, name: R.user.get(id)?.name || id, gestor: GESTORES.has(id), received: 0, contacted: 0, waiting: 0, slaOk: 0, sumMin: 0, moves: la?.n || 0, lastAt: la?.d || null, online: la ? minsBetween(la.d, now) <= ONLINE_MIN : false, waitingList: [] }); } return sdr.get(id); };
  for (const l of leads) {
    const s = row(String(l.owner_id)), h = hourly[Number(String(l.created_at).slice(11, 13)) || 0], fm = firstMove.get(String(l.id));
    s.received++; h.leads++;
    if (fm) { const m = Math.max(0, minsBetween(l.created_at, fm)); s.contacted++; s.sumMin += m; if (m <= SLA_MIN) s.slaOk++; h.contacted++; h.sumMin += m; }
    else if (l.status === 0 && String(l.stage_id) === String(fs)) { s.waiting++; s.waitingList.push({ id: String(l.id), since: l.created_at, min: Math.round(minsBetween(l.created_at, now)) }); }
  }
  for (const [id] of lastAct) if (R.user.has(id)) row(id); // quem trabalhou hoje, mesmo sem lead novo
  // Só SDRs de verdade: donos de leads do funil SDR nos últimos 30 dias, sem automações (Equipe TI / IA).
  const sdrOwners = new Set(db.prepare(`SELECT DISTINCT owner_id FROM crm_deal WHERE pipeline_id=? AND created_day>=date(?, '-30 day')`).all(SDR, day).map(r => String(r.owner_id)));
  const isBot = n => /Equipe TI|, IA$|^Alice Cruz$|^J[uú]lia Cruz/i.test(n || "");
  const sdrs = [...sdr.values()].filter(s => (s.received || s.moves) && sdrOwners.has(s.id) && !isBot(s.name)).map(s => ({ ...s, avgMin: s.contacted ? Math.round(s.sumMin / s.contacted) : null, slaPct: s.contacted ? Math.round(s.slaOk / s.received * 100) : 0, waitingList: s.waitingList.sort((a, b) => b.min - a.min).slice(0, 20) })).sort((a, b) => b.received - a.received);
  // Closers: reuniões de hoje por status e vendas do mês
  const meet = db.prepare(`SELECT owner_id,kind,status,COUNT(*) n FROM crm_activity WHERE start_day=? GROUP BY owner_id,kind,status`).all(day);
  const month = day.slice(0, 7), wins = db.prepare(`SELECT owner_id,COUNT(*) n,SUM(value) v FROM crm_deal WHERE pipeline_id=? AND status=1 AND substr(closed_day,1,7)=? GROUP BY owner_id`).all(CLOSER, month);
  const cl = new Map(), crow = id => { if (!cl.has(id)) cl.set(id, { id, name: R.user.get(id)?.name || id, gestor: GESTORES.has(id), m1: {}, m2: {}, winsMonth: 0, revenueMonth: 0 }); return cl.get(id); };
  for (const m of meet) { const c = crow(String(m.owner_id)), lbl = MEETING_STATUS[m.status] || `Status ${m.status}`; c[m.kind === "m2" ? "m2" : "m1"][lbl] = (c[m.kind === "m2" ? "m2" : "m1"][lbl] || 0) + m.n; }
  for (const w of wins) { const c = crow(String(w.owner_id)); c.winsMonth = w.n; c.revenueMonth = w.v || 0; }
  const tot = sdrs.reduce((a, s) => ({ received: a.received + s.received, contacted: a.contacted + s.contacted, sumMin: a.sumMin + s.sumMin, waiting: a.waiting + s.waiting, slaOk: a.slaOk + s.slaOk }), { received: 0, contacted: 0, sumMin: 0, waiting: 0, slaOk: 0 });
  return {
    day, at: now, slaMin: SLA_MIN, onlineMin: ONLINE_MIN,
    totals: { ...tot, avgMin: tot.contacted ? Math.round(tot.sumMin / tot.contacted) : null, slaPct: tot.received ? Math.round(tot.slaOk / tot.received * 100) : 0, online: sdrs.filter(s => s.online && !s.gestor).length },
    sdrs, hourly: hourly.map(h => ({ hour: h.hour, leads: h.leads, contacted: h.contacted, avgMin: h.contacted ? Math.round(h.sumMin / h.contacted) : null })),
    closers: [...cl.values()].sort((a, b) => b.winsMonth - a.winsMonth)
  };
}

// ---------- Alertas ----------
export function alerts(db) {
  const R = refs(db), now = brNow(), fs = firstStage(R, SDR), today = now.slice(0, 10);
  const novos = db.prepare(`SELECT id,owner_id,created_at,title FROM crm_deal WHERE pipeline_id=? AND status=0 AND deleted=0 AND stage_id=? AND created_day>=date('now','-60 day')`).all(SDR, fs)
    .map(d => ({ id: String(d.id), title: d.title, owner: R.user.get(String(d.owner_id))?.name || "—", createdAt: d.created_at, min: Math.round(minsBetween(d.created_at, now)) })).filter(d => d.min > SLA_MIN).sort((a, b) => a.min - b.min);
  const open = db.prepare(`SELECT id,pipeline_id,owner_id,updated_at FROM crm_deal WHERE status=0 AND deleted=0 AND pipeline_id IN (?,?) AND created_day>=date('now','-120 day')`).all(SDR, CLOSER);
  const since = stageSince(db, open.map(d => String(d.id))), stale = new Map();
  for (const d of open) { const ref = since.get(String(d.id)) || d.updated_at; if (minsBetween(ref, now) > STALE_DAYS * 1440) { const k = `${d.pipeline_id}|${d.owner_id}`; stale.set(k, (stale.get(k) || 0) + 1); } }
  const staleByOwner = [...stale.entries()].map(([k, n]) => { const [p, o] = k.split("|"); return { pipeline: p === SDR ? "SDR" : "Closers", owner: R.user.get(o)?.name || o, count: n }; }).sort((a, b) => b.count - a.count);
  const meetingsToday = db.prepare(`SELECT kind,status,COUNT(*) n FROM crm_activity WHERE start_day=? GROUP BY kind,status`).all(today).map(r => ({ kind: r.kind === "m2" ? "2ª reunião" : "1ª reunião", status: MEETING_STATUS[r.status] || `Status ${r.status}`, count: r.n }));
  return { at: now, slaMin: SLA_MIN, novosAtrasados: { count: novos.length, today: novos.filter(n => n.createdAt.startsWith(today)).length, list: novos.slice(0, 50) }, parados: { days: STALE_DAYS, total: staleByOwner.reduce((a, b) => a + b.count, 0), byOwner: staleByOwner }, reunioesHoje: meetingsToday };
}

// Motivos de perda com nome (para análise e para o quadro)
export function lossReasons(db, since) {
  const R = refs(db), q = p => db.prepare(`SELECT lost_reason_id r,COUNT(*) n FROM crm_deal WHERE pipeline_id=? AND status=3 AND created_day>=? GROUP BY r ORDER BY n DESC LIMIT 15`).all(p, since).map(x => ({ reason: R.lost.get(String(x.r))?.name || `Código ${x.r}`, count: x.n }));
  return { since, sdr: q(SDR), closers: q(CLOSER), real: db.prepare(`SELECT reason,COUNT(*) n FROM rc_loss_real GROUP BY reason ORDER BY n DESC`).all() };
}

export function snapshot(db) {
  const since = brNow().slice(0, 8) + "01";
  return { at: new Date().toISOString(), board: { [SDR]: board(db, SDR, { limit: 40 }), [CLOSER]: board(db, CLOSER, { limit: 40 }) }, comercial: comercial(db), alerts: alerts(db), loss: lossReasons(db, since) };
}
