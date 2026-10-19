// Cópia incremental do PipeRun no D1 e leitura do funil comercial a partir dela.
// Pipelines oficiais: 78790 = Prospecção - Consórcio (SDR), 84566 = Vendas - Consórcio (Closers).
// O plano gratuito do Cloudflare limita chamadas externas por execução, então a cópia anda
// em passos pequenos (fila persistida em sync_state) e as telas leem somente do D1.
export const SDR_PIPELINE = '78790', CLOSER_PIPELINE = '84566';
const MEETING_KINDS = { '1ª Reunião': 'm1', '2ª Reunião': 'm2' };
const DEAL_FIELDS = {
  ad_id: 'ID do anúncio', adset_id: 'ID do conjunto de anúncio', campaign_id: 'ID da campanha',
  meta_account: 'META Conta de Anúncio', meta_lead_id: 'Lead ID', utm_source: 'UTM source',
  utm_medium: 'UTM Medium', utm_campaign: 'UTM Campaign', utm_content: 'UTM Content',
  page: 'Página', utm_url: 'UTM URL', ad_name: 'Nome de Anúncio', campaign_name: 'Nome da campanha',
  lead_date: 'Data de cadastro', sdr_scheduled: 'SDR Agendou no dia', first_meeting: 'Data da 1º reunião',
  noshow_count: 'Quantidade de no-show'
};
const FIELD_KEYS = Object.fromEntries(Object.entries(DEAL_FIELDS).map(([k, v]) => [v, k]));
// Campos de venda/perfil (sem dados pessoais) guardados em extra_json para o card de Venda.
const EXTRA_FIELDS = {
  venda_valor: ['Valor da Venda'], carta: ['Valor da carta'], cashback: ['Teve Cashback?'], pais: ['País Correto', 'País'],
  idade: ['Idade do cliente'], profissao: ['Qual a profissão do cliente?'], renda: ['Renda mensal em reais (R$)', 'Renda mensal'],
  parcela: ['Valor da parcela desejada'], entrada: ['O cliente tem valor de entrada disponível?'], urgencia: ['O cliente tem urgência para ser contemplado?'],
  objetivo: ['O interesse do cliente em investir é para moradia ou alugar?'], temperatura: ['Temperatura'], objecoes: ['Objeções apresentadadas pelo cliente'],
  objecoes_ok: ['Essas objeções foram contornadas com sucesso?'], canal: ['Por qual canal a qualificação foi realizada?'], ticket: ['O ticket foi mantido, aumentado ou reduzido?'],
  hunter: ['Hunter'], origem_inicial: ['Origem Inicial'], sub_origem: ['Sub Origem'], venda_1a: ['A venda foi feita em 1º Reunião?']
};
const EXTRA_LABELS = { imovel_para_investir: 'Imóvel para renda passiva', imovel_para_morar: 'Imóvel para morar' };
function fieldText(c) {
  let v = c?.value;
  if (Array.isArray(v)) v = v.map(x => (typeof x === 'object' ? x?.name || x?.value || '' : x)).filter(Boolean).join(', ');
  if (v === null || v === undefined || v === '') { v = c?.raw_value; if (typeof v === 'string' && /^\[.*\]$/.test(v)) v = ''; }
  v = str(v);
  return EXTRA_LABELS[v] || v.replace(/_/g, ' ');
}
export function dealExtra(customFields) {
  const byName = new Map();
  for (const c of customFields || []) { const t = fieldText(c); if (t && !byName.has(c?.name)) byName.set(c.name, t.slice(0, 160)); }
  const out = {};
  for (const [k, names] of Object.entries(EXTRA_FIELDS)) for (const nm of names) if (byName.has(nm)) { out[k] = byName.get(nm); break; }
  return Object.keys(out).length ? JSON.stringify(out) : '';
}

