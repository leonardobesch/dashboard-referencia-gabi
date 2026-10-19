// Abas CRM e Comercial + barra de alertas. Dados: PC (ao vivo) ou pacote do Cloudflare (atualizado a cada 5 min).
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brMs = s => { const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 3, +m[5], +(m[6] || 0)) : NaN; };
  const fmtDur = min => { if (min == null || !isFinite(min)) return '—'; min = Math.max(0, Math.round(min)); if (min < 60) return `${min} min`; if (min < 1440) return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`; return `${Math.floor(min / 1440)}d ${Math.floor(min % 1440 / 60)}h`; };
  const fmtClock = sec => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`; };
  const fmtDt = s => { const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : ''; };
  const short = n => String(n || '').split(' ').slice(0, 2).join(' ');
  async function get(path) { const r = await fetch(path); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`); return j; }
  const srcLabel = j => j.source === 'pc' ? 'Ao vivo (PC)' : `Pacote do PC de ${new Date(j.snapshotAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  const SLA = 15;
  const timerClass = (min, sla = SLA) => min > sla * 4 ? 'crit' : min > sla ? 'warn' : '';

  // ---------- Contadores ao vivo ----------
  setInterval(() => document.querySelectorAll('[data-since]').forEach(el => {
    const sec = (Date.now() - brMs(el.dataset.since)) / 1000; el.textContent = sec < 86400 ? fmtClock(sec) : fmtDur(sec / 60);
    el.className = `rc-timer ${timerClass(sec / 60, Number(el.dataset.sla || SLA))}`;
  }), 1000);

  // ---------- Barra de alertas (todas as abas) ----------
  async function loadAlerts() {
    let bar = $('#rcAlertBar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'rcAlertBar'; bar.className = 'rc-alertbar'; $('#periodBar')?.after(bar); }
    try {
      const a = await get('/api/rc/alerts');
      const pend = (a.reunioesHoje || []).filter(r => r.status === 'Pendente').reduce((s, r) => s + r.count, 0);
      const ns = (a.reunioesHoje || []).filter(r => r.status === 'No-show').reduce((s, r) => s + r.count, 0);
      bar.innerHTML = `
        <button class="rc-alert ${a.novosAtrasados.today ? 'crit' : 'ok'}" data-go="comercial"><i class="rc-dot"></i>Sem 1º contato registrado no PipeRun (+${a.slaMin} min): <b>${a.novosAtrasados.today}</b> hoje · mova para Abertura ou registre nota</button>
        <button class="rc-alert ${a.novosAtrasados.count > 50 ? 'warn' : 'ok'}" data-go="crm"><i class="rc-dot"></i>Total em "Novos" atrasados: <b>${a.novosAtrasados.count}</b></button>
        <button class="rc-alert ${a.parados.total > 100 ? 'warn' : 'ok'}" data-go="crm"><i class="rc-dot"></i>Parados há +${a.parados.days} dias: <b>${a.parados.total}</b></button>
        <button class="rc-alert ${pend ? 'warn' : 'ok'}" data-go="comercial"><i class="rc-dot"></i>Reuniões de hoje pendentes: <b>${pend}</b>${ns ? ` · no-show: <b>${ns}</b>` : ''}</button>
        <span class="rc-src" style="align-self:center">${esc(srcLabel(a))}</span>`;
      syncStamp(a.source === 'pc' ? new Date().toISOString() : a.snapshotAt);
      bar.querySelectorAll('[data-go]').forEach(b => b.onclick = () => document.querySelector(`.nav-btn[data-page="${b.dataset.go}"]`)?.click());
    } catch (e) { bar.innerHTML = `<span class="rc-src">Alertas indisponíveis: ${esc(e.message)}</span>`; }
  }

  // ---------- CRM ----------
  const crm = { pipe: '78790', owner: '', q: '' };
  async function renderCrm() {
    const el = $('#crmApp'); if (!el) return;
    if (!el.dataset.ready) {
      el.dataset.ready = 1;
      el.innerHTML = `<div class="rc-wrap"><div class="rc-head"><div><h1>CRM</h1><p>Mesmo quadro do PipeRun, com tempo em cada etapa, linha do tempo do lead e motivo real de perda. Nada aqui altera o PipeRun.</p></div>
        <div class="rc-tools"><div class="rc-seg" id="crmPipe"><button data-p="78790" class="on">SDR</button><button data-p="84566">Closers</button></div>
        <select id="crmOwner" aria-label="Responsável"><option value="">Todos os responsáveis</option></select>
        <input id="crmQ" type="search" placeholder="Buscar lead" aria-label="Buscar lead"><span class="rc-src" id="crmSrc"></span></div></div>
        <div class="rc-board" id="crmBoard"><div class="rc-src">Carregando quadro…</div></div></div>`;
      el.querySelectorAll('#crmPipe button').forEach(b => b.onclick = () => { crm.pipe = b.dataset.p; crm.owner = ''; el.querySelectorAll('#crmPipe button').forEach(x => x.classList.toggle('on', x === b)); renderCrm(); });
      $('#crmOwner').onchange = e => { crm.owner = e.target.value; renderCrm(); };
      $('#crmQ').oninput = e => { crm.q = e.target.value.toLowerCase(); paintBoard(); };
    }
    try {
      crm.data = await get(`/api/rc/board?pipeline=${crm.pipe}${crm.owner ? `&owner=${crm.owner}` : ''}`);
      $('#crmSrc').textContent = srcLabel(crm.data);
      const sel = $('#crmOwner'), cur = crm.owner;
      sel.innerHTML = `<option value="">Todos os responsáveis</option>` + crm.data.owners.map(o => `<option value="${esc(o.id)}" ${o.id === cur ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
      paintBoard();
    } catch (e) { $('#crmBoard').innerHTML = `<div class="rc-src">Não foi possível carregar: ${esc(e.message)}</div>`; }
  }
  function paintBoard() {
    const d = crm.data; if (!d) return; const first = d.columns[0]?.id;
    $('#crmBoard').innerHTML = d.columns.map(c => {
      const list = c.deals.filter(x => !crm.q || `${x.title} ${x.owner}`.toLowerCase().includes(crm.q));
      return `<div class="rc-col"><h3><span>${esc(c.name)}</span><small>${c.count}${c.stale ? ` · <span class="st">${c.stale} parados</span>` : ''}</small></h3><div class="rc-cards">${list.map(x => `
        <button class="rc-card" data-id="${esc(x.id)}"><span class="t">${esc(x.title)}</span>
        <span class="m"><span>${esc(short(x.owner))}</span><span class="rc-timer" data-since="${esc(c.id === first ? x.createdAt : x.inStageAt)}" data-sla="${c.id === first ? SLA : 7 * 1440}">${fmtDur(x.ageMin)}</span></span>
        <span class="m"><span>${esc(x.source)}</span><span>${x.noshow ? `no-show ${x.noshow}×` : ''}</span></span></button>`).join('')}
        ${c.count > c.deals.length ? `<div class="rc-more">Mostrando ${c.deals.length} de ${c.count}</div>` : ''}</div></div>`;
    }).join('');
    $('#crmBoard').querySelectorAll('.rc-card').forEach(b => b.onclick = () => openDeal(b.dataset.id));
  }

  async function openDeal(id) {
    const wrap = document.createElement('div'); wrap.className = 'rc-drawer';
    wrap.innerHTML = `<section role="dialog" aria-label="Ficha do lead"><header><h2>Carregando…</h2><button class="rc-x" aria-label="Fechar">×</button></header></section>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove(); wrap.onclick = e => { if (e.target === wrap) close(); }; wrap.querySelector('.rc-x').onclick = close;
    document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
    try {
      const f = await get(`/api/rc/deal?id=${encodeURIComponent(id)}`), d = f.deal;
      wrap.querySelector('section').innerHTML = `
        <header><div><h2>${esc(d.title)}</h2><span class="rc-src">${esc(d.pipeline)} · ${esc(d.stage)} · ${esc(d.status)}</span></div><button class="rc-x" aria-label="Fechar">×</button></header>
        <div class="rc-facts">
          <div><span>Responsável</span>${esc(d.owner)}</div><div><span>Entrou em</span>${esc(fmtDt(d.createdAt))}</div>
          <div><span>1º contato</span>${f.firstContactMin == null ? 'Sem registro' : fmtDur(f.firstContactMin)}</div><div><span>Origem</span>${esc(d.source)}</div>
          ${d.campaign ? `<div style="grid-column:1/-1"><span>Campanha</span>${esc(d.campaign)}</div>` : ''}
          ${d.ad ? `<div><span>Anúncio</span>${esc(d.ad)}</div>` : ''}${d.value ? `<div><span>Valor</span>R$ ${Number(d.value).toLocaleString('pt-BR')}</div>` : ''}
          ${d.lostReason ? `<div style="grid-column:1/-1"><span>Motivo no PipeRun</span>${esc(d.lostReason)}</div>` : ''}
        </div>
        ${f.form ? `<div class="rc-box"><h4>O que o lead preencheu</h4><p class="rc-pre">${esc(f.form)}</p></div>` : ''}
        <div class="rc-box"><h4>Páginas visitadas</h4>${f.visits?.length ? `<table class="rc-table"><thead><tr><th>Quando</th><th>Página</th><th>Origem</th><th class="num">Tempo</th><th class="num">Rolagem</th><th>Local</th></tr></thead><tbody>${f.visits.map(v => `<tr><td>${esc(fmtDt(v.at))}</td><td>${esc(v.page)}${v.form === 2 ? ' <span class="rc-tag">enviou</span>' : ''}</td><td>${esc(v.source)}</td><td class="num">${fmtDur(v.dur / 60)}</td><td class="num">${v.scroll}%</td><td>${esc(v.place)}</td></tr>`).join('')}</tbody></table>` : `<p class="rc-src">${f.source === 'cloud' ? 'As visitas aparecem com o PC ligado.' : 'Nenhuma visita registrada ainda. Elas aparecem depois que o rastreador for instalado nas páginas.'}</p>`}</div>
        <div class="rc-box"><h4>Motivo real (só no nosso painel)</h4><div class="rc-loss">
          <select id="rcLossSel"><option value="">Escolha o motivo real…</option>${f.realLossOptions.map(o => `<option ${f.realLoss?.reason === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
          <textarea id="rcLossNote" rows="2" placeholder="Detalhe (opcional)">${esc(f.realLoss?.note || '')}</textarea>
          <button class="rc-btn" id="rcLossSave">Salvar motivo</button><span class="rc-src" id="rcLossMsg">${f.realLoss ? `Salvo em ${esc(fmtDt(f.realLoss.at))}` : ''}</span></div></div>
        <div class="rc-box"><h4>Linha do tempo</h4><ol class="rc-tl">${f.timeline.map(e => `<li class="k-${esc(e.kind)}"><time>${esc(fmtDt(e.at))}</time><i></i><div><b>${esc(e.title)}</b>${e.text ? `<p>${esc(e.text)}</p>` : ''}</div></li>`).join('')}</ol></div>`;
      wrap.querySelector('.rc-x').onclick = close;
      $('#rcLossSave').onclick = async () => {
        const reason = $('#rcLossSel').value; if (!reason) { $('#rcLossMsg').textContent = 'Escolha um motivo.'; return; }
        try { const r = await fetch('/api/rc/loss-real', { method: 'POST', body: JSON.stringify({ deal_id: id, reason, note: $('#rcLossNote').value }) }); const j = await r.json(); if (j.error) throw new Error(j.error); $('#rcLossMsg').textContent = 'Motivo salvo.'; }
        catch (e) { $('#rcLossMsg').textContent = `Não salvou: ${e.message} (o PC precisa estar ligado).`; }
      };
    } catch (e) { wrap.querySelector('section').innerHTML = `<header><h2>Ficha indisponível</h2><button class="rc-x" aria-label="Fechar">×</button></header><p>${esc(e.message)}</p>`; wrap.querySelector('.rc-x').onclick = close; }
  }

  // ---------- Comercial ----------
  async function renderComercial() {
    const el = $('#comercialApp'); if (!el) return;
    if (!el.dataset.ready) { el.dataset.ready = 1; el.innerHTML = `<div class="rc-wrap"><div class="rc-src">Carregando time…</div></div>`; }
    try {
      const [c, loss] = await Promise.all([get('/api/rc/comercial'), get('/api/rc/loss').catch(() => null)]), t = c.totals;
      const sdrs = c.sdrs.filter(s => !s.gestor), maxH = Math.max(1, ...c.hourly.map(h => h.leads));
      const hours = c.hourly.filter(h => h.hour >= 7 && h.hour <= 23), W = 760, H = 200, bw = W / hours.length;
      const maxAvg = Math.max(SLA * 2, ...hours.map(h => h.avgMin || 0));
      const chart = `<svg class="rc-chart" viewBox="0 0 ${W} ${H + 24}" role="img" aria-label="Leads e tempo médio de 1º contato por hora">
        <line x1="0" x2="${W}" y1="${H - (SLA / maxAvg) * H}" y2="${H - (SLA / maxAvg) * H}" stroke="var(--red)" stroke-dasharray="4 4" opacity=".6"/>
        ${hours.map((h, i) => `<rect x="${i * bw + 4}" y="${H - h.leads / maxH * (H - 10)}" width="${bw - 8}" height="${h.leads / maxH * (H - 10)}" rx="3" fill="var(--gold)" opacity=".35"><title>${h.hour}h: ${h.leads} leads</title></rect>
          ${h.avgMin != null ? `<circle cx="${i * bw + bw / 2}" cy="${H - Math.min(h.avgMin, maxAvg) / maxAvg * H}" r="4" fill="${h.avgMin > SLA ? 'var(--red)' : 'var(--green)'}"><title>${h.hour}h: ${h.avgMin} min até o 1º contato</title></circle>` : ''}
          <text x="${i * bw + bw / 2}" y="${H + 16}" text-anchor="middle">${h.hour}h</text>`).join('')}</svg>`;
      el.innerHTML = `<div class="rc-wrap">
        <div class="rc-head"><div><h1>Comercial</h1><p>Time ao vivo: quem está online, quanto tempo leva o 1º contato e o que está esperando agora. Meta: 1º contato em até ${c.slaMin} min.</p></div><span class="rc-src">${esc(srcLabel(c))} · atualiza a cada minuto</span></div>
        ${t.waiting ? `<div class="rc-alert crit" style="border-radius:12px;padding:12px 14px;display:block;cursor:default"><b>O time precisa registrar o 1º contato no PipeRun.</b> ${t.waiting} leads de hoje continuam em "Novos" sem etapa movida, nota ou ligação registrada. Ao falar com o lead (inclusive pelo WhatsApp), mova para <b>Abertura</b> ou escreva uma nota. Sem isso, o painel não consegue medir a velocidade de atendimento. Por SDR: ${sdrs.filter(s => s.waiting).map(s => `${esc(short(s.name))} <b>${s.waiting}</b>`).join(' · ')}</div>` : ''}
        <div class="rc-kpis">
          <div class="rc-kpi"><span>Leads hoje</span><strong>${t.received}</strong></div>
          <div class="rc-kpi"><span>Já contatados</span><strong>${t.contacted}</strong></div>
          <div class="rc-kpi ${t.waiting ? 'crit' : 'good'}"><span>Esperando 1º contato</span><strong>${t.waiting}</strong></div>
          <div class="rc-kpi ${t.avgMin > c.slaMin ? 'crit' : 'good'}"><span>Tempo médio de 1º contato</span><strong>${fmtDur(t.avgMin)}</strong></div>
          <div class="rc-kpi"><span>Contato em até ${c.slaMin} min</span><strong>${t.slaPct}%</strong></div>
          <div class="rc-kpi"><span>SDRs online agora</span><strong>${t.online}</strong></div>
        </div>
        <div class="rc-grid2">
          <div class="rc-box rc-scroll"><h4>SDRs hoje</h4><table class="rc-table"><thead><tr><th>SDR</th><th class="num">Recebidos</th><th class="num">Contatados</th><th class="num">Tempo médio</th><th class="num">Em ${c.slaMin} min</th><th>Esperando agora</th></tr></thead><tbody>
            ${sdrs.map(s => `<tr><td><i class="rc-dot ${s.online ? 'on' : ''}" title="${s.online ? 'Online' : 'Sem ação nos últimos ' + c.onlineMin + ' min'}"></i> ${esc(short(s.name))}<br><span class="rc-src">${s.lastAt ? 'última ação ' + esc(fmtDt(s.lastAt).slice(6)) : 'sem ação hoje'}</span></td>
              <td class="num">${s.received}</td><td class="num">${s.contacted}</td><td class="num">${fmtDur(s.avgMin)}</td><td class="num">${s.slaPct}%</td>
              <td><div class="rc-wait">${s.waitingList.slice(0, 6).map(w => `<span class="rc-timer" data-since="${esc(w.since)}">${fmtDur(w.min)}</span>`).join('')}${s.waiting > 6 ? `<span class="rc-tag">+${s.waiting - 6}</span>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="6">Nenhum lead hoje ainda.</td></tr>'}
          </tbody></table></div>
          <div class="rc-box"><h4>Leads por hora e tempo de 1º contato</h4>${chart}<p class="rc-src">Barras: leads que entraram. Pontos: tempo médio até o 1º contato (vermelho acima de ${c.slaMin} min, linha tracejada).</p></div>
        </div>
        <div class="rc-grid2">
          <div class="rc-box rc-scroll"><h4>Closers</h4><table class="rc-table"><thead><tr><th>Closer</th><th>1ª reunião hoje</th><th>2ª reunião hoje</th><th class="num">Vendas no mês</th></tr></thead><tbody>
            ${c.closers.filter(x => !x.gestor && (x.winsMonth || Object.keys(x.m1).length || Object.keys(x.m2).length)).map(x => `<tr><td>${esc(short(x.name))}</td><td>${Object.entries(x.m1).map(([k, v]) => `<span class="rc-tag">${esc(k)} ${v}</span>`).join(' ') || '—'}</td><td>${Object.entries(x.m2).map(([k, v]) => `<span class="rc-tag">${esc(k)} ${v}</span>`).join(' ') || '—'}</td><td class="num">${x.winsMonth}</td></tr>`).join('')}
          </tbody></table><p class="rc-src">O gestor comercial fica fora do ranking.</p></div>
          <div class="rc-box"><h4>Motivos de perda no mês</h4>${loss ? ['sdr', 'closers'].map(k => { const max = Math.max(1, ...loss[k].map(x => x.count)); return `<p class="rc-src" style="margin:8px 0 4px">${k === 'sdr' ? 'SDR' : 'Closers'}</p><div class="rc-bars">${loss[k].slice(0, 6).map(x => `<div class="rc-barrow"><div style="--w:${x.count / max * 100}%">${esc(x.reason)}</div><span>${x.count}</span></div>`).join('')}</div>`; }).join('') : '<p class="rc-src">Indisponível.</p>'}</div>
        </div></div>`;
    } catch (e) { el.innerHTML = `<div class="rc-wrap"><div class="rc-src">Não foi possível carregar: ${esc(e.message)}</div></div>`; }
  }

  // ---------- Balões da Otimização: cálculo da nota e leads de cada número ----------
  window.rcOpenDeal = openDeal;
  const KIND = { leads: 'Leads', appointments: 'Agendamentos', meeting1: '1ª reuniões realizadas', meeting2: '2ª reuniões realizadas', sales: 'Vendas' };
  let pop = null, popFor = null, hideT = null, showT = null;
  function popEl() { if (!pop) { pop = document.createElement('div'); pop.className = 'rc-pop'; pop.addEventListener('mouseenter', () => clearTimeout(hideT)); pop.addEventListener('mouseleave', hidePop); document.body.appendChild(pop); } return pop; }
  function placePop(anchor) {
    const p = popEl(), r = anchor.getBoundingClientRect(); p.style.display = 'block';
    const w = p.offsetWidth, h = p.offsetHeight; let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8;
    x = Math.max(8, Math.min(x, innerWidth - w - 8)); if (y + h > innerHeight - 8) y = Math.max(8, r.top - h - 8);
    p.style.left = x + 'px'; p.style.top = y + 'px';
  }
  function hidePop() { clearTimeout(hideT); hideT = setTimeout(() => { if (pop) pop.style.display = 'none'; popFor = null; }, 250); }
  const fmt1 = v => v == null || !isFinite(v) ? '—' : (Math.round(v * 10) / 10).toLocaleString('pt-BR');
  function scoreHtml(d) {
    const rows = d.rows || [], tot = rows.reduce((a, x) => a + Number(x.contribution || 0), 0);
    return `<b class="rc-pop-t">Como a nota ${d.score == null ? '' : Math.round(d.score)} foi calculada</b>
      <table class="rc-pop-tb"><thead><tr><th>Critério</th><th>Nota</th><th>Peso</th><th>Pontos</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td>${esc(x.label)}</td><td>${fmt1(x.score)}</td><td>${fmt1(x.weight)}%</td><td><b>${fmt1(x.contribution)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="3">Total (nota × peso)</td><td><b>${fmt1(tot)}</b></td></tr></tfoot></table>
      <p class="rc-src">Cada critério vale de 0 a 100; a nota final é a soma de nota × peso. ${d.eligible ? 'Amostra suficiente para decidir.' : 'Amostra ainda pequena: a ação fica em espera.'}${d.reason ? ' · ' + esc(d.reason) : ''}</p>`;
  }
  async function leadsHtml(el) {
    const R = window.optPeriodRange ? optPeriodRange() : {}, k = el.dataset.kind;
    const j = await get(`/api/rc/ad-leads?${new URLSearchParams({ ad_id: el.dataset.ad, kind: k, since: R.since || '', until: R.until || '' })}`);
    return `<b class="rc-pop-t">${KIND[k] || k} deste anúncio</b><span class="rc-src">${esc(fmtDt(j.since + ' 00:00').slice(0, 5))} a ${esc(fmtDt(j.until + ' 00:00').slice(0, 5))} · clique para ver o histórico</span>
      <div class="rc-pop-list">${(j.leads || []).map(l => `<button class="rc-pop-lead" data-id="${esc(l.id)}"><span>${esc(l.title)}</span><small>${esc(short(l.owner))} · ${esc(fmtDt(l.at))}${l.status ? ' · ' + esc(l.status) : ''}</small></button>`).join('') || '<p class="rc-src">Nenhum lead encontrado no CRM para este anúncio no período. O número da tabela pode vir da Meta (lead do formulário ainda sem negócio no CRM).</p>'}</div>`;
  }
  async function showFor(el) {
    if (popFor === el) return; popFor = el; clearTimeout(hideT); const p = popEl();
    if (el.dataset.break) { let d = {}; try { d = JSON.parse(el.dataset.break); } catch {} p.innerHTML = scoreHtml(d); placePop(el); return; }
    p.innerHTML = '<span class="rc-src">Carregando leads…</span>'; placePop(el);
    try { const h = await leadsHtml(el); if (popFor === el) { p.innerHTML = h; placePop(el); p.querySelectorAll('.rc-pop-lead').forEach(b => b.onclick = () => { p.style.display = 'none'; popFor = null; openDeal(b.dataset.id); }); } }
    catch (e) { if (popFor === el) p.innerHTML = `<span class="rc-src">Não foi possível carregar: ${esc(e.message)}</span>`; }
  }
  const target = e => e.target.closest && e.target.closest('.opt-leadlink,.opt-score[data-break]');
  document.addEventListener('mouseover', e => { const t = target(e); if (!t) return; clearTimeout(showT); showT = setTimeout(() => showFor(t), 250); });
  document.addEventListener('mouseout', e => { const t = target(e); if (!t) return; clearTimeout(showT); if (!e.relatedTarget || !pop?.contains(e.relatedTarget)) hidePop(); });
  document.addEventListener('focusin', e => { const t = target(e); if (t) showFor(t); });
  document.addEventListener('click', e => { const t = target(e); if (t) { e.preventDefault(); popFor = null; showFor(t); } else if (pop && !pop.contains(e.target)) { pop.style.display = 'none'; popFor = null; } });

  // ---------- Ligação com a navegação ----------
  const active = () => document.querySelector('.page.active')?.id?.replace('page-', '');
  function onPage() { const p = active(); if (p === 'crm') renderCrm(); if (p === 'comercial') renderComercial(); }
  // Botão único "Atualizar": só relê os dados (a sincronização com Meta e PipeRun roda sozinha no PC a cada 5 min).
  async function reloadAll() {
    const b = $('#rcRefresh'); if (b) { b.disabled = true; b.textContent = 'Atualizando…'; }
    try {
      if (window.RCPeriod) RCPeriod.set(RCPeriod.get()); else if (typeof loadCachedData === 'function') await loadCachedData();
      await loadAlerts(); onPage();
    } finally { if (b) { b.disabled = false; b.textContent = '↻ Atualizar'; } }
  }
  function syncStamp(at) { const el = $('#lastUpdated'); if (!el || !at) return; const min = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 60000)); el.textContent = min < 1 ? 'Sincronizado agora' : `Sincronizado há ${min} min`; el.title = 'O PC sincroniza Meta e PipeRun automaticamente a cada 5 minutos.'; }
  window.rcSyncStamp = syncStamp;
  function boot() {
    const actions = document.querySelector('.header-actions');
    if (actions && !$('#rcRefresh')) { const b = document.createElement('button'); b.id = 'rcRefresh'; b.className = 'rc-refresh'; b.textContent = '↻ Atualizar'; b.title = 'Recarregar os dados na tela'; b.onclick = reloadAll; actions.insertBefore(b, $('#settingsBtn')); }
    setInterval(() => { if (!document.hidden && !document.querySelector('.rc-drawer')) reloadAll(); }, 300000);
    document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => setTimeout(onPage, 0)));
    loadAlerts(); onPage();
    setInterval(() => { loadAlerts(); const p = active(); if (p === 'comercial') renderComercial(); }, 60000);
    setInterval(() => { if (active() === 'crm' && !document.querySelector('.rc-drawer')) renderCrm(); }, 300000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
