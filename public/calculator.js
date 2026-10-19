const calculatorState={
  initialized:false,
  baselinePeriod:'6m',
  baselineView:'daily',
  baseline:null,
  daily:[],
  dailyMetaPresent:false,
  dailyCrmPresent:false,
  historyCache:new Map(),
  actualOverrides:{},
  projection:{
    investment:30000,
    cpl:30,
    leadMode:'auto',
    manualLeads:1000,
    leadToAppointment:30,
    appointmentToShow:80,
    showToProposal:40,
    proposalToSale:30,
    ticket:100000
  }
};

function calculatorMoney(value,digits=0){
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value||0));
}
function calculatorNumber(value,digits=0){
  return new Intl.NumberFormat('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(Number(value||0));
}
function calculatorPercent(value,digits=1){return `${calculatorNumber(value,digits)}%`;}
function calculatorIsoLocal(date){
  const y=date.getFullYear(),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function calculatorEscape(value){
  return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function calculatorDaysInMonth(year,monthIndex){return new Date(year,monthIndex+1,0).getDate();}
function calculatorBusinessDays(year,monthIndex,from=1,to=null){
  const end=to??calculatorDaysInMonth(year,monthIndex);let count=0;
  for(let day=from;day<=end;day++){const wd=new Date(year,monthIndex,day).getDay();if(wd!==0&&wd!==6)count++;}
  return count;
}
function calculatorSelectedPeriod(){
  const month=Number(document.querySelector('#calculatorMonth')?.value||new Date().getMonth()+1);
  const year=Number(document.querySelector('#calculatorYear')?.value||new Date().getFullYear());
  return {year,month,monthIndex:month-1,key:`${year}-${String(month).padStart(2,'0')}`};
}
function calculatorCalendar(){
  const {year,monthIndex}=calculatorSelectedPeriod(),today=new Date(),total=calculatorDaysInMonth(year,monthIndex);
  const monthEnd=new Date(year,monthIndex,total,23,59,59),monthStart=new Date(year,monthIndex,1);
  let passed=0;
  if(today>=monthStart&&today<=monthEnd)passed=Math.min(today.getDate(),total);
  else if(today>monthEnd)passed=total;
  const usefulTotal=calculatorBusinessDays(year,monthIndex);
  const usefulPassed=passed?calculatorBusinessDays(year,monthIndex,1,passed):0;
  return{
    total,passed,remaining:Math.max(total-passed,0),
    usefulTotal,usefulPassed,usefulRemaining:Math.max(usefulTotal-usefulPassed,0)
  };
}
async function calculatorServiceHistory(since,until){
  const key=`${since}|${until}`;
  if(calculatorState.historyCache.has(key))return calculatorState.historyCache.get(key);
  const request=(async()=>{
    if(window.historyHybridFetch)return await window.historyHybridFetch(since,until);
    const response=await fetch(`/api/history?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`,{headers:{accept:'application/json'}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.error)throw new Error(data.error||`HTTP ${response.status}`);
    return data;
  })();
  calculatorState.historyCache.set(key,request);
  try{return await request}catch(error){calculatorState.historyCache.delete(key);throw error;}
}
function calculatorHistoryRange(period){
  if(period==='custom'){
    const fallbackUntil=new Date(),fallbackSince=new Date(fallbackUntil);
    fallbackSince.setDate(fallbackUntil.getDate()-29);
    const since=calculatorState.baselineCustomSince||calculatorIsoLocal(fallbackSince);
    const until=calculatorState.baselineCustomUntil||calculatorIsoLocal(fallbackUntil);
    const start=new Date(`${since}T12:00:00`),end=new Date(`${until}T12:00:00`);
    const days=Math.max(1,Math.round((end-start)/8640000)+1);
    return{since,until,days};
  }
  const days=period==='30d'?30:period==='3m'?90:180;
  const until=new Date(),since=new Date(until);
  since.setDate(until.getDate()-(days-1));
  return{since:calculatorIsoLocal(since),until:calculatorIsoLocal(until),days};
}
function calculatorAggregateHistory(payload,period){
  const meta=Array.isArray(payload?.metaDaily)?payload.metaDaily:[];
  const crm=Array.isArray(payload?.crmDaily)?payload.crmDaily:[];
  const dateSet=new Set(),metaDateSet=new Set(),monthSet=new Set();
  let investment=0,leads=0,appointments=0,shows=0,proposals=0,sales=0,revenue=0;
  meta.forEach(row=>{
    const day=String(row.day||'');if(day){dateSet.add(day);metaDateSet.add(day);monthSet.add(day.slice(0,7));}
    investment+=Number(row.spend||0);leads+=Number(row.leads||0);
  });
  crm.forEach(row=>{
    const day=String(row.day||'');if(day){dateSet.add(day);monthSet.add(day.slice(0,7));}
    appointments+=Number(row.appointments||0);
    shows+=Number(row.meetings||0);
    proposals+=Number(row.meeting2||0);
    sales+=Number(row.wins||0);
    revenue+=Number(row.revenue||0);
  });
  const dates=[...dateSet].sort(),metaDates=[...metaDateSet].sort();
  let businessDays=0;
  dates.forEach(day=>{const wd=new Date(`${day}T12:00:00`).getDay();if(wd!==0&&wd!==6)businessDays++;});
  const calendarDays=Math.max(1,metaDates.length||dates.length||0);
  const monthCount=Math.max(1,monthSet.size||0);
  const ticket=sales?revenue/sales:0;
  return{
    raw:{investment,leads,appointments,shows,proposals,sales,revenue,ticket},
    coverage:{days:dates.length,calendarDays,businessDays:Math.max(1,businessDays),months:monthCount,requested:period},
    source:{meta:meta.length>0,crm:crm.length>0}
  };
}
async function calculatorLoadBaseline(period){
  const range=calculatorHistoryRange(period);
  const payload=await calculatorServiceHistory(range.since,range.until);
  return calculatorAggregateHistory(payload,period);
}
function calculatorBaselineView(){
  const base=calculatorState.baseline;
  if(!base)return{
    investment:0,cpl:0,leads:0,appointments:0,shows:0,proposals:0,sales:0,ticket:0,revenue:0,
    leadToAppointment:0,appointmentToShow:0,showToProposal:0,proposalToSale:0
  };
  const r=base.raw,cpl=r.leads?r.investment/r.leads:0;
  const rates={
    leadToAppointment:r.leads?r.appointments/r.leads:0,
    appointmentToShow:r.appointments?r.shows/r.appointments:0,
    showToProposal:r.shows?r.proposals/r.shows:0,
    proposalToSale:r.proposals?r.sales/r.proposals:0
  };
  if(calculatorState.baselineView==='daily'){
    return{
      investment:r.investment/base.coverage.calendarDays,cpl,
      leads:r.leads/base.coverage.businessDays,
      appointments:r.appointments/base.coverage.businessDays,
      shows:r.shows/base.coverage.businessDays,
      proposals:r.proposals/base.coverage.businessDays,
      sales:r.sales/base.coverage.businessDays,
      ticket:r.ticket,revenue:r.revenue/base.coverage.businessDays,...rates
    };
  }
  return{
    investment:r.investment/base.coverage.months,cpl,
    leads:r.leads/base.coverage.months,
    appointments:r.appointments/base.coverage.months,
    shows:r.shows/base.coverage.months,
    proposals:r.proposals/base.coverage.months,
    sales:r.sales/base.coverage.months,
    ticket:r.ticket,revenue:r.revenue/base.coverage.months,...rates
  };
}
function calculatorProjection(){
  const p=calculatorState.projection;
  const autoLeads=p.cpl>0?p.investment/p.cpl:0;
  const leads=p.leadMode==='manual'?Math.max(0,Number(p.manualLeads||0)):autoLeads;
  const effectiveCpl=p.leadMode==='manual'?(leads>0?p.investment/leads:0):Math.max(0,Number(p.cpl||0));
  const appointments=leads*(Number(p.leadToAppointment||0)/100);
  const shows=appointments*(Number(p.appointmentToShow||0)/100);
  const proposals=shows*(Number(p.showToProposal||0)/100);
  const sales=proposals*(Number(p.proposalToSale||0)/100);
  const revenue=sales*Number(p.ticket||0);
  return{investment:Number(p.investment||0),cpl:effectiveCpl,leads,appointments,shows,proposals,sales,ticket:Number(p.ticket||0),revenue};
}
function calculatorPanelHead(kicker,title,subtitle,badge=''){
  return `<div class="calculator-panel-head"><div><span class="calculator-kicker">${kicker}</span><h2>${title}</h2><p>${subtitle}</p></div>${badge?`<span class="calculator-badge">${badge}</span>`:''}</div>`;
}
function calculatorNode(label,value,help,level,projected=false,control=''){
  return `<div class="calculator-funnel-node-wrap"><div class="calculator-funnel-node level-${level}${projected?' projected':''}">
    <span class="node-label">${label}</span><strong class="node-value">${value}</strong>${control}
    <small class="node-help">${help}</small>
  </div></div>`;
}
function calculatorConnector(label,value,help,control=''){
  return `<div class="calculator-connector"><span class="connector-label">${label}</span>${control||`<strong class="connector-value">${value}</strong>`}<small class="connector-help">${help}</small></div>`;
}
function calculatorMoneyInput(id,value,step='1'){
  return `<div class="calculator-money"><span>R$</span><input id="${id}" type="number" min="0" step="${step}" value="${Number(value||0)}"></div>`;
}
function calculatorPercentInput(id,value){
  return `<div class="calculator-percent"><input id="${id}" type="number" min="0" max="100" step="0.1" value="${Number(value||0)}"><span>%</span></div>`;
}
function calculatorRenderShell(){
  const root=document.querySelector('#calculatorApp')||document.querySelector('#page-calculator');
  if(!root)return;
  const now=new Date(),months=Array.from({length:12},(_,i)=>new Date(2020,i,1).toLocaleDateString('pt-BR',{month:'long'}));
  const years=[];for(let y=now.getFullYear()-2;y<=now.getFullYear()+3;y++)years.push(y);
  root.innerHTML=`<div class="calculator-shell">
    <div class="calculator-titlebar">
      <div><span class="calculator-kicker">PLANEJAMENTO COMERCIAL</span><h1>Calculadora de Meta</h1><p>Baseline → simulação → execução → forecast → recuperação.</p></div>
      <div class="calculator-period-pickers">
        <label class="calculator-field"><span>Mês</span><select id="calculatorMonth">${months.map((m,i)=>`<option value="${i+1}" ${i===now.getMonth()?'selected':''}>${m.charAt(0).toUpperCase()+m.slice(1)}</option>`).join('')}</select></label>
        <label class="calculator-field"><span>Ano</span><select id="calculatorYear">${years.map(y=>`<option value="${y}" ${y===now.getFullYear()?'selected':''}>${y}</option>`).join('')}</select></label>
      </div>
    </div>
    <section class="panel calculator-panel calculator-calendar">
      ${calculatorPanelHead('PERÍODO','Calendário da operação','Dias calculados automaticamente a partir do mês e ano selecionados.')}
      <div class="calculator-calendar-grid" id="calculatorCalendarGrid"></div>
    </section>
    <section class="calculator-main-grid">
      <section class="panel calculator-panel calculator-funnel-panel" id="calculatorBaselinePanel"></section>
      <section class="panel calculator-panel calculator-funnel-panel" id="calculatorProjectionPanel"></section>
      <section class="panel calculator-panel calculator-execution-panel" id="calculatorExecutionPanel"></section>
    </section>
    <section class="panel calculator-panel calculator-table-panel">
      ${calculatorPanelHead('RESULTADO','Comparação dos Cenários','Baseline × projeção. As diferenças ficam concentradas aqui.')}
      <div class="calculator-table-wrap"><table class="calculator-table"><thead><tr><th>Indicador</th><th>Baseline</th><th>Projeção</th><th>Variação</th></tr></thead><tbody id="calculatorComparisonBody"></tbody></table></div>
      <div class="calculator-source-note" id="calculatorComparisonNote"></div>
    </section>
    <section class="panel calculator-panel calculator-table-panel">
      ${calculatorPanelHead('DETALHAMENTO','Visão Diária','Dados persistidos de Meta Ads + PipeRun para o mês selecionado.')}
      <div class="calculator-table-wrap"><table class="calculator-table"><thead><tr><th>Data</th><th>Investimento</th><th>Leads</th><th>Agendamentos</th><th>Comparecimentos</th><th>Propostas</th><th>Vendas</th><th>Receita</th></tr></thead><tbody id="calculatorDailyBody"></tbody></table></div>
      <div class="calculator-source-note">A Calculadora apresenta fatos matemáticos. Não atribui causas operacionais aos desvios.</div>
    </section>
  </div>`;
}
function calculatorUpdatePeriod(){
  const c=calculatorCalendar(),grid=document.querySelector('#calculatorCalendarGrid');
  if(!grid)return c;
  const rows=[
    ['Dias corridos',c.total],['Dias transcorridos',c.passed],['Dias restantes',c.remaining],
    ['Dias úteis',c.usefulTotal],['Úteis transcorridos',c.usefulPassed],['Úteis restantes',c.usefulRemaining]
  ];
  grid.innerHTML=rows.map(([label,value])=>`<div class="calculator-stat"><span>${label}</span><strong>${calculatorNumber(value)}</strong></div>`).join('');
  return c;
}
function calculatorRenderBaseline(){
  const box=document.querySelector('#calculatorBaselinePanel');if(!box)return;
  const b=calculatorBaselineView(),daily=calculatorState.baselineView==='daily';
  const coverage=calculatorState.baseline?.coverage,source=calculatorState.baseline?.source;
  const sourceText=!coverage?'Carregando histórico...':coverage.days
    ?`Base persistida: ${coverage.days} dia(s) com dados · ${source?.meta?'Meta Ads':''}${source?.meta&&source?.crm?' + ':''}${source?.crm?'PipeRun':''}`
    :'Sem histórico persistido suficiente para o período selecionado.';
  box.innerHTML=`${calculatorPanelHead('BASELINE','Funil Atual','Referência histórica da operação.','Referência')}
    <div class="calculator-toolbar">
      <label class="calculator-field"><span>Período de análise</span><select id="calculatorBaselinePeriod">
        <option value="30d">Últimos 30 dias</option><option value="3m">Média de 3 meses</option><option value="6m">Média de 6 meses</option><option value="custom">Personalizado</option>
      </select></label>
      <label class="calculator-field"><span>Leitura</span><select id="calculatorBaselineView">
        <option value="daily">Média dhária</option><option value="monthly">Média mensal</option>
      </select></label>
      <div class="calculator-custom-range ${calculatorState.baselinePeriod==='custom'?'':'calculator-hidden'}" id="calculatorCustomRange">
        <label class="calculator-field"><span>De</span><input id="calculatorBaselineSince" type="date" value="${calculatorState.baselineCustomSince||calculatorHistoryRange('30d').since}"></label>
        <label class="calculator-field"><span>Até</span><input id="calculatorBaselineUntil" type="date" value="${calculatorState.baselineCustomUntil||calculatorHistoryRange('30d').until}"></label>
      </div>
    </div>
    <div class="calculator-coverage">${calculatorEscape(sourceText)}</div>
    <div class="calculator-funnel">
      ${calculatorNode('Investimento',calculatorMoney(b.investment),'Investimento médio '+(daily?'por dia corrido.':'por mês.'),1)}
      ${calculatorConnector('CPL',calculatorMoney(b.cpl,2),'Custo histórico médio por lead.')}
      ${calculatorNode('Leads',calculatorNumber(b.leads),'Leads gerados na '+(daily?'média diária.':'média mensal.'),2)}
      ${calculatorConnector('Lead → Agendamento',calculatorPercent(b.leadToAppointment*100,1),'Percentual histórico de leads que avançaram para agendamento.')}
      ${calculatorNode('Agendamentos',calculatorNumber(b.appointments),'Agendamentos na '+(daily?'média diária.':'média mensal.'),3)}
      ${calculatorConnector('Agendamento → Comparecimento',calculatorPercent(b.appointmentToShow*100,1),'Percentual histórico de agendamentos que compareceram.')}
      ${calculatorNode('Comparecimentos',calculatorNumber(b.shows),'Comparecimentos na '+(daily?'média diária.':'média mensal.'),4)}
      ${calculatorConnector('Comparecimento → Proposta',calculatorPercent(b.showToProposal*100,1),'Percentual histórico que avançou para proposta.',)}
      ${calculatorNode('Propostas',calculatorNumber(b.proposals),'Propostas na '+(daily?'média diária.':'média mensal.'),5)}
      ${calculatorConnector('Proposta → Venda',calculatorPercent(b.proposalToSale*100,1),'Percentual histórico de propostas convertidas em venda.')}
      ${calculatorNode('Vendas',calculatorNumber(b.sales),'Vendas na '+(daily?'média diária.':'média mensal.'),6)}
      ${calculatorConnector('Ticket Médio',calculatorMoney(b.ticket),'Valor médio histórico por venda.')}
      ${calculatorNode('Receita',calculatorMoney(b.revenue),'Receita '+(daily?'média diária.':'média mensal.'),5)}
    </div>`;
  const period=box.querySelector('#calculatorBaselinePeriod'),view=box.querySelector('#calculatorBaselineView');
  const sinceInput=box.querySelector('#calculatorBaselineSince'),untilInput=box.querySelector('#calculatorBaselineUntil');
  period.value=calculatorState.baselinePeriod;view.value=calculatorState.baselineView;
  period.addEventListener('change',async e=>{
    calculatorState.baselinePeriod=e.target.value;
    if(e.target.value==='custom'&&(!calculatorState.baselineCustomSince||!calculatorState.baselineCustomUntil)){
      const fallback=calculatorHistoryRange('30d');
      calculatorState.baselineCustomSince=fallback.since;
      calculatorState.baselineCustomUntil=fallback.until;
    }
    calculatorRenderBaseline();
    await calculatorRefreshBaseline();
  });
  view.addEventListener('change',e=>{calculatorState.baselineView=e.target.value;calculatorRenderBaseline();calculatorRenderComparison();});
  const refreshCustom=async()=>{
    const since=sinceInput?.value||'',until=untilInput?.value||'';
    if(!since||!until||since>until)return;
    calculatorState.baselineCustomSince=since;
    calculatorState.baselineCustomUntil=until;
    await calculatorRefreshBaseline();
  };
  sinceInput?.addEventListener('change',refreshCustom);
  untilInput?.addEventListener('change',refreshCustom);
}
function calculatorRenderProjection(){
  const box=document.querySelector('#calculatorProjectionPanel');if(!box)return;
  const p=calculatorState.projection,x=calculatorProjection(),manual=p.leadMode==='manual';
  const cplControl=manual
    ?`<strong class="connector-value">${calculatorMoney(x.cpl,2)}</strong>`
    :calculatorMoneyInput('calculatorCpl',p.cpl,'0.01');
  box.innerHTML=`${calculatorPanelHead('SIMULAÇÃO','Funil Calculador','Edite as premissas dentro do próprio funil.','Editável')}
    <div class="calculator-toolbar"><div class="calculator-toolbar-note">Altere investimento, CPL, taxas e ticket. Os resultados seguintes são recalculados imediatamente com precisão decimal e exibidos arredondados.</div></div>
    <div class="calculator-coverage">Projeção do período selecionado · mídia em dias corridos e ritmo comercial em dias úteis.</div>
    <div class="calculator-funnel">
      ${calculatorNode('Investimento',calculatorMoney(x.investment),'Valor total planejado para mídia no período.',1,true,calculatorMoneyInput('calculatorInvestment',p.investment,'100'))}
      ${calculatorConnector('CPL projetado','',manual?'CPL implícito = investimento ÷ leads.':'Custo médio esperado para gerar cada lead.',cplControl)}
      ${calculatorNode('Leads',calculatorNumber(x.leads),'Quantidade de leads prevista para o período.',2,true,`<div class="calculator-inline"><select id="calculatorLeadMode"><option value="auto">Calcular automaticamente</option><option value="manual">Preencher manualmente</option></select><div class="calculator-manual-leads ${manual?'':'calculator-hidden'}" id="calculatorManualLeadsWrap"><input id="calculatorManualLeads" type="number" min="0" step="1" value="${Number(p.manualLeads||0)}"></div></div>`)}
      ${calculatorConnector('Lead → Agendamento','', 'Percentual dos leads que realizam um agendamento.',calculatorPercentInput('calculatorLeadToAppointment',p.leadToAppointment))}
      ${calculatorNode('Agendamentos',calculatorNumber(x.appointments),'Resultado calculado a partir de leads e conversão.',3,true)}
      ${calculatorConnector('Agendamento → Comparecimento','', 'Percentual dos agendados que comparecem.',calculatorPercentInput('calculatorAppointmentToShow',p.appointmentToShow))}
      ${calculatorNode('Comparecimentos',calculatorNumber(x.shows),'Resultado calculado automaticamente.',4,true)}
      ${calculatorConnector('Comparecimento → Proposta','', 'Percentual dos comparecimentos que recebem proposta.',calculatorPercentInput('calculatorShowToProposal',p.showToProposal))}
      ${calculatorNode('Propostas',calculatorNumber(x.proposals),'Resultado calculado automaticamente.',5,true)}
      ${calculatorConnector('Proposta → Venda','', 'Percentual das propostas que se convertem em venda.',calculatorPercentInput('calculatorProposalToSale',p.proposalToSale))}
      ${calculatorNode('Vendas',calculatorNumber(x.sales),'Resultado calculado automaticamente.',6,true)}
      ${calculatorConnector('Ticket Médio','', 'Valor médio gerado por cada venda.',calculatorMoneyInput('calculatorTicket',p.ticket,'1000'))}
      ${calculatorNode('Receita',calculatorMoney(x.revenue),'Resultado financeiro projetado pelo cenário.',5,true)}
    </div>`;
  box.querySelector('#calculatorLeadMode').value=p.leadMode;
  calculatorBindProjectionFields();
}
function calculatorBindProjectionFields(){
  const handlers={
    calculatorInvestment:v=>calculatorState.projection.investment=Math.max(0,v),
    calculatorCpl:v=>calculatorState.projection.cpl=Math.max(.01,v),
    calculatorManualLeads:v=>calculatorState.projection.manualLeads=Math.max(0,v),
    calculatorLeadToAppointment:v=>calculatorState.projection.leadToAppointment=Math.max(0,Math.min(100,v)),
    calculatorAppointmentToShow:v=>calculatorState.projection.appointmentToShow=Math.max(0,Math.min(100,v)),
    calculatorShowToProposal:v=>calculatorState.projection.showToProposal=Math.max(0,Math.min(100,v)),
    calculatorProposalToSale:v=>calculatorState.projection.proposalToSale=Math.max(0,Math.min(100,v)),
    calculatorTicket:v=>calculatorState.projection.ticket=Math.max(0,v)
  };
  Object.entries(handlers).forEach(([id,setter])=>{
    const el=document.querySelector('#'+id);if(!el)return;
    el.addEventListener('input',()=>{setter(Number(el.value||0));calculatorRecalculate(false);});
    el.addEventListener('change',()=>{setter(Number(el.value||0));calculatorRecalculate(false);});
  });
  const mode=document.querySelector('#calculatorLeadMode');
  if(mode)mode.addEventListener('change',()=>{
    const current=calculatorProjection();
    if(mode.value==='manual'&&calculatorState.projection.leadMode!=='manual')calculatorState.projection.manualLeads=current.leads;
    calculatorState.projection.leadMode=mode.value;
    calculatorRenderProjection();calculatorRecalculate(false);
  });
}
function calculatorUpdateProjectionOutputs(){
  const x=calculatorProjection(),box=document.querySelector('#calculatorProjectionPanel');if(!box)return;
  const values=box.querySelectorAll('.node-value');
  const ordered=[calculatorMoney(x.investment),calculatorNumber(x.leads),calculatorNumber(x.appointments),calculatorNumber(x.shows),calculatorNumber(x.proposals),calculatorNumber(x.sales),calculatorMoney(x.revenue)];
  values.forEach((el,i)=>{if(ordered[i]!==undefined)el.textContent=ordered[i];});
  if(calculatorState.projection.leadMode==='manual'){
    const cplValue=box.querySelector('.calculator-connector .connector-value');if(cplValue)cplValue.textContent=calculatorMoney(x.cpl,2);
  }
}
function calculatorActualLeads(){
  const key=calculatorSelectedPeriod().key;
  if(Object.prototype.hasOwnProperty.call(calculatorState.actualOverrides,key))return Number(calculatorState.actualOverrides[key]||0);
  const today=calculatorIsoLocal(new Date());
  return calculatorState.daily.reduce((sum,row)=>sum+(row.day<=today?Number(row.leads||0):0),0);
}
function calculatorRenderExecution(){
  const box=document.querySelector('#calculatorExecutionPanel');if(!box)return;
  const p=calculatorProjection(),c=calculatorCalendar(),actual=calculatorActualLeads();
  const expected=c.usefulTotal?p.leads*c.usefulPassed/c.usefulTotal:0,gap=actual-expected;
  const plannedPct=p.leads?100*expected/p.leads:0,actualPct=p.leads?100*actual/p.leads:0;
  const pace=c.usefulPassed?actual/c.usefulPassed:0,forecast=c.usefulPassed?pace*c.usefulTotal:0,gapForecast=forecast-p.leads;
  const remaining=Math.max(p.leads-actual,0),need=c.usefulRemaining?remaining/c.usefulRemaining:(remaining?null:0);
  const dailyInvestment=need===null?null:need*p.cpl;
  box.innerHTML=`${calculatorPanelHead('EXECUÇÃO','Acompanhamento da Meta','Planejado × realizado.')}
    <div class="calculator-execution-grid">
      <div class="calculator-stat"><span>Meta de Leads</span><strong>${calculatorNumber(p.leads)}</strong></div>
      <div class="calculator-stat"><span>Esperado até hoje</span><strong>${calculatorNumber(expected)}</strong></div>
      <div class="calculator-stat"><span>Realizado até hoje</span><input id="calculatorActualLeads" type="number" min="0" step="1" value="${Math.round(actual)}"></div>
      <div class="calculator-stat"><span>Gap atual</span><strong class="${gap>=0?'calculator-positive':'calculator-negative'}">${gap>=0?'+':''}${calculatorNumber(gap)}</strong></div>
    </div>
    <div class="calculator-progress">
      <div class="calculator-progress-row"><div class="calculator-progress-label"><span>Planejado acumulado</span><b>${calculatorPercent(plannedPct,1)}</b></div><div class="calculator-progress-track"><i style="width:${Math.max(0,Math.min(100,plannedPct))}%"></i></div></div>
      <div class="calculator-progress-row"><div class="calculator-progress-label"><span>Realizado acumulado</span><b>${calculatorPercent(actualPct,1)}</b></div><div class="calculator-progress-track actual"><i style="width:${Math.max(0,Math.min(100,actualPct))}%"></i></div></div>
    </div>
    <div class="calculator-mini-grid">
      <div class="calculator-stat"><span>Meta de Vendas</span><strong>${calculatorNumber(p.sales)}</strong></div>
      <div class="calculator-stat"><span>Receita projetada</span><strong>${calculatorMoney(p.revenue)}</strong></div>
    </div>
    <div class="calculator-execution-section">
      <span class="calculator-kicker">CADÊNCIA</span><h3>Ritmo da Operação</h3>
      <div class="calculator-mini-grid">
        <div class="calculator-stat"><span>Ritmo atual</span><strong>${c.usefulPassed?calculatorNumber(pace,1)+'/dia':'—'}</strong></div>
        <div class="calculator-stat"><span>Ritmo necessário</span><strong>${need===null?'Prazo encerrado':calculatorNumber(need,1)+'/dia'}</strong></div>
        <div class="calculator-stat"><span>Forecast de Leads</span><strong>${c.usefulPassed?calculatorNumber(forecast):'—'}</strong></div>
        <div class="calculator-stat"><span>Gap projetado</span><strong class="${gapForecast>=0?'calculator-positive':'calculator-negative'}">${c.usefulPassed?(gapForecast>=0?'+':'')+calculatorNumber(gapForecast):'—'}</strong></div>
      </div>
    </div>
    <div class="calculator-execution-section recovery">
      <span class="calculator-kicker">RECUPERAÇÃO</span><h3>Para recuperar a meta</h3>
      <div class="calculator-mini-grid">
        <div class="calculator-stat"><span>Leads restantes</span><strong>${calculatorNumber(remaining)}</strong></div>
        <div class="calculator-stat"><span>Dias úteis restantes</span><strong>${calculatorNumber(c.usefulRemaining)}</strong></div>
        <div class="calculator-stat"><span>Novo ritmo necessário</span><strong>${need===null?'Prazo encerrado':calculatorNumber(need,1)+'/dia'}</strong></div>
        <div class="calculator-stat"><span>Investimento necessário/dia</span><strong>${dailyInvestment===null?'—':calculatorMoney(dailyInvestment)}</strong></div>
      </div>
    </div>`;
  const input=box.querySelector('#calculatorActualLeads');
  input.addEventListener('change',()=>{
    calculatorState.actualOverrides[calculatorSelectedPeriod().key]=Math.max(0,Number(input.value||0));
    calculatorRenderExecution();
  });
}
function calculatorRenderComparison(){
  const tbody=document.querySelector('#calculatorComparisonBody');if(!tbody)return;
  const b=calculatorBaselineView(),p=calculatorProjection();
  const rows=[
    ['Investimento',b.investment,p.investment,'money'],
    ['CPL',b.cpl,p.cpl,'money2'],
    ['Leads',b.leads,p.leads,'number'],
    ['Agendamentos',b.appointments,p.appointments,'number'],
    ['Comparecimentos',b.shows,p.shows,'number'],
    ['Propostas',b.proposals,p.proposals,'number'],
    ['Vendas',b.sales,p.sales,'number'],
    ['Ticket Médio',b.ticket,p.ticket,'money'],
    ['Receita',b.revenue,p.revenue,'money']
  ];
  const format=(v,type)=>type==='money'?calculatorMoney(v):type==='money2'?calculatorMoney(v,2):calculatorNumber(v);
  tbody.innerHTML=rows.map(([label,base,projection,type])=>{
    const diff=projection-base;
    return `<tr><td>${label}</td><td>${format(base,type)}</td><td>${format(projection,type)}</td><td class="${diff>=0?'calculator-positive':'calculator-negative'}">${diff>=0?'+':''}${format(diff,type)}</td></tr>`;
  }).join('');
  const note=document.querySelector('#calculatorComparisonNote');
  if(note)note.textContent=`Baseline exibido como ${calculatorState.baselineView==='daily'?'média diária':'média mensal'} do período histórico selecionado; projeção refere-se ao mês planejado.`;
}
function calculatorMergeDaily(payload){
  const map=new Map(),meta=Array.isArray(payload?.metaDaily)?payload.metaDaily:[],crm=Array.isArray(payload?.crmDaily)?payload.crmDaily:[];
  meta.forEach(row=>{
    const day=String(row.day||'');if(!day)return;
    const x=map.get(day)||{day,investment:0,leads:0,appointments:0,shows:0,proposals:0,sales:0,revenue:0,meta:false,crm:false};
    x.investment+=Number(row.spend||0);x.leads+=Number(row.leads||0);x.meta=true;map.set(day,x);
  });
  crm.forEach(row=>{
    const day=String(row.day||'');if(!day)return;
    const x=map.get(day)||{day,investment:0,leads:0,appointments:0,shows:0,proposals:0,sales:0,revenue:0,meta:false,crm:false};
    // Agendamento = negócio criado no pipeline Closers (84566); Comparecimento = 1ª reunião realizada; Proposta = 2ª reunião realizada.
    x.appointments+=Number(row.appointments||0);
    x.shows+=Number(row.meetings||0);x.proposals+=Number(row.meeting2||0);
    x.sales+=Number(row.wins||0);x.revenue+=Number(row.revenue||0);x.crm=true;map.set(day,x);
  });
  calculatorState.dailyMetaPresent=meta.length>0;calculatorState.dailyCrmPresent=crm.length>0;
  return [...map.values()].sort((a,b)=>a.day.localeCompare(b.day));
}
async function calculatorLoadDaily(){
  const {year,month,monthIndex}=calculatorSelectedPeriod(),last=calculatorDaysInMonth(year,monthIndex);
  const since=`${year}-${String(month).padStart(2,'0')}-01`,until=`${year}-${String(month).padStart(2,'0')}-${String(last).padStart(2,'0')}`;
  const payload=await calculatorServiceHistory(since,until);
  return calculatorMergeDaily(payload);
}
function calculatorRenderDaily(){
  const tbody=document.querySelector('#calculatorDailyBody');if(!tbody)return;
  if(!calculatorState.daily.length){
    tbody.innerHTML='<tr><td colspan="8"><div class="calculator-empty">Sem dados persistidos para o mês selecionado.</div></td></tr>';return;
  }
  tbody.innerHTML=calculatorState.daily.map(row=>`<tr>
    <td>${new Date(`${row.day}T12:00:00`).toLocaleDateString('pt-BR')}</td>
    <td>${row.meta?calculatorMoney(row.investment):'—'}</td>
    <td>${row.meta?calculatorNumber(row.leads):'—'}</td>
    <td>${row.crm?calculatorNumber(row.appointments):'—'}</td>
    <td>${row.crm?calculatorNumber(row.shows):'—'}</td>
    <td>${row.crm?calculatorNumber(row.proposals):'—'}</td>
    <td>${row.crm?calculatorNumber(row.sales):'—'}</td>
    <td>${row.crm?calculatorMoney(row.revenue):'—'}</td>
  </tr>`).join('');
}
async function calculatorRefreshBaseline(){
  const page=document.querySelector('#page-calculator');if(page)page.classList.add('calculator-loading');
  try{calculatorState.baseline=await calculatorLoadBaseline(calculatorState.baselinePeriod);}
  catch(error){calculatorState.baseline=null;console.warn('Calculadora: baseline indisponível',error);}
  finally{if(page)page.classList.remove('calculator-loading');}
  calculatorRenderBaseline();calculatorRenderComparison();
}
async function calculatorRefreshDaily(){
  try{calculatorState.daily=await calculatorLoadDaily();}
  catch(error){calculatorState.daily=[];console.warn('Calculadora: visão diária indisponível',error);}
  calculatorRenderDaily();calculatorRenderExecution();
}
function calculatorRecalculate(updateProjection=true){
  calculatorUpdatePeriod();
  if(updateProjection)calculatorRenderProjection();else calculatorUpdateProjectionOutputs();
  calculatorRenderExecution();
  calculatorRenderComparison();
}
function calculatorBind(){
  document.querySelector('#calculatorMonth')?.addEventListener('change',async()=>{calculatorUpdatePeriod();await calculatorRefreshDaily();calculatorRecalculate(false);});
  document.querySelector('#calculatorYear')?.addEventListener('change',async()=>{calculatorUpdatePeriod();await calculatorRefreshDaily();calculatorRecalculate(false);});
}
async function calculatorInit(){
  const page=document.querySelector('#page-calculator'),root=document.querySelector('#calculatorApp');
  if(!page||!root)return;
  if(!calculatorState.initialized){
    calculatorRenderShell();
    calculatorBind();
    calculatorState.initialized=true;
    calculatorUpdatePeriod();
    calculatorRenderBaseline();
    calculatorRenderProjection();
    calculatorRenderExecution();
    calculatorRenderComparison();
    calculatorRenderDaily();
    await Promise.allSettled([calculatorRefreshBaseline(),calculatorRefreshDaily()]);
  }else{
    calculatorRecalculate(false);
    calculatorRenderDaily();
  }
}
window.calculatorInit=calculatorInit;
window.calculatorRecalculate=calculatorRecalculate;
window.calculatorRenderBaseline=calculatorRenderBaseline;
window.calculatorRenderProjection=calculatorRenderProjection;
window.calculatorUpdatePeriod=calculatorUpdatePeriod;
window.calculatorRenderComparison=calculatorRenderComparison;
window.calculatorRenderDaily=calculatorRenderDaily;
window.calculatorLoadBaseline=calculatorLoadBaseline;
/* Substitui apenas o renderizador legado da aba Calculadora; outras features-v2 permanecem intactas. */
window.renderCalculatorV2=calculatorInit;