const dayOf = v => { const m = String(v || '').match(/\d{4}-\d{2}-\d{2}/); if (m) return m[0]; const b = String(v || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return b ? `${b[3]}-${b[2]}-${b[1]}` : ''; };
const str = v => v === null || v === undefined ? '' : String(v).trim();
function brDateTime(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
const brDay = (offset = 0) => brDateTime(new Date(Date.now() + offset * 86400000)).slice(0, 10);

async function pipeGet(path, params, token) {
  const u = new URL(`https://api.pipe.run/v1/${path}`);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: { accept: 'application/json', token } }), j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`PipeRun ${path}: ${j?.message || j?.error || `HTTP ${r.status}`}`);
  return j;
}
// token (string) → chama o PipeRun direto (Worker); função (path, params) → fonte alternativa (PC via ponte do Worker).
const getter = t => typeof t === 'function' ? t : (p, q) => pipeGet(p, q, t);
const rowsOf = j => Array.isArray(j?.data) ? j.data : Array.isArray(j?.data?.data) ? j.data.data : [];

async function getState(env, key, fallback) { const r = await env.DB.prepare(`SELECT value FROM sync_state WHERE key=?`).bind(key).first(); if (!r) return fallback; try { return JSON.parse(r.value); } catch { return r.value; } }
async function setState(env, key, value) { await env.DB.prepare(`INSERT INTO sync_state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(key, JSON.stringify(value), new Date().toISOString()).run(); }

function dealRow(d, now) {
  const f = {};
  for (const c of d.customFields || []) { const k = FIELD_KEYS[c?.name]; if (k) f[k] = str(c.raw_value ?? c.value); }
  const createdAt = str(d.created_at), closedAt = str(d.closed_at);
  return [
    str(d.id), str(d.pipeline_id), str(d.stage_id), str(d.started_in_stage_id), Number(d.status || 0), str(d.owner_id), str(d.person_id), str(d.origin_id), str(d.lost_reason_id),
    Number(d.value || 0), str(d.title).slice(0, 200), createdAt, dayOf(createdAt), dayOf(f.lead_date) || dayOf(createdAt), closedAt, dayOf(closedAt), str(d.updated_at),
    f.ad_id || '', f.adset_id || '', f.campaign_id || '', f.meta_account || '', f.meta_lead_id || '', f.utm_source || '', f.utm_medium || '', f.utm_campaign || '', f.utm_content || '',
    f.page || f.utm_url || '', f.ad_name || '', f.campaign_name || '', dayOf(f.sdr_scheduled), dayOf(f.first_meeting), Number(f.noshow_count || 0) || 0, d.deleted ? 1 : 0, now, dealExtra(d.customFields)
  ];
}
const DEAL_SQL = `INSERT INTO crm_deal(id,pipeline_id,stage_id,started_in_stage_id,status,owner_id,person_id,origin_id,lost_reason_id,value,title,created_at,created_day,lead_day,closed_at,closed_day,updated_at,ad_id,adset_id,campaign_id,meta_account,meta_lead_id,utm_source,utm_medium,utm_campaign,utm_content,page_url,ad_name,campaign_name,sdr_scheduled_day,first_meeting_day,noshow_count,deleted,synced_at,extra_json)
VALUES(${Array(35).fill('?').join(',')})
ON CONFLICT(id) DO UPDATE SET pipeline_id=excluded.pipeline_id,stage_id=excluded.stage_id,started_in_stage_id=excluded.started_in_stage_id,status=excluded.status,owner_id=excluded.owner_id,person_id=excluded.person_id,origin_id=excluded.origin_id,lost_reason_id=excluded.lost_reason_id,value=excluded.value,title=excluded.title,created_at=excluded.created_at,created_day=excluded.created_day,lead_day=excluded.lead_day,closed_at=excluded.closed_at,closed_day=excluded.closed_day,updated_at=excluded.updated_at,ad_id=excluded.ad_id,adset_id=excluded.adset_id,campaign_id=excluded.campaign_id,meta_account=excluded.meta_account,meta_lead_id=excluded.meta_lead_id,utm_source=excluded.utm_source,utm_medium=excluded.utm_medium,utm_campaign=excluded.utm_campaign,utm_content=excluded.utm_content,page_url=excluded.page_url,ad_name=excluded.ad_name,campaign_name=excluded.campaign_name,sdr_scheduled_day=excluded.sdr_scheduled_day,first_meeting_day=excluded.first_meeting_day,noshow_count=excluded.noshow_count,deleted=excluded.deleted,synced_at=excluded.synced_at,extra_json=excluded.extra_json
WHERE crm_deal.extra_json IS NULL OR crm_deal.updated_at IS NOT excluded.updated_at OR crm_deal.status IS NOT excluded.status OR crm_deal.stage_id IS NOT excluded.stage_id OR crm_deal.pipeline_id IS NOT excluded.pipeline_id`;
const ACT_SQL = `INSERT INTO crm_activity(id,deal_id,kind,activity_type_id,status,owner_id,start_at,start_day,updated_at,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET deal_id=excluded.deal_id,kind=excluded.kind,activity_type_id=excluded.activity_type_id,status=excluded.status,owner_id=excluded.owner_id,start_at=excluded.start_at,start_day=excluded.start_day,updated_at=excluded.updated_at,synced_at=excluded.synced_at
WHERE crm_activity.updated_at IS NOT excluded.updated_at OR crm_activity.status IS NOT excluded.status OR crm_activity.start_at IS NOT excluded.start_at`;

async function saveDeals(env, rows) {
  const now = new Date().toISOString(), ok = rows.filter(d => [SDR_PIPELINE, CLOSER_PIPELINE].includes(str(d.pipeline_id)));
  if (ok.length) await env.DB.batch(ok.map(d => env.DB.prepare(DEAL_SQL).bind(...dealRow(d, now))));
  return ok.length;
}
async function saveActivities(env, rows, kind) {
  const now = new Date().toISOString();
  if (rows.length) await env.DB.batch(rows.map(a => env.DB.prepare(ACT_SQL).bind(str(a.id), str(a.deal_id), kind, str(a.activity_type_id), Number(a.status || 0), str(a.owner_id), str(a.start_at), dayOf(a.start_at), str(a.updated_at), now)));
  return rows.length;
}
async function syncRefs(env, token) {
  const now = new Date().toISOString(), stmts = [], put = (kind, id, name, extra) => stmts.push(env.DB.prepare(`INSERT INTO crm_ref(kind,id,name,extra_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET name=excluded.name,extra_json=excluded.extra_json,updated_at=excluded.updated_at`).bind(kind, str(id), str(name), JSON.stringify(extra || {}), now));
  let pages = 0;
  const get = getter(token);
  const all = async (path, params) => { let page = 1, out = []; while (page <= 5) { const j = await get(path, { show: 200, page, ...params }); pages++; out.push(...rowsOf(j)); if (page >= Number(j?.meta?.total_pages || 1)) break; page++; } return out; };
  for (const p of [SDR_PIPELINE, CLOSER_PIPELINE]) for (const s of await all('stages', { pipeline_id: p })) put('stage', s.id, s.name, { pipeline_id: str(s.pipeline_id), order: Number(s.order || 0) });
  for (const t of await all('activityTypes', {})) { const kind = MEETING_KINDS[str(t.name)]; if (kind) put('activityType', t.id, t.name, { kind }); }
  for (const u of await all('users', {})) put('user', u.id, u.name || u.email, {});
  for (const o of await all('origins', {})) put('origin', o.id, o.name, {});
  for (let i = 0; i < stmts.length; i += 100) await env.DB.batch(stmts.slice(i, i + 100));
  await setState(env, 'crm_refs_at', now);
  return pages;
}
async function meetingTypes(env) {
  const r = (await env.DB.prepare(`SELECT id,extra_json FROM crm_ref WHERE kind='activityType'`).all()).results || [];
  return r.map(x => ({ id: x.id, kind: JSON.parse(x.extra_json || '{}').kind })).filter(x => x.kind);
}

// Fila de trabalho: cada item é uma consulta paginada ao PipeRun.
export async function enqueueCrmBackfill(env, token, since, until, { reset = false } = {}) {
  if (!(await meetingTypes(env)).length) await syncRefs(env, token);
  const queue = reset ? [] : await getState(env, 'crm_queue', []), types = await meetingTypes(env);
  const add = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  for (let a = since; a <= until; a = add(a, 15)) {
    const b = add(a, 14) < until ? add(a, 14) : until, range = { start: `${a} 00:00:00`, end: `${b} 23:59:59` };
    for (const p of [SDR_PIPELINE, CLOSER_PIPELINE]) queue.push({ res: 'deals', params: { pipeline_id: p, created_at_start: range.start, created_at_end: range.end }, page: 1 });
    queue.push({ res: 'deals', params: { pipeline_id: CLOSER_PIPELINE, status: 1, closed_at_start: range.start, closed_at_end: range.end }, page: 1 });
    for (const t of types) queue.push({ res: 'activities', kind: t.kind, params: { activity_type_id: t.id, start_at_start: range.start, start_at_end: range.end }, page: 1 });
  }
  await setState(env, 'crm_queue', queue);
  return queue.length;
}

export async function crmSyncStep(env, token, maxPages = 18, opts = {}) {
  let queue = await getState(env, 'crm_queue', []), pages = 0, saved = 0;
  const refsAt = await getState(env, 'crm_refs_at', null);
  if (!refsAt || Date.now() - new Date(refsAt).getTime() > 20 * 3600000) pages += await syncRefs(env, token);
  if (!queue.length) {
    const last = await getState(env, 'crm_incremental_at', null), from = new Date((last ? new Date(last).getTime() : Date.now() - 3 * 86400000) - 4 * 3600000), types = await meetingTypes(env);
    const f = brDateTime(from), t = brDateTime(new Date(Date.now() + 3600000));
    for (const p of [SDR_PIPELINE, CLOSER_PIPELINE]) queue.push({ res: 'deals', params: { pipeline_id: p, updated_at_start: f, updated_at_end: t }, page: 1 });
    for (const x of types) queue.push({ res: 'activities', kind: x.kind, params: { activity_type_id: x.id, start_at_start: `${brDay(-7)} 00:00:00`, start_at_end: `${brDay(14)} 23:59:59` }, page: 1 });
    queue.push({ res: 'mark', at: new Date().toISOString() });
  }
  try {
    while (queue.length && pages < maxPages) {
      const job = queue[0];
      if (job.res === 'mark') { await setState(env, 'crm_incremental_at', job.at); queue.shift(); continue; }
      const j = await getter(token)(job.res, { ...job.params, show: 200, page: job.page, ...(job.res === 'deals' ? { with: 'customFields' } : {}) }), rows = rowsOf(j);
      if (opts.onRows) await opts.onRows(job, rows);
      pages++;
      saved += job.res === 'deals' ? await saveDeals(env, rows) : await saveActivities(env, rows, job.kind);
      const cur = Number(j?.meta?.current_page || job.page), total = Number(j?.meta?.total_pages || 1);
      if (rows.length && cur < total) job.page = cur + 1; else queue.shift();
    }
  } finally { await setState(env, 'crm_queue', queue); }
  return { pages, saved, pending: queue.length, next: queue[0] ? { res: queue[0].res, page: queue[0].page, params: queue[0].params } : null };
}

// ---------- Leitura do funil a partir do D1 ----------
async function refMap(env, kind) { const r = (await env.DB.prepare(`SELECT id,name,extra_json FROM crm_ref WHERE kind=?`).bind(kind).all()).results || []; return new Map(r.map(x => [String(x.id), { name: x.name, ...JSON.parse(x.extra_json || '{}') }])); }

export async function crmDailyFromStore(env, since, until) {
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results || []), map = {};
  const row = d => (map[d] ||= { day: d, opportunities: 0, metaLeads: 0, appointments: 0, meetings: 0, noShows: 0, meeting2: 0, wins: 0, revenue: 0 });
  for (const r of await q(`SELECT created_day d,COUNT(*) n,SUM(CASE WHEN ad_id<>'' THEN 1 ELSE 0 END) m FROM crm_deal WHERE deleted=0 AND pipeline_id=? AND created_day BETWEEN ? AND ? GROUP BY created_day`, SDR_PIPELINE, since, until)) { row(r.d).opportunities = r.n; row(r.d).metaLeads = r.m; }
  for (const r of await q(`SELECT created_day d,COUNT(*) n FROM crm_deal WHERE deleted=0 AND pipeline_id=? AND created_day BETWEEN ? AND ? GROUP BY created_day`, CLOSER_PIPELINE, since, until)) row(r.d).appointments = r.n;
  for (const r of await q(`SELECT closed_day d,COUNT(*) n,SUM(value) v FROM crm_deal WHERE deleted=0 AND pipeline_id=? AND status=1 AND closed_day BETWEEN ? AND ? GROUP BY closed_day`, CLOSER_PIPELINE, since, until)) { row(r.d).wins = r.n; row(r.d).revenue = r.v || 0; }
  for (const r of await q(`SELECT start_day d,kind,status,COUNT(*) n FROM crm_activity WHERE start_day BETWEEN ? AND ? GROUP BY start_day,kind,status`, since, until)) {
    if (r.kind === 'm1' && Number(r.status) === 2) row(r.d).meetings += r.n;
    if (r.kind === 'm1' && Number(r.status) === 4) row(r.d).noShows += r.n;
    if (r.kind === 'm2' && Number(r.status) === 2) row(r.d).meeting2 += r.n;
  }
  return Object.values(map).sort((a, b) => a.day.localeCompare(b.day)).map(r => ({ ...r, no_shows: r.noShows }));
}

// Mesmo formato que o antigo syncPipeRun (summary, owners, adStats, daily, auditLeads...).
// light=true (aba Otimização): pula a lista de leads da auditoria, que é a parte mais pesada.
export async function crmFromStore(env, since, until, { light = false } = {}) {
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results || []);
  const [users, stages, origins] = await Promise.all([refMap(env, 'user'), refMap(env, 'stage'), refMap(env, 'origin')]);
  const sdr = await q(light ? `SELECT id,owner_id,ad_id,meta_lead_id FROM crm_deal WHERE deleted=0 AND pipeline_id=? AND created_day BETWEEN ? AND ?` : `SELECT * FROM crm_deal WHERE deleted=0 AND pipeline_id=? AND created_day BETWEEN ? AND ?`, SDR_PIPELINE, since, until);
  const closerNew = await q(`SELECT id,person_id,owner_id,ad_id,created_day FROM crm_deal WHERE deleted=0 AND pipeline_id=? AND created_day BETWEEN ? AND ?`, CLOSER_PIPELINE, since, until);
  const won = await q(`SELECT id,person_id,owner_id,ad_id,value,closed_day,created_day,ad_name,campaign_name,page_url,origin_id,extra_json FROM crm_deal WHERE deleted=0 AND pipeline_id=? AND status=1 AND closed_day BETWEEN ? AND ?`, CLOSER_PIPELINE, since, until);
  const acts = await q(`SELECT a.id,a.kind,a.status,a.owner_id,a.start_day,a.deal_id,d.person_id,d.ad_id FROM crm_activity a LEFT JOIN crm_deal d ON d.id=a.deal_id WHERE a.start_day BETWEEN ? AND ?`, since, until);
  // Anúncio de origem por pessoa (negócio SDR mais recente com ID do anúncio).
  // Por pessoa: anúncio de origem e SDR dono do lead (negócio mais recente no 78790).
  const persons = [...new Set([...closerNew, ...won, ...acts].map(x => String(x.person_id || '')).filter(Boolean))], personAd = new Map(), personSdr = new Map(), personFirst = new Map();
  for (let i = 0; i < persons.length; i += 90) {
    const part = persons.slice(i, i + 90);
    for (const r of await q(`SELECT person_id,ad_id,owner_id,created_day FROM crm_deal WHERE pipeline_id=? AND person_id IN (${part.map(() => '?').join(',')}) ORDER BY created_at`, SDR_PIPELINE, ...part)) {
      if (r.ad_id) personAd.set(String(r.person_id), String(r.ad_id));
      if (r.owner_id) personSdr.set(String(r.person_id), String(r.owner_id));
      if (r.created_day && !personFirst.has(String(r.person_id))) personFirst.set(String(r.person_id), r.created_day);
    }
  }
  const adOf = x => String(x.ad_id || '') || personAd.get(String(x.person_id || '')) || '';
  const owners = new Map(), ownerRow = id => { id = String(id || ''); if (!owners.has(id)) owners.set(id, { id, name: users.get(id)?.name || `Usuário ${id || 'sem ID'}`, email: '', opportunities: 0, appointments: 0, meetings: 0, noShows: 0, meeting2: 0, wins: 0, revenue: 0 }); return owners.get(id); };
  const adStats = {}, ownerAdStats = {}, add = (id, owner, patch) => {
    if (!id) return;
    const a = (adStats[id] ||= { opportunities: 0, appointments: 0, meetings: 0, noShows: 0, meeting2: 0, wins: 0, revenue: 0, attributed: true });
    const o = ((ownerAdStats[id] ||= {})[String(owner || '')] ||= { opportunities: 0, appointments: 0, meetings: 0, noShows: 0, meeting2: 0, wins: 0, revenue: 0 });
    for (const [k, v] of Object.entries(patch)) { a[k] += v; o[k] += v; }
  };
  let attributed = 0;
  for (const d of sdr) { ownerRow(d.owner_id).opportunities++; if (d.ad_id) { attributed++; add(d.ad_id, d.owner_id, { opportunities: 1 }); } }
  // Agendamento conta para o SDR que trabalhou o lead (não para o closer dono do negócio no 84566).
  for (const d of closerNew) { const sdrOwner = personSdr.get(String(d.person_id || '')) || ''; ownerRow(sdrOwner).appointments++; add(adOf(d), sdrOwner, { appointments: 1 }); }
  for (const a of acts) {
    const st = Number(a.status), key = a.kind === 'm1' ? (st === 2 ? 'meetings' : st === 4 ? 'noShows' : '') : (a.kind === 'm2' && st === 2 ? 'meeting2' : '');
    if (!key) continue; ownerRow(a.owner_id)[key]++; add(adOf(a), a.owner_id, { [key]: 1 });
  }
  for (const d of won) { const o = ownerRow(d.owner_id); o.wins++; o.revenue += Number(d.value || 0); add(adOf(d), d.owner_id, { wins: 1, revenue: Number(d.value || 0) }); }
  const daily = await crmDailyFromStore(env, since, until), sum = k => daily.reduce((t, r) => t + Number(r[k] || 0), 0);
  const auditLeads = light ? [] : sdr.map(d => ({
    name: d.title || `Lead ${d.id}`, email: '', phone: '', campaign: d.campaign_name || d.utm_campaign || '', stage: stages.get(String(d.stage_id))?.name || 'Sem etapa',
    // "Lead ID" do PipeRun é um ID interno (preenchido em todos): a origem Meta é o "ID do anúncio".
    meta: d.ad_id ? true : (/fb|facebook|meta/i.test(origins.get(String(d.origin_id))?.name || '') ? null : false), crm: true, origin: origins.get(String(d.origin_id))?.name || '', source: d.utm_source, medium: d.utm_medium, utmCampaign: d.utm_campaign, utmContent: d.utm_content,
    metaId: d.meta_lead_id || '', crmId: String(d.id), createdAt: d.created_at, match: d.ad_id ? 'ID do anúncio no CRM' : 'sem ID do anúncio (origem não-Meta ou não rastreada)',
    crmUrl: `https://app.pipe.run/v2/pipeline/deal/${d.id}`, adIds: d.ad_id ? [d.ad_id] : [], pipelineId: String(d.pipeline_id), stageId: String(d.stage_id), page: d.page_url, adName: d.ad_name, status: Number(d.status)
  }));
  // Vendas individuais (lista do card de Venda): ciclo lead → venda, 2ª reunião antes da venda e campos de perfil.
  let sales = [];
  if (!light && won.length) {
    const had2 = new Set();
    for (let i = 0; i < won.length; i += 90) { const part = won.slice(i, i + 90).map(d => String(d.id)); for (const r of await q(`SELECT DISTINCT deal_id FROM crm_activity WHERE kind='m2' AND status=2 AND deal_id IN (${part.map(() => '?').join(',')})`, ...part)) had2.add(String(r.deal_id)); }
    sales = won.map(d => { const first = personFirst.get(String(d.person_id || '')) || '', sdrId = personSdr.get(String(d.person_id || '')) || ''; let extra = {}; try { extra = d.extra_json ? JSON.parse(d.extra_json) : {}; } catch {}
      return { id: String(d.id), closed: d.closed_day, value: Number(d.value || 0), adId: adOf(d), adName: d.ad_name || '', campaign: d.campaign_name || '', page: d.page_url || '', closer: users.get(String(d.owner_id))?.name || '', origin: origins.get(String(d.origin_id))?.name || '', sdr: users.get(sdrId)?.name || '', cycle: first ? Math.max(0, Math.round((Date.parse(d.closed_day) - Date.parse(first)) / 864e5)) : null, m2: had2.has(String(d.id)), extra, crmUrl: `https://app.pipe.run/v2/pipeline/deal/${d.id}` }; })
      .sort((a, b) => String(b.closed).localeCompare(String(a.closed)));
  }
  const syncedAt = await getState(env, 'crm_incremental_at', null);
  return {
    summary: { opportunities: sdr.length, metaLeads: sum('metaLeads'), appointments: closerNew.length, meetingsCompleted: sum('meetings'), noShows: sum('noShows'), meeting2: sum('meeting2'), wonInPeriod: won.length, revenue: won.reduce((t, d) => t + Number(d.value || 0), 0), attributedAds: Object.keys(adStats).length, attributionCoverage: sdr.length ? 100 * attributed / sdr.length : 0 },
    meetingTypes: ['1ª Reunião', '2ª Reunião'], sales, owners: [...owners.values()].sort((a, b) => b.revenue - a.revenue || b.wins - a.wins || b.meetings - a.meetings), adStats, ownerAdStats, daily, auditLeads,
    meta: { scope: 'referencia-capital', source: 'd1', syncedAt, prospectionPipelineId: SDR_PIPELINE, closerPipelineId: CLOSER_PIPELINE, acquisitionDeals: sdr.length, wonDeals: won.length, activities: acts.length }
  };
}

