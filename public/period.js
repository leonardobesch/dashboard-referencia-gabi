// Período global do painel: o mesmo intervalo vale para todas as abas e fica salvo no navegador.
// Até 30 dias atrás os dados vêm do Cloudflare (rápido); períodos mais antigos vêm do arquivo local do PC.
(() => {
  'use strict';
  const KEY = 'rc_period_v1', LOCAL = 'http://127.0.0.1:8789', HOT_DAYS = 29;
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
  const presetRange = p => ({ since: daysAgo(Number(p) - 1), until: iso(new Date()), preset: String(p) });
  function read() {
    try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (s?.preset && s.preset !== 'custom') return presetRange(s.preset); if (s?.since && s?.until) return s; } catch {}
    return presetRange(30);
  }
  let current = read(), pcDownUntil = 0;
  const hotSince = () => daysAgo(HOT_DAYS);
  const isLong = p => (p || current).since < hotSince();
  const qs = p => `since=${encodeURIComponent(p.since)}&until=${encodeURIComponent(p.until)}`;

  // Busca na fonte certa. Período longo: arquivo do PC; se ele não responder, usa o Cloudflare e marca como parcial.
  async function fetchJson(path, p = current, { quiet = false } = {}) {
    const setSource = quiet ? () => {} : showSource;
    setSource('loading');
    const get = async (base, timeout) => {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
      try { const r = await fetch(`${base}${path}?${qs(p)}`, { signal: ctl.signal }); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`); return j; } finally { clearTimeout(t); }
    };
    // PC primeiro (histórico completo, sem limites); se não responder, Cloudflare (e não tenta o PC por 1 min).
    if (Date.now() > pcDownUntil) {
      try { const j = await get(LOCAL, isLong(p) ? 30000 : 2500); j._source = 'pc'; setSource('pc'); return j; }
      catch { pcDownUntil = Date.now() + 60000; }
    }
    const j = await get('', 60000); j._source = isLong(p) ? 'cloud-parcial' : 'cloud'; setSource(j._source); return j;
  }

  function showSource(src) {
    const el = document.querySelector('#periodSource'); if (!el) return;
    const map = { loading: ['Carregando dados…', 'warn'], cloud: ['Dados do Cloudflare (últimos 30 dias)', 'ok'], pc: ['Dados do arquivo do PC', 'ok'], 'cloud-parcial': [`Arquivo do PC offline — só há dados a partir de ${hotSince().split('-').reverse().join('/')}`, 'warn'] };
    const [txt, tone] = map[src] || ['', ''];
    el.textContent = txt; el.className = `period-source ${tone}`;
  }
  function paint() {
    const bar = document.querySelector('#periodBar'); if (!bar) return;
    bar.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('active', b.dataset.preset === current.preset));
    const s = document.querySelector('#since'), u = document.querySelector('#until');
    if (s) s.value = current.since; if (u) u.value = current.until;
    bar.classList.toggle('custom', current.preset === 'custom');
  }
  function set(next, { silent = false } = {}) {
    if (!next?.since || !next?.until) return;
    if (next.since > next.until) next = { ...next, since: next.until, until: next.since };
    current = { since: next.since, until: next.until, preset: String(next.preset || 'custom') };
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch {}
    paint();
    if (!silent) window.dispatchEvent(new CustomEvent('rc:period', { detail: { ...current } }));
  }
  function bind() {
    const bar = document.querySelector('#periodBar'); if (!bar) return;
    bar.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => b.dataset.preset === 'custom' ? set({ ...current, preset: 'custom' }, { silent: true }) : set(presetRange(b.dataset.preset)));
    ['#since', '#until'].forEach(sel => { const el = document.querySelector(sel); if (el) el.onchange = () => set({ since: document.querySelector('#since').value, until: document.querySelector('#until').value, preset: 'custom' }); });
    paint(); showSource(isLong() ? 'pc' : 'cloud');
  }
  // Todas as chamadas /api/* vão primeiro para o PC (sem limites); se o PC não estiver acessível, Cloudflare.
  const nativeFetch = window.fetch.bind(window);
  let pcCheck = null;
  const pcAlive = () => {
    if (Date.now() < pcDownUntil) return Promise.resolve(false);
    if (!pcCheck) pcCheck = (async () => { const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 1500); try { return (await nativeFetch(`${LOCAL}/api/status`, { signal: ctl.signal })).ok; } catch { return false; } finally { clearTimeout(t); } })()
      .then(ok => { if (!ok) pcDownUntil = Date.now() + 60000; setTimeout(() => { pcCheck = null; }, ok ? 300000 : 60000); return ok; });
    return pcCheck;
  };
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.startsWith('/api/') && await pcAlive()) {
      // Pedido "simples" (sem Content-Type JSON) para o Chrome não exigir checagem prévia (CORS) ao falar com o PC.
      const method = String(init?.method || 'GET').toUpperCase(), pcInit = { ...init, headers: method === 'GET' ? {} : { 'Content-Type': 'text/plain;charset=UTF-8' } };
      try { const r = await nativeFetch(LOCAL + url, pcInit); if (r.status < 500) { showSource('pc'); return r; } } catch { pcDownUntil = Date.now() + 60000; pcCheck = null; }
    }
    return nativeFetch(input, init);
  };
  window.RCPeriod = { get: () => ({ ...current }), set, isLong, hotSince, fetchJson, presetRange, LOCAL };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
