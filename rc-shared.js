// Código comum da visão comercial (usado pelo PC em archive/comercial.mjs e pelo Worker).
export const SDR = "78790", CLOSER = "84566";

// Status de reunião no PipeRun (activities.status)
export const MEETING_STATUS = { 0: "Pendente", 1: "Em andamento", 2: "Realizada", 3: "Cancelada", 4: "No-show" };

// Motivos reais (nossa camada): específicos, para substituir os genéricos do PipeRun.
export const REAL_LOSS = {
  SDR: ["Não atende após 5 tentativas", "Número inválido ou sem WhatsApp", "Não lembra do cadastro", "Só curiosidade", "Sem renda ou orçamento", "Quer financiamento, não consórcio", "Já tem consórcio", "Mora no Brasil (campanha exterior)", "Sem CPF / estrangeiro", "Lead duplicado"],
  CLOSER: ["No-show sem remarcação", "Achou a parcela alta", "Prazo de contemplação longo", "Desconfia do consórcio ou da empresa", "Precisa falar com o cônjuge", "Fechou com concorrente", "Sumiu depois da proposta", "Sem documentação", "Câmbio / momento financeiro", "Prefere investir no país onde mora"]
};

export function brNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
// Datas do PipeRun vêm em horário de Brasília (UTC-3).
export const toMs = s => { const m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 3, +m[5], +(m[6] || 0)) : NaN; };
export const minsBetween = (a, b) => (toMs(b) - toMs(a)) / 60000;
export const stripHtml = h => String(h || "").replace(/<li[^>]*>/gi, "\n• ").replace(/<(br|\/p|\/h\d|\/div)[^>]*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n").trim();

export function normSource(s) {
  let v = String(s || "").toLowerCase().trim();
  const inner = v.match(/utm_source=([a-z_.-]+)/); if (inner) v = inner[1];
  if (!v || v.includes("{handl") || v === "null") return "Sem origem";
  if (/^(fb|facebook|face)/.test(v)) return "Facebook";
  if (/^(ig|insta)/.test(v)) return "Instagram";
  if (v.includes("google")) return "Google";
  if (/referencia(da)?capital/.test(v)) return "Site";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

// Ficha do lead. d: linha no formato de crm_deal; R: {stage,user,lost} (Map id → {name,...});
// live: {notes,history,calls} do PipeRun; meetings: crm_activity; related: negócios da mesma pessoa.
export function buildDetail(d, R, live, meetings, related, real, firstStageId) {
  const ev = [], uname = u => R.user.get(String(u))?.name || (u ? `Usuário ${u}` : "Sistema");
  ev.push({ at: d.created_at, kind: "entrada", title: `Entrou no CRM (${R.stage.get(String(d.started_in_stage_id))?.name || "1ª etapa"})`, text: [d.campaign_name && `Campanha: ${d.campaign_name}`, d.ad_name && `Anúncio: ${d.ad_name}`, `Origem: ${normSource(d.utm_source)}`].filter(Boolean).join("\n") });
  const hist = Array.isArray(live.history) ? live.history : [];
  for (const h of hist) ev.push({ at: h.in_date, kind: "etapa", title: `Etapa: ${R.stage.get(String(h.in_stage_id))?.name || "outro funil"}`, text: uname(h.in_user_id) });
  let form = null;
  for (const n of Array.isArray(live.notes) ? live.notes : []) {
    const text = stripHtml(n.text);
    if (/RESPOSTAS|FORMS|FORMUL/i.test(n.text || "") && !form) { form = text; ev.push({ at: n.created_at, kind: "formulario", title: "Respostas do formulário", text }); continue; }
    if (/LEAD SEM IMAGEM/i.test(n.text || "")) continue;
    ev.push({ at: n.created_at, kind: "nota", title: `Nota de ${n.user_name || uname(n.user_id)}`, text, copy: !!(n.flags?.its_a_copy || n.its_a_copy), auto: /Equipe TI|, IA$/.test(n.user_name || "") });
  }
  for (const c of Array.isArray(live.calls) ? live.calls : []) ev.push({ at: c.start_at || c.created_at, kind: "ligacao", title: `Ligação ${c.to_number ? "para " + c.to_number : ""}`, text: [c.duration && `Duração: ${c.duration}s`, c.record_url && `Gravação: ${c.record_url}`].filter(Boolean).join("\n") });
  for (const m of meetings) ev.push({ at: m.start_at, kind: "reuniao", title: `${m.kind === "m2" ? "2ª" : "1ª"} reunião — ${MEETING_STATUS[m.status] || `status ${m.status}`}`, text: uname(m.owner_id) });
  for (const r of related) ev.push({ at: r.created_at, kind: "funil", title: `Passou para ${String(r.pipeline_id) === CLOSER ? "Closers" : "SDR"} (${R.stage.get(String(r.stage_id))?.name || ""})`, text: `Responsável: ${uname(r.owner_id)}${Number(r.status) === 1 ? " · VENDA" : Number(r.status) === 3 ? ` · Perdido: ${R.lost.get(String(r.lost_reason_id))?.name || r.lost_reason_id}` : ""}` });
  const status = Number(d.status);
  if (status === 1) ev.push({ at: d.closed_at, kind: "venda", title: "Venda", text: `Valor: R$ ${Number(d.value || 0).toLocaleString("pt-BR")}` });
  if (status === 3) ev.push({ at: d.closed_at || d.updated_at, kind: "perda", title: `Perdido: ${R.lost.get(String(d.lost_reason_id))?.name || "motivo " + d.lost_reason_id}`, text: "" });
  ev.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  // Tempo até o 1º contato: primeira saída da etapa de entrada (ou primeira nota de pessoa, não da IA).
  const after = t => String(t || "") > String(d.created_at || "");
  const firstMove = hist.filter(h => String(h.in_stage_id) !== String(firstStageId) && after(h.in_date)).map(h => h.in_date).sort()[0];
  const firstNote = ev.filter(e => e.kind === "nota" && !e.auto && !e.copy && after(e.at)).map(e => e.at).sort()[0];
  const fc = [firstMove, firstNote].filter(Boolean).sort()[0];
  let extra = {}; try { extra = JSON.parse(d.extra_json || "{}"); } catch {}
  return {
    deal: { id: String(d.id), title: d.title, pipeline: String(d.pipeline_id) === SDR ? "SDR" : "Closers", stage: R.stage.get(String(d.stage_id))?.name, owner: uname(d.owner_id), status: ["Aberto", "Venda", "?", "Perdido"][status] || status, value: d.value, createdAt: d.created_at, source: normSource(d.utm_source), campaign: d.campaign_name, ad: d.ad_name, page: d.page_url, lostReason: status === 3 ? R.lost.get(String(d.lost_reason_id))?.name : null, extra },
    firstContactMin: fc ? Math.round(minsBetween(d.created_at, fc)) : null,
    form, timeline: ev, realLoss: real || null, realLossOptions: String(d.pipeline_id) === SDR ? REAL_LOSS.SDR : REAL_LOSS.CLOSER
  };
}

// Leads por anúncio e etapa (balão da Otimização). all(sql, ...args) → Promise<rows>.
export async function adLeads(all, { adId, since, until, kind }) {
  const base = `SELECT d.id,d.title,d.pipeline_id,d.status,d.created_at,d.closed_at,u.name owner FROM crm_deal d LEFT JOIN crm_ref u ON u.kind='user' AND u.id=d.owner_id`;
  const meet = k => `SELECT d.id,d.title,d.pipeline_id,d.status,a.start_at created_at,d.closed_at,u.name owner FROM crm_activity a JOIN crm_deal d ON d.id=a.deal_id LEFT JOIN crm_ref u ON u.kind='user' AND u.id=d.owner_id WHERE d.ad_id=? AND a.kind='${k}' AND a.status=2 AND a.start_day BETWEEN ? AND ?`;
  const q = {
    leads: `${base} WHERE d.ad_id=? AND d.pipeline_id='${SDR}' AND d.deleted=0 AND d.created_day BETWEEN ? AND ?`,
    appointments: `${base} WHERE d.ad_id=? AND d.pipeline_id='${CLOSER}' AND d.deleted=0 AND d.created_day BETWEEN ? AND ?`,
    meeting1: meet("m1"), meeting2: meet("m2"),
    sales: `${base} WHERE d.ad_id=? AND d.pipeline_id='${CLOSER}' AND d.status=1 AND d.closed_day BETWEEN ? AND ?`
  }[kind];
  if (!q || !/^[0-9]+$/.test(String(adId || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(since || "") || !/^\d{4}-\d{2}-\d{2}$/.test(until || "")) return { error: "Parâmetros inválidos." };
  const rows = await all(`${q} ORDER BY 5 DESC LIMIT 100`, String(adId), since, until);
  return { kind, adId: String(adId), since, until, leads: rows.map(r => ({ id: String(r.id), title: r.title, owner: r.owner || "—", at: r.created_at, status: ["Aberto", "Venda", "?", "Perdido"][Number(r.status)] || "", pipeline: String(r.pipeline_id) === SDR ? "SDR" : "Closers" })) };
}
