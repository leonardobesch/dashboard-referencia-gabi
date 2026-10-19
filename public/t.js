/* Rastreador Referência Capital — visitas, rolagem, cliques (mapa de calor), formulário e lead.
   Instalação: <script src="https://SEU-WORKER.SUA-CONTA.workers.dev/t.js" async></script> */
(function () {
  'use strict';
  if (window.__rcTrack) return; window.__rcTrack = 1;
  var END = (document.currentScript && document.currentScript.src ? new URL(document.currentScript.src).origin : 'https://SEU-WORKER.SUA-CONTA.workers.dev') + '/t/c';
  var LS = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var rid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); };
  var vid = LS.get('rc_vid'); if (!vid) { vid = rid(); LS.set('rc_vid', vid); }
  var S, timer;
  function params() {
    var q = new URLSearchParams(location.search), o = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid'].forEach(function (k) { var v = q.get(k); if (v) o[k] = v.slice(0, 300); });
    // ID do anúncio (padrão da Referência: "ID do anúncio" / ad_id)
    q.forEach(function (v, k) { if (/an[uú]ncio|ad_id/i.test(k) && /^\d{6,}$/.test(v)) o.ad_id = v; });
    if (Object.keys(o).length) LS.set('rc_first_touch', LS.get('rc_first_touch') || JSON.stringify(o));
    return o;
  }
  function start() {
    S = { t: 'pv', sid: rid(), vid: vid, url: location.href.slice(0, 1000), path: location.pathname, host: location.host, ref: document.referrer.slice(0, 500), q: params(), first: LS.get('rc_first_touch'),
      w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1, lang: navigator.language, t0: Date.now(), scroll: 0, clicks: [], form: 0, sent: 0, lead: {} };
    send('pv');
  }
  function docH() { return Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, 1); }
  function onScroll() { var p = Math.min(100, Math.round((scrollY + innerHeight) / docH() * 100)); if (p > S.scroll) S.scroll = p; }
  function label(el) { var t = (el.innerText || el.value || el.getAttribute('aria-label') || el.alt || '').trim().replace(/\s+/g, ' '); return (el.tagName.toLowerCase() + (t ? ':' + t.slice(0, 40) : '')); }
  function onClick(e) {
    if (S.clicks.length >= 150) return;
    var el = e.target && e.target.closest ? (e.target.closest('a,button,input,select,label,[role=button]') || e.target) : e.target;
    S.clicks.push([Math.round(e.pageX / document.documentElement.scrollWidth * 1000) / 10, Math.round(e.pageY / docH() * 1000) / 10, Math.round((Date.now() - S.t0) / 1000), el ? label(el) : '']);
    if (el && el.matches && el.matches('button,[type=submit],a[href*="wa.me"],a[href*="whatsapp"]')) { grab(); send('click'); }
  }
  // Captura e-mail/telefone/nome enquanto o lead digita (funciona com formulários do WordPress e do Lovable).
  function grab() {
    var f = document.querySelectorAll('input,textarea');
    for (var i = 0; i < f.length; i++) {
      var x = f[i], v = (x.value || '').trim(), n = ((x.name || '') + ' ' + (x.id || '') + ' ' + (x.placeholder || '') + ' ' + (x.type || '') + ' ' + (x.getAttribute('autocomplete') || '')).toLowerCase();
      if (!v || x.type === 'password' || x.type === 'hidden') continue;
      if (/@/.test(v) && /\./.test(v) && v.length < 120) S.lead.email = v.toLowerCase();
      else if ((/tel|phone|fone|whats|celular/.test(n) || /^[+()\d\s-]{8,20}$/.test(v)) && v.replace(/\D/g, '').length >= 8) S.lead.phone = v.replace(/[^\d+]/g, '');
      else if (/nome|name/.test(n) && v.length < 80) S.lead.name = v;
    }
  }
  function onInput(e) { if (!S.form && e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) { S.form = 1; send('form'); } }
  function onSubmit() { grab(); S.form = 2; send('submit'); }
  function payload(kind) {
    onScroll();
    return JSON.stringify({ k: kind, sid: S.sid, vid: S.vid, url: S.url, path: S.path, host: S.host, ref: S.ref, q: S.q, first: S.first, w: S.w, h: S.h, dpr: S.dpr, lang: S.lang,
      dur: Math.round((Date.now() - S.t0) / 1000), scroll: S.scroll, clicks: S.clicks, form: S.form, lead: S.lead });
  }
  function send(kind) {
    var body = payload(kind); S.sent++;
    try { if (navigator.sendBeacon && navigator.sendBeacon(END, new Blob([body], { type: 'text/plain' }))) return; } catch (e) {}
    try { fetch(END, { method: 'POST', body: body, keepalive: true, mode: 'no-cors', headers: { 'content-type': 'text/plain' } }); } catch (e) {}
  }
  function flush() { grab(); send('end'); }
  // API para formulários próprios (ex.: Typebot): window.rcTrack.lead({ email, phone, name })
  window.rcTrack = { lead: function (o) { o = o || {}; if (o.email) S.lead.email = String(o.email).toLowerCase(); if (o.phone) S.lead.phone = String(o.phone).replace(/[^\d+]/g, ''); if (o.name) S.lead.name = String(o.name); S.form = 2; send('submit'); }, event: function (name) { S.clicks.push([0, 0, Math.round((Date.now() - S.t0) / 1000), 'evento:' + String(name).slice(0, 40)]); send('click'); } };
  // Páginas de app (Lovable): nova visita a cada troca de rota.
  function route() { if (S && location.href !== S.url) { flush(); start(); } }
  ['pushState', 'replaceState'].forEach(function (m) { var o = history[m]; history[m] = function () { var r = o.apply(this, arguments); setTimeout(route, 0); return r; }; });
  addEventListener('popstate', route);
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('click', onClick, true);
  addEventListener('input', onInput, true);
  addEventListener('change', grab, true);
  addEventListener('submit', onSubmit, true);
  addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);
  start();
  timer = setInterval(function () { if (document.visibilityState === 'visible' && Date.now() - S.t0 < 1800000) { grab(); send('ping'); } }, 30000);
})();