export async function crmStoreStatus(env) {
  const one = sql => env.DB.prepare(sql).first();
  const deals = await env.DB.prepare(`SELECT pipeline_id,COUNT(*) n,MIN(created_day) a,MAX(created_day) b FROM crm_deal GROUP BY pipeline_id`).all();
  return { deals: deals.results || [], activities: (await one(`SELECT COUNT(*) n,MIN(start_day) a,MAX(start_day) b FROM crm_activity`)), queue: (await getState(env, 'crm_queue', [])).length, incrementalAt: await getState(env, 'crm_incremental_at', null), refsAt: await getState(env, 'crm_refs_at', null) };
}

// Jornada de um comprador: todas as entradas (negócios) da mesma pessoa, reuniões e desfechos.
export async function saleJourney(env, id) {
  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results || []);
  const d = await env.DB.prepare(`SELECT * FROM crm_deal WHERE id=?`).bind(String(id)).first();
  if (!d) return { error: 'Venda não encontrada no banco.' };
  const [users, stages, origins] = await Promise.all([refMap(env, 'user'), refMap(env, 'stage'), refMap(env, 'origin')]);
  const deals = d.person_id ? await q(`SELECT id,pipeline_id,stage_id,status,created_at,created_day,closed_at,closed_day,ad_id,ad_name,campaign_name,page_url,utm_source,utm_medium,utm_campaign,utm_content,origin_id,value,owner_id,sdr_scheduled_day,first_meeting_day FROM crm_deal WHERE person_id=? AND deleted=0 ORDER BY created_at`, String(d.person_id)) : [d];
  const ids = deals.map(x => String(x.id)), acts = ids.length ? await q(`SELECT id,deal_id,kind,status,start_at,owner_id FROM crm_activity WHERE deal_id IN (${ids.map(() => '?').join(',')}) ORDER BY start_at`, ...ids) : [];
  const name = uid => users.get(String(uid || ''))?.name || '';
  const events = [];
  for (const x of deals) {
    const sdr = String(x.pipeline_id) === SDR_PIPELINE;
    events.push({ at: x.created_at, kind: sdr ? 'entrada' : 'closer', title: sdr ? 'Entrou como lead' : 'Agendado com o Closer', page: x.page_url || '', ad: x.ad_name || x.ad_id || '', campaign: x.campaign_name || '', origin: origins.get(String(x.origin_id))?.name || '', utm: [x.utm_source, x.utm_medium, x.utm_campaign, x.utm_content].filter(Boolean).join(' · '), owner: name(x.owner_id), stage: stages.get(String(x.stage_id))?.name || '', dealId: String(x.id), url: `https://app.pipe.run/v2/pipeline/deal/${x.id}` });
    if (x.closed_at && Number(x.status) !== 0) events.push({ at: x.closed_at, kind: Number(x.status) === 1 ? 'ganho' : 'perdido', title: Number(x.status) === 1 ? (sdr ? 'Lead ganho no SDR' : 'Venda fechada') : (sdr ? 'Lead perdido no SDR' : 'Negócio perdido no Closer'), value: Number(x.value || 0), owner: name(x.owner_id), stage: stages.get(String(x.stage_id))?.name || '', dealId: String(x.id) });
  }
  const st = { 0: 'agendada', 2: 'realizada', 4: 'faltou (no-show)' };
  for (const a of acts) events.push({ at: a.start_at, kind: a.kind, title: `${a.kind === 'm1' ? '1ª' : '2ª'} reunião — ${st[Number(a.status)] || 'status ' + a.status}`, owner: name(a.owner_id), dealId: String(a.deal_id) });
  events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  let extra = {}; try { extra = d.extra_json ? JSON.parse(d.extra_json) : {}; } catch {}
  const first = deals.find(x => String(x.pipeline_id) === SDR_PIPELINE);
  const pages = [...new Set(deals.map(x => x.page_url).filter(Boolean))];
  return { sale: { id: String(d.id), value: Number(d.value || 0), closed: d.closed_day, closer: name(d.owner_id), stage: stages.get(String(d.stage_id))?.name || '', url: `https://app.pipe.run/v2/pipeline/deal/${d.id}` }, extra, entries: deals.filter(x => String(x.pipeline_id) === SDR_PIPELINE).length, pages, firstEntry: first?.created_day || null, cycle: first && d.closed_day ? Math.round((Date.parse(d.closed_day) - Date.parse(first.created_day)) / 864e5) : null, events };
}
