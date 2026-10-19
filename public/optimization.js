
(()=>{
'use strict';
const O={config:null,data:null,segment:'GERAL',period:'custom',accountId:'',sort:'score',sortDir:'desc',f:{q:'',impr:false,camp:'active',set:'active',ad:'active'},selected:new Set(),pipelines:[],detail:null,booted:false};
const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const brl=v=>v==null||!Number.isFinite(Number(v))?'—':new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2}).format(Number(v));
const n=v=>v==null||!Number.isFinite(Number(v))?'—':new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0}).format(Number(v));
const d=v=>v==null||!Number.isFinite(Number(v))?'—':new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}).format(Number(v));
const pct=v=>v==null||!Number.isFinite(Number(v))?'—':`${d(v)}%`;
const apiOpt=async(url,opt={})=>{const r=await fetch(url,{headers:{'Content-Type':'application/json'},...opt}),j=await r.json().catch(()=>({error:'Resposta inválida'}));if(!r.ok||j.error)throw new Error(j.error||`HTTP ${r.status}`);return j};
const actionClass=a=>a==='ESCALAR'?'scale':a==='MANTER'?'keep':a==='REDUZIR'?'reduce':a==='PAUSAR'?'pause':'wait';
const scoreClass=s=>Number(s)>=80?'high':Number(s)>=45?'mid':'low';
const periodLabel={custom:'PERÍODO DO TOPO',today:'HOJE',yesterday:'ONTEM',d7:'7 DIAS',d30:'30 DIAS'};
const metric=(obj,key)=>Number(obj?.[key]||0);
const rate=(a,b)=>b?100*a/b:0;
function shell(){
 const root=q('#optimizationApp');if(!root)return;
 root.innerHTML=`<div class="opt-root">
  <div class="opt-title-row"><div><span class="eyebrow">OTIMIZAÇÃO DETERMINÍSTICA</span><h1>Otimização</h1><p>Meta Ads + PipeRun com decisões por regras, thresholds e fórmulas configuradas. Sem IA.</p></div><div class="opt-title-actions"><span id="optSyncLabel" class="opt-chip">Atualizado —</span><button class="opt-btn" id="optConfigBtn">⚙ Regras</button><button class="opt-btn gold" id="optSyncBtn">↻ Sincronizar e recalcular</button></div></div>
  <section class="opt-health">
   <article class="opt-health-card"><div class="opt-health-title">Volume</div><div class="opt-pair"><div class="opt-metric"><span>Meta do dia</span><b id="optHGoal">—</b></div><div class="opt-vline"></div><div class="opt-metric"><span>Ritmo atual</span><b id="optHPace">—</b><div id="optHLeadDelta" class="opt-delta">—</div></div></div></article>
   <article class="opt-health-card"><div class="opt-health-title">Pacing financeiro</div><div class="opt-pair"><div class="opt-metric"><span>Gasto esperado</span><b id="optHExpected">—</b></div><div class="opt-vline"></div><div class="opt-metric"><span>Gasto atual</span><b id="optHSpend">—</b><div id="optHSpendDelta" class="opt-delta">—</div></div></div></article>
   <article class="opt-health-card"><div class="opt-health-title">Eficiência</div><div class="opt-pair"><div class="opt-metric"><span>CPL alvo</span><b id="optHTarget">—</b></div><div class="opt-vline"></div><div class="opt-metric"><span>CPL atual</span><b id="optHCurrent">—</b><div id="optHCplDelta" class="opt-delta">—</div></div></div></article>
  </section>
  <div class="opt-segment-bar"><div class="opt-segments" id="optSegments"></div><div class="opt-title-actions"><select class="opt-select" id="optAccountFilter"><option value="">Todas as contas</option></select></div></div>
  <section class="opt-overview" id="optOverview"></section>
  <section class="opt-panel">
   <div class="opt-toolbar"><div class="opt-periods">${Object.entries(periodLabel).map(([k,l])=>`<button class="opt-period ${k===O.period?'active':''}" data-period="${k}">${l}</button>`).join('')}</div><div class="opt-spacer"></div><select id="optSort" class="opt-select"><option value="score">Ordenar: Nota</option><option value="cpl">CPL</option><option value="spend">Gasto</option><option value="leads">Leads</option><option value="sales">Vendas</option><option value="cac">CAC</option></select></div>
   <div class="opt-filters"><input id="optSearch" class="opt-input" type="search" placeholder="Buscar campanha, conjunto ou anúncio…"><label class="opt-check-label"><input type="checkbox" id="optImpr"> Só com impressões</label><select id="optFAcct" class="opt-select" aria-label="Conta de anúncios"><option value="">Contas: todas</option></select><select id="optFCamp" class="opt-select"><option value="">Campanhas: todos</option><option value="active">Campanhas: ativos</option><option value="paused">Campanhas: pausados</option></select><select id="optFSet" class="opt-select"><option value="">Conjuntos: todos</option><option value="active">Conjuntos: ativos</option><option value="paused">Conjuntos: pausados</option></select><select id="optFAd" class="opt-select"><option value="">Anúncios: todos</option><option value="active">Anúncios: ativos</option><option value="paused">Anúncios: pausados</option></select><span id="optFilterCount" class="opt-filter-count"></span><button id="optClearFilters" class="opt-btn">Voltar ao padrão (ativos)</button></div>
   <div class="opt-rule-note"><strong>Motor fixo:</strong> nota 0–100 calculada por CPL, volume e conversões comerciais. Amostra mínima bloqueia decisões; zero lead pode acionar pausa pela regra CPL alvo + gordura. Recência pondera 1, 7 e 30 dias.</div>
   <div class="opt-summary" id="optSummary"></div>
   <div class="opt-table-wrap"><table class="opt-table">
    <colgroup><col style="width:270px"><col style="width:130px"><col style="width:95px"><col style="width:100px"><col style="width:75px"><col style="width:100px"><col style="width:75px"><col style="width:100px"><col style="width:75px"><col style="width:100px"><col style="width:75px"><col style="width:100px"><col style="width:75px"><col style="width:100px"><col style="width:85px"><col style="width:95px"><col style="width:75px"><col style="width:105px"><col style="width:115px"><col style="width:105px"><col style="width:110px"></colgroup>
    <thead><tr>
      <th class="sticky-col opt-group-head"><div class="opt-head-pair" style="grid-template-columns:1fr 1px 1fr 1px 1fr"><div class="opt-head-item" data-sort="name"><small>Estrutura</small><b>Campanha</b></div><div class="opt-head-sep"></div><div class="opt-head-item" data-sort="name"><small>&nbsp;</small><b>Conjunto</b></div><div class="opt-head-sep"></div><div class="opt-head-item" data-sort="name"><small>&nbsp;</small><b>Criativo</b></div></div></th>
      <th class="opt-acct-head">Conta</th>${headPair('META','Orçamento','Gasto','budget','spend')}${headPair('LEAD','Leads','CPL','leads','cpl')}${headPair('AGENDAMENTO','Qtd','CPA','appointments','cpaAppointment')}${headPair('1ª REUNIÃO','Qtd','CPA','meeting1','cpaMeeting1')}${headPair('2ª REUNIÃO','Qtd','CPA','meeting2','cpaMeeting2')}${headPair('VENDA','Qtd','CAC','sales','cac')}
      <th data-sort="score">Nota</th><th data-sort="sample">Amostra</th><th data-sort="rank">Ranking</th><th data-sort="action">Ação</th><th data-sort="suggested">Orçamento sugerido</th><th data-sort="status">Status</th><th>Ação</th>
    </tr></thead><tbody id="optTableBody"><tr><td colspan="20"><div class="opt-empty">Carregando otimização…</div></td></tr></tbody>
   </table></div>
   <div class="opt-footer"><span class="opt-chip">A execução exige aprovação. A mesma entrada + mesmas regras = mesma decisão.</span><button id="optBulkBtn" class="opt-btn gold">Otimizar selecionados</button></div>
  </section>
 </div>
 <div class="opt-modal" id="optConfigModal"><div class="opt-modal-card"><div class="opt-modal-head"><div><h2>Configurar otimização</h2><p>Premissas persistidas no backend. Nenhuma decisão usa IA.</p></div><button class="opt-btn" data-close="optConfigModal">×</button></div><div class="opt-modal-body" id="optConfigBody"></div><div class="opt-modal-foot"><button class="opt-btn" data-close="optConfigModal">Cancelar</button><button class="opt-btn gold" id="optSaveConfig">Salvar regras</button></div></div></div>
 <div class="opt-modal" id="optDetailModal"><div class="opt-modal-card"><div class="opt-modal-head"><div><h2>Detalhamento da nota</h2><p id="optDetailSubtitle"></p></div><button class="opt-btn" data-close="optDetailModal">×</button></div><div class="opt-modal-body" id="optDetailBody"></div><div class="opt-modal-foot"><button class="opt-btn" data-close="optDetailModal">Cancelar</button><button class="opt-btn gold" id="optExecuteBtn">Aprovar e otimizar</button></div></div></div>`;
 bindShell();
}
function headPair(group,a,b,ka,kb){return `<th colspan="2" class="opt-group-head"><div class="opt-head-pair"><div class="opt-head-item" data-sort="${ka}"><small>${group}</small><b>${a}</b></div><div class="opt-head-sep"></div><div class="opt-head-item" data-sort="${kb}"><small>${group}</small><b>${b}</b></div></div></th>`}
function bindShell(){
 qa('.opt-period').forEach(b=>b.onclick=()=>{O.period=b.dataset.period;qa('.opt-period').forEach(x=>x.classList.toggle('active',x===b));renderTable()});
 q('#optSort').onchange=e=>{O.sort=e.target.value;O.sortDir=['cpl','cac'].includes(O.sort)?'asc':'desc';renderTable()};
 qa('[data-sort]').forEach(h=>h.onclick=()=>{const k=h.dataset.sort;if(O.sort===k)O.sortDir=O.sortDir==='desc'?'asc':'desc';else{O.sort=k;O.sortDir=['name','rank','cpl','cpaAppointment','cpaMeeting1','cpaMeeting2','cac'].includes(k)?'asc':'desc'}renderTable()});
 const fset=()=>{O.f={q:q('#optSearch').value,impr:q('#optImpr').checked,camp:q('#optFCamp').value,set:q('#optFSet').value,ad:q('#optFAd').value,acct:q('#optFAcct').value};renderTable()};
 q('#optSearch').oninput=fset;['#optImpr','#optFCamp','#optFSet','#optFAd','#optFAcct'].forEach(id=>q(id).onchange=fset);
 ['#optFCamp','#optFSet','#optFAd'].forEach(id=>q(id).value='active');
 q('#optClearFilters').onclick=()=>{q('#optSearch').value='';q('#optImpr').checked=false;['#optFCamp','#optFSet','#optFAd'].forEach(id=>q(id).value='active');q('#optFAcct').value='';fset()};
 q('#optAccountFilter').onchange=e=>{O.accountId=e.target.value;loadData()};
 q('#optConfigBtn').onclick=()=>openConfig();
 q('#optSyncBtn').onclick=syncNow;
 q('#optBulkBtn').onclick=bulkExecute;
 q('#optSaveConfig').onclick=saveConfig;
 q('#optExecuteBtn').onclick=executeDetail;
 qa('[data-close]').forEach(b=>b.onclick=()=>q('#'+b.dataset.close).classList.remove('show'));
 qa('.opt-modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('show')}));
}
async function loadConfig(){
 O.config=await apiOpt('/api/optimization/config');
 if(!O.config.segments?.some(x=>x.segment_key===O.segment))O.segment=O.config.segments?.[0]?.segment_key||'GERAL';
 renderSegments();
}
async function loadData(){
 try{
  q('#optTableBody').innerHTML='<tr><td colspan="20"><div class="opt-empty">Carregando dados e regras…</div></td></tr>';
  const p=new URLSearchParams({segment:O.segment});if(window.RCPeriod){const G=RCPeriod.get();p.set('since',G.since);p.set('until',G.until)}if(O.accountId)p.set('account_id',O.accountId);
  O.data=await apiOpt('/api/optimization/data?'+p.toString());
  renderAll();
 }catch(e){q('#optTableBody').innerHTML=`<tr><td colspan="20"><div class="opt-empty">${esc(e.message)}</div></td></tr>`;if(window.toast)toast(e.message)}
}
function renderAll(){renderSegments();renderAccounts();renderHealth();renderOverview();renderSummary();renderTable();q('#optSyncLabel').textContent=O.data?.lastUpdated?`Atualizado ${new Date(O.data.lastUpdated).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`:'Atualizado —'}
function renderSegments(){
 const box=q('#optSegments');if(!box||!O.config)return;
 box.innerHTML=(O.config.segments||[]).map(s=>`<button class="opt-seg ${s.segment_key===O.segment?'active':''}" data-seg="${esc(s.segment_key)}">${esc(s.label)}</button>`).join('')+`<button class="opt-seg add" id="optAddSeg">+ Segmentação</button>`;
 qa('[data-seg]',box).forEach(b=>b.onclick=()=>{O.segment=b.dataset.seg;O.selected.clear();loadData()});q('#optAddSeg').onclick=addSegment;
}
function renderAccounts(){
 const sel=q('#optAccountFilter');if(!sel||!O.data)return;const cur=O.accountId;
 sel.innerHTML='<option value="">Todas as contas</option>'+(O.data.accounts||[]).map(a=>`<option value="${esc(a.id)}">${esc(a.name)} • ${esc(a.currency||'')}</option>`).join('');sel.value=cur;
}
function deltaEl(id,value,inverse=false){const el=q(id);if(!el)return;const v=Number(value||0),good=inverse?v<=0:v>=0;el.className='opt-delta '+(Math.abs(v)<5?'warn':good?'good':'bad');el.textContent=`${v>=0?'↑':'↓'} ${pct(Math.abs(v))}`}
function renderHealth(){
 const o=O.data?.overview||{};q('#optHGoal').textContent=o.dailyGoal!=null?`${n(o.dailyGoal)} leads`:'—';q('#optHPace').textContent=o.pace!=null?`${n(o.pace)} leads`:'—';deltaEl('#optHLeadDelta',o.dailyGoal?100*(o.pace-o.dailyGoal)/o.dailyGoal:0);
 q('#optHExpected').textContent=brl(o.expectedSpend);q('#optHSpend').textContent=brl(o.spend);deltaEl('#optHSpendDelta',o.expectedSpend?100*(o.spend-o.expectedSpend)/o.expectedSpend:0);
 q('#optHTarget').textContent=brl(o.cplTarget);q('#optHCurrent').textContent=brl(o.currentCpl);deltaEl('#optHCplDelta',o.cplTarget&&o.currentCpl?100*(o.currentCpl-o.cplTarget)/o.cplTarget:0,true);
}
function pairCard(aLabel,aVal,aSrc,aSub,bLabel,bVal,bSrc,bSub,editA='',editB='',progress=''){return `<article class="opt-card"><div class="opt-pair" style="margin:0"><div class="opt-metric"><div class="opt-label">${aLabel}<span class="opt-source">${aSrc}</span></div><div class="opt-value ${editA?'opt-editable':''}" ${editA?`data-edit="${editA}"`:''}>${aVal}</div><div class="opt-sub">${aSub||''}</div></div><div class="opt-vline"></div><div class="opt-metric"><div class="opt-label">${bLabel}<span class="opt-source">${bSrc}</span></div><div class="opt-value ${editB?'opt-editable':''}" ${editB?`data-edit="${editB}"`:''}>${bVal}</div>${progress||''}<div class="opt-sub">${bSub||''}</div></div></div></article>`}
function renderOverview(){
 const o=O.data?.overview||{},box=q('#optOverview');if(!box)return;const used=Math.max(0,Math.min(100,Number(o.usedPct||0)));
 box.innerHTML=
 pairCard('Orçamento',brl(o.budget),'EDITÁVEL','Planejamento mensal.','Meta leads',n(o.leadTarget),'EDITÁVEL','Meta mensal.','budget','lead_target')+
 pairCard('Gasto',brl(o.spend),'META API','Consolidado em BRL.','Disponível',brl(o.available),'CÁLCULO',`${pct(used)} utilizado.`,'','',`<div class="opt-progress"><i style="width:${used}%"></i></div>`)+
 pairCard('CPL atual',brl(o.currentCpl),'CÁLCULO','Gasto ÷ leads.','CPL alvo',brl(o.cplTarget),'EDITÁVEL','Premissa da nota.','','cpl_target')+
 pairCard('Gerados',n(o.leads),'CRM/META','Leads atribuídos.','Faltantes',n(o.missing),'CÁLCULO','Meta menos gerados.')+
 pairCard('Meta / dia',o.dailyGoal!=null?`${n(o.dailyGoal)}/dia`:'—','CÁLCULO','Faltantes ÷ dias restantes.','Ritmo atual',o.pace!=null?`${n(o.pace)}/dia`:'—','DADOS','Média até hoje.');
 qa('[data-edit]',box).forEach(x=>x.ondblclick=()=>openConfig(x.dataset.edit));
 // Um card por segmentação (mês corrente), na sequência orçamento → leads → ritmo → CPL. Clique abre a segmentação.
 const segs=O.data?.segmentsOverview||[];if(segs.length){const row=(l,v,sub='',cls='')=>`<div class="opt-sc-row ${cls}"><span>${l}</span><b>${v}</b>${sub?`<small>${sub}</small>`:''}</div>`;
  box.insertAdjacentHTML('afterbegin',`<div class="opt-segcards">${segs.map(g=>{const used=Math.max(0,Math.min(100,g.usedPct||0)),over=g.budget&&g.spend>g.expectedSpend,cplBad=g.cplTarget&&g.currentCpl&&g.currentCpl>g.cplTarget,paceBad=g.dailyGoal!=null&&g.pace<g.dailyGoal;
   return `<article class="opt-segcard ${g.segment_key===O.segment?'active':''}" data-segcard="${esc(g.segment_key)}"><header><strong>${esc(g.label)}</strong><small>${n(g.creatives)} criativos no mês</small></header>
   <div class="opt-sc-block"><em>1 · Orçamento</em>${row('Orçamento',g.budget?brl(g.budget):'Defina a meta')}${row('Gasto',brl(g.spend),g.budget?`esperado até hoje ${brl(g.expectedSpend)}`:'',over?'warn':'')}${row('Disponível',g.budget?brl(g.available):'—',g.budget?`${pct(used)} usado`:'')}${g.budget?`<div class="opt-progress"><i style="width:${used}%"></i></div>`:''}</div>
   <div class="opt-sc-block"><em>2 · Leads</em>${row('Meta de leads',g.leadTarget?n(g.leadTarget):'Defina a meta')}${row('Gerados',n(g.leads))}${row('Faltantes',g.leadTarget?n(g.missing):'—')}</div>
   <div class="opt-sc-block"><em>3 · Ritmo</em>${row('Meta por dia',g.dailyGoal!=null?`${n(g.dailyGoal)}/dia`:'—')}${row('Ritmo atual',`${n(g.pace)}/dia`,'',paceBad?'warn':'')}</div>
   <div class="opt-sc-block"><em>4 · Eficiência</em>${row('CPL alvo',brl(g.cplTarget))}${row('CPL atual',g.currentCpl!=null?brl(g.currentCpl):'—','',cplBad?'warn':'ok')}</div></article>`}).join('')}</div>`);
  qa('[data-segcard]',box).forEach(c=>c.onclick=()=>{const b=q(`[data-seg="${c.dataset.segcard}"]`);if(b)b.click()})}
}
function renderSummary(){
 const rows=O.data?.creatives||[],eligible=rows.filter(r=>r.sampleEligible).length,actions=rows.reduce((m,r)=>(m[r.action]=(m[r.action]||0)+1,m),{});
 q('#optSummary').innerHTML=`<span class="opt-chip gold">${rows.length} criativos</span><span class="opt-chip good">${eligible} elegíveis</span><span class="opt-chip">${actions.ESCALAR||0} escalar</span><span class="opt-chip">${actions.MANTER||0} manter</span><span class="opt-chip gold">${actions.REDUZIR||0} reduzir</span><span class="opt-chip bad">${actions.PAUSAR||0} pausar</span><span class="opt-chip">${actions.AGUARDAR||0} aguardar</span>`;
}
function periodObj(r){return r.periods?.[O.period]||{}}
function aggMetrics(rows){
 const x={spend:0,leads:0,impressions:0,appointments:0,meeting1:0,meeting2:0,sales:0};rows.forEach(r=>{const p=periodObj(r);Object.keys(x).forEach(k=>x[k]+=Number(p[k]||0))});return enrich(x);
}
function enrich(x){x.cpl=x.leads?x.spend/x.leads:null;x.cpaAppointment=x.appointments?x.spend/x.appointments:null;x.cpaMeeting1=x.meeting1?x.spend/x.meeting1:null;x.cpaMeeting2=x.meeting2?x.spend/x.meeting2:null;x.cac=x.sales?x.spend/x.sales:null;return x}
function sortedCreatives(){
 let rows=[...(O.data?.creatives||[])];rows.sort((a,b)=>{const A=periodObj(a),B=periodObj(b);if(O.sort==='cpl')return (A.cpl??1e12)-(B.cpl??1e12);if(O.sort==='spend')return B.spend-A.spend;if(O.sort==='leads')return B.leads-A.leads;if(O.sort==='sales')return B.sales-A.sales;if(O.sort==='cac')return (A.cac??1e12)-(B.cac??1e12);return (b.score??-1)-(a.score??-1)});return rows;
}
function renderTable(){
 const body=q('#optTableBody');if(!body||!O.data)return;const all=O.data.creatives||[],rows=filterRows(all);fillAcctFilter(all);paintSortHeads();const fc=q('#optFilterCount');if(fc)fc.textContent=rows.length===all.length?`${n(all.length)} criativos`:`${n(rows.length)} de ${n(all.length)} criativos`;if(!rows.length){body.innerHTML=`<tr><td colspan="20"><div class="opt-empty">${all.length?'Nenhum criativo com estes filtros.':'Nenhum criativo encontrado para esta segmentação.'}</div></td></tr>`;return}
 const campaigns=new Map();for(const r of rows){const ck=r.campaignId||r.campaignName||'sem-campanha',sk=r.adsetId||r.adsetName||'sem-conjunto';if(!campaigns.has(ck))campaigns.set(ck,{name:r.campaignName||ck,rows:[],sets:new Map()});const c=campaigns.get(ck);c.rows.push(r);if(!c.sets.has(sk))c.sets.set(sk,{name:r.adsetName||sk,rows:[]});c.sets.get(sk).rows.push(r)}
 let html='';const camps=[...campaigns.values()].map(c=>({...c,m:aggMetrics(c.rows),setList:[...c.sets.values()].map(x=>({...x,m:aggMetrics(x.rows)}))})).sort((a,b)=>cmp(groupVal(a,O.sort),groupVal(b,O.sort))||b.m.spend-a.m.spend);
 for(const c of camps){html+=groupRow('campaign',c.name,`${stLabel(c.rows[0]?.campaignStatus)}${c.rows.length} criativo(s)`,c.m,{id:c.rows[0]?.campaignId,accountId:c.rows[0]?.accountId,accountName:c.rows[0]?.accountName});for(const s of c.setList.sort((a,b)=>cmp(groupVal(a,O.sort),groupVal(b,O.sort))||b.m.spend-a.m.spend)){html+=groupRow('adset',s.name,`${stLabel(s.rows[0]?.adsetStatus)}${c.name}`,s.m,{id:s.rows[0]?.adsetId,accountId:s.rows[0]?.accountId,accountName:s.rows[0]?.accountName});for(const r of s.rows.sort((a,b)=>cmp(sortVal(a,O.sort),sortVal(b,O.sort))||Number(periodObj(b).spend||0)-Number(periodObj(a).spend||0)))html+=creativeRow(r)}}html+=groupRow('total','TOTAL',`${n(rows.length)} criativo(s) · ${n(camps.length)} campanha(s)`,aggMetrics(rows));body.innerHTML=html;
 qa('.opt-check',body).forEach(ch=>{ch.checked=O.selected.has(ch.value);ch.onchange=()=>ch.checked?O.selected.add(ch.value):O.selected.delete(ch.value)});
 qa('[data-detail]',body).forEach(b=>b.onclick=()=>openDetail(b.dataset.detail));
}
function metricCells(m,adId){const L=(k,v)=>adId&&Number(v)>0?`<span class="opt-cell-main opt-leadlink" data-ad="${esc(adId)}" data-kind="${k}" tabindex="0">${n(v)}</span>`:`<span class="opt-cell-main">${n(v)}</span>`;return `<td><span class="opt-cell-main">${brl(m.budget)}</span>${m.budgetSub?`<span class="opt-cell-sub">${esc(m.budgetSub)}</span>`:''}</td><td><span class="opt-cell-main">${brl(m.spend)}</span></td><td>${L('leads',m.leads)}</td><td><span class="opt-cell-main">${brl(m.cpl)}</span></td><td>${L('appointments',m.appointments)}<span class="opt-cell-sub">${pct(rate(m.appointments,m.leads))}</span></td><td>${brl(m.cpaAppointment)}</td><td>${L('meeting1',m.meeting1)}<span class="opt-cell-sub">${pct(rate(m.meeting1,m.appointments))}</span></td><td>${brl(m.cpaMeeting1)}</td><td>${L('meeting2',m.meeting2)}<span class="opt-cell-sub">${pct(rate(m.meeting2,m.meeting1))}</span></td><td>${brl(m.cpaMeeting2)}</td><td>${L('sales',m.sales)}<span class="opt-cell-sub">${pct(rate(m.sales,m.meeting2||m.meeting1))}</span></td><td>${brl(m.cac)}</td>`}
function groupRow(type,name,sub,m,x){x=x||{};m={...m,budget:null};return `<tr class="opt-row-${type}"><td class="sticky-col"><div class="opt-entity ${type==='adset'?'opt-indent-1':''}"><div class="txt"><strong>${esc(name)} ${x.id?amLink(type==='adset'?'adsets':'campaigns',x.accountId,x.id):''}</strong><small>${esc(sub)}</small></div></div></td>${type==='total'?'<td>—</td>':acctCell(x.accountName,x.accountId)}${metricCells(m)}<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`}
function creativeRow(r){
 const p=periodObj(r),owner=r.budgetOwner||{},canAct=['ESCALAR','REDUZIR','PAUSAR'].includes(r.action)&&r.recommendationId;const budget=owner.currentBudget??null,budgetSub=owner.type?`${owner.type==='adset'?'Conjunto':'Campanha'} • ${owner.modifiable?'editável':'somente leitura'}`:'Sem budget owner',m={...p,budget,budgetSub};
 const status=r.optimizationStatus||'SUGESTÃO DISPONÍVEL';return `<tr class="opt-row-ad"><td class="sticky-col"><div class="opt-entity opt-indent-2">${canAct?`<input class="opt-check" type="checkbox" value="${esc(r.recommendationId)}">`:''}${optThumb(r.adId)}<div class="txt"><strong>${esc(r.adName||r.adId)} ${amLink('ads',r.accountId,r.adId)}</strong><small>${stLabel(r.adStatus)}${esc(r.accountName||'')} • ${esc(r.adId)}</small></div></div></td>${acctCell(r.accountName,r.accountId)}${metricCells(m,r.adId)}
 <td><div class="opt-score ${scoreClass(r.score)}" data-break="${esc(JSON.stringify({score:r.score,rows:r.scoreBreakdown||[],reason:r.reason||'',eligible:!!r.sampleEligible}))}" tabindex="0">${r.score==null?'—':Math.round(r.score)}</div></td><td><span class="opt-status ${r.sampleEligible?'done':'pending'}">${r.sampleEligible?'Elegível':'Aguardar'}</span></td><td><span class="opt-rank">${r.rank?`#${r.rank}`:'—'}</span></td><td><span class="opt-action ${actionClass(r.action)}">${esc(r.action||'—')}</span><span class="opt-cell-sub">${esc(r.reason||'')}</span></td><td><span class="opt-budget-suggest">${r.suggestedBudget==null?'—':r.action==='PAUSAR'?'PAUSAR':brl(r.suggestedBudget)}</span></td><td><span class="opt-status ${status==='REALIZADA'?'done':'pending'}">${esc(status)}</span></td><td><button class="opt-btn" data-detail="${esc(r.recommendationId)}">Ver nota</button></td></tr>`;
}
async function syncNow(){
 const b=q('#optSyncBtn');try{b.disabled=true;b.textContent='Sincronizando…';const r=await apiOpt('/api/optimization/sync',{method:'POST',body:JSON.stringify({})});if(window.toast)toast(r.message||'Base sincronizada.');await loadData()}catch(e){if(window.toast)toast(e.message)}finally{b.disabled=false;b.textContent='↻ Sincronizar e recalcular'}
}
async function openConfig(focus=''){
 if(!O.config)await loadConfig();renderConfig(focus);q('#optConfigModal').classList.add('show');
 try{if(!O.pipelines.length){const j=await apiOpt('/api/crm/pipelines');O.pipelines=j.pipelines||[];renderStageMapping()}}catch(e){const box=q('#optStageMap');if(box)box.innerHTML=`<div class="opt-help">PipeRun indisponível: ${esc(e.message)}</div>`}
}
function currentSeg(){return O.config?.segments?.find(s=>s.segment_key===O.segment)||O.config?.segments?.[0]||{}}
function field(id,label,val,type='number',step='1'){return `<div class="opt-field"><span>${label}</span><input id="${id}" type="${type}" ${type==='number'?`step="${step}"`:''} value="${esc(val??'')}"></div>`}
function renderConfig(focus=''){
 const s=currentSeg(),set=O.config.settings||{},body=q('#optConfigBody');body.innerHTML=`<div class="opt-suggest"><button type="button" class="opt-btn gold" id="optSuggestBtn">Calcular metas pelo histórico (30 dias)</button><span id="optSuggestNote" class="opt-help">Preenche CPL alvo, taxas de conversão, orçamento e meta de leads com os números reais desta segmentação. Revise e salve.</span></div><div id="optSegCount" class="opt-help"></div><div class="opt-grid-3"><div class="opt-field"><span>Segmentação</span><select id="optCfgSegment">${(O.config.segments||[]).map(x=>`<option value="${esc(x.segment_key)}" ${x.segment_key===s.segment_key?'selected':''}>${esc(x.label)}</option>`).join('')}</select></div>${field('optCfgLabel','Nome',s.label,'text')}${field('optCfgContains','Nome contém',s.name_contains,'text')}${field('optCfgBudget','Orçamento mensal',s.budget,'number','.01')}${field('optCfgLeadTarget','Meta de leads',s.lead_target)}${field('optCfgCpl','CPL alvo',s.cpl_target,'number','.01')}</div>
 <div class="opt-section"><h3>Amostra e proteção</h3><div class="opt-grid-4">${field('optCfgMinSpend','Gasto mínimo',s.min_spend,'number','.01')}${field('optCfgMinLeads','Leads mínimos',s.min_leads)}${field('optCfgMinHours','Horas mínimas',s.min_hours)}${field('optCfgMinImpr','Impressões mínimas',s.min_impressions)}${field('optCfgFat','Gordura sem lead',s.zero_lead_extra_spend,'number','.01')}${field('optCfgInc','Aumento máximo %',s.max_increase_pct,'number','.1')}${field('optCfgDec','Redução máxima %',s.max_decrease_pct,'number','.1')}<div class="opt-field"><span>Cascade pause</span><select id="optCfgCascade"><option value="1" ${Number(s.cascade_pause)!==0?'selected':''}>Ativo</option><option value="0" ${Number(s.cascade_pause)===0?'selected':''}>Desativo</option></select></div></div></div>
 <div class="opt-section"><h3>Faixas de decisão</h3><div class="opt-grid-3">${field('optCfgScale','Escalar a partir de',s.scale_threshold,'number','.1')}${field('optCfgMaintain','Manter a partir de',s.maintain_threshold,'number','.1')}${field('optCfgReduce','Reduzir a partir de',s.reduce_threshold,'number','.1')}</div></div>
 <div class="opt-section"><h3>Pesos da nota</h3><div class="opt-grid-3">${field('optWCpl','CPL',s.weight_cpl,'number','.1')}${field('optWVolume','Volume',s.weight_volume,'number','.1')}${field('optWAppt','Lead → Agendamento',s.weight_appointment,'number','.1')}${field('optWM1','Agendamento → 1ª reunião',s.weight_meeting1,'number','.1')}${field('optWM2','1ª → 2ª reunião',s.weight_meeting2,'number','.1')}${field('optWSale','2ª reunião → Venda',s.weight_sale,'number','.1')}</div></div>
 <div class="opt-section"><h3>Metas de conversão</h3><div class="opt-grid-4">${field('optTAppt','Lead → Agendamento %',s.target_appointment_rate,'number','.1')}${field('optTM1','Agendamento → 1ª reunião %',s.target_meeting1_rate,'number','.1')}${field('optTM2','1ª → 2ª reunião %',s.target_meeting2_rate,'number','.1')}${field('optTSale','2ª reunião → Venda %',s.target_sale_rate,'number','.1')}</div></div>
 <div class="opt-section"><h3>Recência e moeda</h3><div class="opt-grid-4">${field('optW1d','Peso 1 dia',s.weight_1d,'number','.1')}${field('optW7d','Peso 7 dias',s.weight_7d,'number','.1')}${field('optW30d','Peso 30 dias',s.weight_30d,'number','.1')}${field('optUsdRate','USD → BRL',set.usdBrlRate??5.45,'number','.0001')}</div><p class="opt-help">Pesos válidos são redistribuídos entre janelas com amostra suficiente. A cotação é uma premissa explícita e auditável.</p></div>
 <div class="opt-section"><h3>Mapeamento de etapas PipeRun</h3><div id="optStageMap"><div class="opt-help">Carregando pipelines e etapas…</div></div></div>`;
 q('#optCfgSegment').onchange=e=>{O.segment=e.target.value;renderConfig();renderStageMapping()};
 if(focus){const map={budget:'optCfgBudget',lead_target:'optCfgLeadTarget',cpl_target:'optCfgCpl'};setTimeout(()=>q('#'+(map[focus]||''))?.focus(),30)}
 renderStageMapping();
 q('#optSuggestBtn').onclick=suggestTargets;const cnt=()=>{const el=q('#optSegCount');if(el)el.textContent=segCount(val('optCfgContains'))};q('#optCfgContains')?.addEventListener('input',cnt);cnt();
}
function flattenStages(){const m=new Map();(O.pipelines||[]).forEach(p=>(p.stages||[]).forEach(s=>m.set(String(s.id),{id:String(s.id),name:s.name||String(s.id),pipeline:p.name||p.id})));return [...m.values()]}
function renderStageMapping(){
 const box=q('#optStageMap');if(!box)return;const stages=flattenStages(),map=O.config?.stageMapping||{};if(!stages.length){box.innerHTML='<div class="opt-help">Conecte o PipeRun e selecione os pipelines nas configurações principais para mapear as etapas.</div>';return}
 const groups=[['appointment','Agendamento'],['meeting1','1ª reunião'],['meeting2','2ª reunião'],['sale','Venda']];box.innerHTML=`<div class="opt-stage-map">${groups.map(([key,label])=>`<div class="opt-stage-box"><strong>${label}</strong>${stages.map(st=>`<label class="opt-stage-option"><input type="checkbox" data-stage-key="${key}" value="${esc(st.id)}" ${(map[key]||[]).map(String).includes(String(st.id))?'checked':''}><span>${esc(st.name)} <small>• ${esc(st.pipeline)}</small></span></label>`).join('')}</div>`).join('')}</div>`;
}
function val(id){return q('#'+id)?.value??''}function numVal(id){return Number(val(id)||0)}
async function saveConfig(){
 const s=currentSeg(),segment={...s,segment_key:O.segment,label:val('optCfgLabel').trim()||s.label,name_contains:val('optCfgContains').trim(),budget:numVal('optCfgBudget'),lead_target:numVal('optCfgLeadTarget'),cpl_target:numVal('optCfgCpl'),min_spend:numVal('optCfgMinSpend'),min_leads:numVal('optCfgMinLeads'),min_hours:numVal('optCfgMinHours'),min_impressions:numVal('optCfgMinImpr'),zero_lead_extra_spend:numVal('optCfgFat'),max_increase_pct:numVal('optCfgInc'),max_decrease_pct:numVal('optCfgDec'),cascade_pause:numVal('optCfgCascade'),scale_threshold:numVal('optCfgScale'),maintain_threshold:numVal('optCfgMaintain'),reduce_threshold:numVal('optCfgReduce'),weight_cpl:numVal('optWCpl'),weight_volume:numVal('optWVolume'),weight_appointment:numVal('optWAppt'),weight_meeting1:numVal('optWM1'),weight_meeting2:numVal('optWM2'),weight_sale:numVal('optWSale'),target_appointment_rate:numVal('optTAppt'),target_meeting1_rate:numVal('optTM1'),target_meeting2_rate:numVal('optTM2'),target_sale_rate:numVal('optTSale'),weight_1d:numVal('optW1d'),weight_7d:numVal('optW7d'),weight_30d:numVal('optW30d')};
 const stageMapping={};['appointment','meeting1','meeting2','sale'].forEach(k=>stageMapping[k]=qa(`[data-stage-key="${k}"]:checked`).map(x=>x.value));
 try{await apiOpt('/api/optimization/config',{method:'POST',body:JSON.stringify({segment,settings:{usdBrlRate:numVal('optUsdRate')},stageMapping})});q('#optConfigModal').classList.remove('show');await loadConfig();await loadData();if(window.toast)toast('Regras de otimização salvas.')}catch(e){if(window.toast)toast(e.message)}
}
async function addSegment(){
 const label=prompt('Nome da segmentação:');if(!label)return;const contains=prompt('Nome contém:');if(contains==null)return;const key=label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,'')||('SEG_'+Date.now());
 try{await apiOpt('/api/optimization/config',{method:'POST',body:JSON.stringify({createSegment:{segment_key:key,label,name_contains:contains}})});O.segment=key;await loadConfig();await loadData();if(window.toast)toast('Segmentação criada.')}catch(e){if(window.toast)toast(e.message)}
}
function findRec(id){return (O.data?.creatives||[]).find(x=>String(x.recommendationId)===String(id))}
function openDetail(id){
 const r=findRec(id);if(!r)return;O.detail=r;q('#optDetailSubtitle').textContent=`${r.campaignName} • ${r.adsetName} • ${r.adName}`;
 const owner=r.budgetOwner||{},body=q('#optDetailBody');body.innerHTML=`<div class="opt-confirm-grid"><div class="opt-confirm-card"><span>Nota operacional</span><b>${r.score==null?'—':d(r.score)+'/100'}</b></div><div class="opt-confirm-card"><span>Ranking</span><b>${r.rank?`#${r.rank}`:'—'}</b></div><div class="opt-confirm-card"><span>Orçamento atual</span><b>${brl(owner.currentBudget)}</b></div><div class="opt-confirm-card"><span>Orçamento sugerido</span><b>${r.action==='PAUSAR'?'PAUSAR':brl(r.suggestedBudget)}</b></div></div>
 <div class="opt-breakdown"><div class="opt-break-row head"><span>Critério</span><span>Nota</span><span>Peso</span><span>Contribuição</span></div>${(r.scoreBreakdown||[]).map(x=>`<div class="opt-break-row"><span>${esc(x.label)}</span><b>${d(x.score)}</b><b>${d(x.weight)}</b><b class="gold">${d(x.contribution)}</b></div>`).join('')}</div>
 <div class="opt-rule-note"><strong>Ação: ${esc(r.action)}</strong><br>${esc(r.reason||'')}.<br>Budget owner: ${esc(owner.type||'—')} ${esc(owner.name||owner.id||'')} ${owner.field?`• ${esc(owner.field)}`:''}.<br>Janelas válidas: ${esc((r.validWindows||[]).join(', ')||'nenhuma')}.</div>`;
 q('#optExecuteBtn').disabled=!['ESCALAR','REDUZIR','PAUSAR'].includes(r.action)||!r.recommendationId;q('#optDetailModal').classList.add('show');
}
async function executeDetail(){if(!O.detail)return;await executeRecommendation(O.detail.recommendationId)}
async function executeRecommendation(id){
 const r=findRec(id);if(!r)return;const msg=r.action==='PAUSAR'?`Confirmar pausa do criativo "${r.adName}"?`:`Confirmar ${r.action.toLowerCase()} do orçamento de ${brl(r.budgetOwner?.currentBudget)} para ${brl(r.suggestedBudget)}?`;if(!confirm(msg))return;
 try{q('#optExecuteBtn').disabled=true;const key=crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`;const out=await apiOpt('/api/optimization/execute',{method:'POST',body:JSON.stringify({recommendationId:id,idempotencyKey:key})});q('#optDetailModal').classList.remove('show');if(window.toast)toast(out.message||'Otimização realizada.');await loadData()}catch(e){if(window.toast)toast(e.message)}finally{q('#optExecuteBtn').disabled=false}
}
async function bulkExecute(){
 const ids=[...O.selected];if(!ids.length){if(window.toast)toast('Selecione ao menos um criativo elegível.');return}const rows=ids.map(findRec).filter(Boolean),summary=rows.reduce((m,r)=>(m[r.action]=(m[r.action]||0)+1,m),{});if(!confirm(`Confirmar ${rows.length} alterações? ${summary.ESCALAR||0} escalar, ${summary.REDUZIR||0} reduzir, ${summary.PAUSAR||0} pausar.`))return;
 const b=q('#optBulkBtn');b.disabled=true;let ok=0,fail=0;for(const id of ids){try{await apiOpt('/api/optimization/execute',{method:'POST',body:JSON.stringify({recommendationId:id,idempotencyKey:(crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`)})});ok++}catch{fail++}}O.selected.clear();b.disabled=false;if(window.toast)toast(`${ok} otimização(ões) realizadas${fail?` • ${fail} falha(s)`:''}.`);await loadData();
}
async function activate(){if(!q('#optimizationApp'))return;if(!O.booted){shell();O.booted=true}try{await loadConfig();await loadData()}catch(e){if(window.toast)toast(e.message)}}
window.activateOptimization=activate;
window.addEventListener('load',()=>{qa('.nav-btn').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.page==='optimization')setTimeout(activate,0)}));if(q('#page-optimization')?.classList.contains('active'))activate()});

/* ---------- Ordenação por coluna e filtros ---------- */
const ACTION_ORDER={ESCALAR:5,MANTER:4,REDUZIR:3,PAUSAR:2,AGUARDAR:1};
const normTxt=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const isActiveSt=v=>['ACTIVE','IN_PROCESS','WITH_ISSUES','PENDING_REVIEW','PREAPPROVED'].includes(String(v||'').toUpperCase());
function stLabel(v){if(!v)return'';return isActiveSt(v)?'● Ativo · ':'○ Pausado · '}
function statusOk(sel,v){if(!sel)return true;if(!v)return false;return sel==='active'?isActiveSt(v):!isActiveSt(v)}
function filterRows(rows){const f=O.f||{},term=normTxt(f.q).trim();return rows.filter(r=>{if(f.acct&&String(r.accountId)!==f.acct)return false;if(f.impr&&!(Number(periodObj(r).impressions||0)>0))return false;if(term&&!normTxt(`${r.campaignName} ${r.adsetName} ${r.adName} ${r.adId}`).includes(term))return false;const ad=String(r.adStatus||'').toUpperCase(),camp=r.campaignStatus||(ad==='CAMPAIGN_PAUSED'?'PAUSED':isActiveSt(ad)||ad==='ADSET_PAUSED'?'ACTIVE':''),set=r.adsetStatus||(ad==='ADSET_PAUSED'||ad==='CAMPAIGN_PAUSED'?'PAUSED':isActiveSt(ad)?'ACTIVE':'');return statusOk(f.camp,camp)&&statusOk(f.set,set)&&statusOk(f.ad,r.adStatus)})}
function sortVal(r,key){switch(key){case'name':return normTxt(r.adName||r.adId);case'budget':return r.budgetOwner?.currentBudget??null;case'score':return r.score??null;case'rank':return r.rank??null;case'sample':return r.sampleEligible?1:0;case'action':return ACTION_ORDER[r.action]??0;case'suggested':return r.suggestedBudget??null;case'status':return normTxt(r.optimizationStatus);default:{const v=periodObj(r)[key];return v==null||!Number.isFinite(Number(v))?null:Number(v)}}}
function groupVal(g,key){if(key==='name')return normTxt(g.name);if(key in g.m&&key!=='budget')return g.m[key]??null;const vals=g.rows.map(r=>sortVal(r,key)).filter(v=>v!=null);if(!vals.length)return null;if(key==='rank')return Math.min(...vals);if(key==='budget'||key==='suggested')return vals.reduce((a,b)=>a+b,0);return typeof vals[0]==='string'?vals.sort()[0]:Math.max(...vals)}
function cmp(a,b){if(a==null&&b==null)return 0;if(a==null)return 1;if(b==null)return -1;const d=typeof a==='string'?a.localeCompare(b,'pt-BR'):a-b;return O.sortDir==='asc'?d:-d}
function paintSortHeads(){qa('[data-sort]').forEach(h=>{const on=h.dataset.sort===O.sort;h.classList.toggle('sorted',on);h.dataset.dir=on?O.sortDir:''})}
/* Quantas campanhas (com entrega em 30 dias) a regra "nome contém" captura. */
function segCount(rule){const toks=String(rule||'').split(/[,;|]/).map(normTxt).map(x=>x.trim()).filter(Boolean),camps=new Map();(O.data?.creatives||[]).forEach(r=>camps.set(r.campaignId,r));const all=[...camps.values()];if(!toks.length)return `Sem regra: todas as ${all.length} campanhas com entrega.`;const hit=all.filter(r=>toks.some(t=>normTxt([r.campaignName,r.adsetName,r.adName].join(' ')).includes(t)));return `Esta regra captura ${hit.length} de ${all.length} campanhas com entrega nos últimos 30 dias.`}
/* Metas pelo histórico real (30 dias) dos criativos da segmentação aberta. */
function suggestTargets(){const rows=(O.data?.creatives||[]).map(r=>r.periods?.d30||{}),s=k=>rows.reduce((t,x)=>t+Number(x[k]||0),0);const spend=s('spend'),leads=s('leads'),ap=s('appointments'),m1=s('meeting1'),m2=s('meeting2'),sa=s('sales');if(!leads){q('#optSuggestNote').textContent='Sem leads nos últimos 30 dias nesta segmentação.';return}
 const r1=x=>Math.round(x*10)/10,set=(id,v)=>{const el=q('#'+id);if(el&&v!=null&&Number.isFinite(v))el.value=v};set('optCfgCpl',Math.round(spend/leads));set('optTAppt',r1(100*ap/leads));if(ap)set('optTM1',r1(100*m1/ap));if(m1)set('optTM2',r1(100*m2/m1));if(m2||m1)set('optTSale',r1(100*sa/(m2||m1)));set('optCfgBudget',Math.round(spend));set('optCfgLeadTarget',leads);
 q('#optSuggestNote').textContent=`Base 30 dias: R$ ${Math.round(spend).toLocaleString('pt-BR')} · ${leads} leads (CPL R$ ${Math.round(spend/leads)}) · ${ap} agend. · ${m1} 1ª reun. · ${m2} 2ª reun. · ${sa} vendas. Revise e clique em Salvar regras.`}
/* Trocar o período no topo recarrega a Otimização. */
window.addEventListener('rc:period',()=>{if(O.data)loadData()});
// Miniatura do criativo (mesmas imagens que o painel já carrega dos anúncios).
function optThumb(adId){const c=(typeof state!=='undefined'&&state.creativeMeta)?state.creativeMeta.get(String(adId)):null,src=c?.thumbnail_url||c?.image_url||'';return src?`<span class="opt-thumb"><img src="${esc(src)}" alt="" loading="lazy"><img class="big" src="${esc(src)}" alt=""></span>`:'<span class="opt-thumb none" title="Sem prévia carregada">▢</span>'}
// Datas da janela escolhida na Otimização (hoje, ontem, 7d, 30d, mês, personalizado).
window.optPeriodRange=function(){const pad=x=>String(x).padStart(2,'0'),iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,ago=k=>{const d=new Date();d.setDate(d.getDate()-k);return iso(d)},t=iso(new Date()),p=O.period;
 if(p==='today')return{since:t,until:t};if(p==='yesterday')return{since:ago(1),until:ago(1)};if(p==='d7')return{since:ago(6),until:t};if(p==='d30')return{since:ago(29),until:t};if(p==='month')return{since:t.slice(0,8)+'01',until:t};
 const G=window.RCPeriod?RCPeriod.get():{since:ago(29),until:t};return{since:G.since,until:G.until}};
// Conta de anúncios: coluna, filtro e atalho para editar no Gerenciador de Anúncios (abre em nova aba).
function amLink(level,accountId,id){const act=String(accountId||'').replace(/^act_/,'');if(!act||!id)return'';const one={campaigns:'campaign',adsets:'adset',ads:'ad'}[level];const href=`https://adsmanager.facebook.com/adsmanager/manage/${level}/edit?act=${encodeURIComponent(act)}&selected_${one}_ids=${encodeURIComponent(id)}`;return `<a class="opt-am" href="${esc(href)}" target="_blank" rel="noopener" title="Abrir e editar no Gerenciador de Anúncios" onclick="event.stopPropagation()">↗</a>`}
function acctCell(name,id){return `<td class="opt-acct"><span title="${esc(id||'')}">${esc(name||id||'—')}</span></td>`}
function fillAcctFilter(all){const sel=q('#optFAcct');if(!sel)return;const cur=sel.value,map=new Map();for(const r of all)if(r.accountId)map.set(String(r.accountId),r.accountName||r.accountId);const html='<option value="">Contas: todas</option>'+[...map].sort((a,b)=>String(a[1]).localeCompare(String(b[1]))).map(([id,nm])=>`<option value="${esc(id)}"${id===cur?' selected':''}>${esc(nm)}</option>`).join('');if(sel.dataset.h!==html){sel.innerHTML=html;sel.dataset.h=html;sel.value=map.has(cur)?cur:''}}
})();
