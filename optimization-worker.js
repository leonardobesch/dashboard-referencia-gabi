
const DEFAULT_SEGMENTS=[
 {segment_key:'GERAL',label:'GERAL',name_contains:'',budget:0,lead_target:0,cpl_target:30},
 // Segmentações pelas etiquetas reais dos nomes das campanhas (vários termos separados por vírgula = qualquer um).
 {segment_key:'EXTERIOR',label:'Estrangeiros',name_contains:'[estrangeiros]',budget:0,lead_target:0,cpl_target:70},
 {segment_key:'BRASIL',label:'Brasil',name_contains:'[br]',budget:0,lead_target:0,cpl_target:70},
 {segment_key:'IMOB',label:'Imob',name_contains:'[imob]',budget:0,lead_target:0,cpl_target:70},
 {segment_key:'DC',label:'DC',name_contains:'[dc]',budget:0,lead_target:0,cpl_target:70},
 {segment_key:'RMKT',label:'Remarketing',name_contains:'[rmkt]',budget:0,lead_target:0,cpl_target:70}
];
const SEG_FIELDS=['label','name_contains','budget','lead_target','cpl_target','zero_lead_extra_spend','min_spend','min_leads','min_hours','min_impressions','scale_threshold','maintain_threshold','reduce_threshold','max_increase_pct','max_decrease_pct','cascade_pause','weight_cpl','weight_volume','weight_appointment','weight_meeting1','weight_meeting2','weight_sale','target_appointment_rate','target_meeting1_rate','target_meeting2_rate','target_sale_rate','weight_1d','weight_7d','weight_30d'];
const N=x=>Number(x||0);
const clamp=(x,a=0,b=100)=>Math.max(a,Math.min(b,N(x)));
const safeJson=(v,f)=>{try{return JSON.parse(v)}catch{return f}};
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const uid=()=>crypto.randomUUID();
const BR_DAY_FMT=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}),BR_HOUR_FMT=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'});
function brDate(daysOffset=0){const d=new Date(Date.now()+daysOffset*86400000);return BR_DAY_FMT.format(d)}
function monthStart(){const [y,m]=brDate(0).split('-');return `${y}-${m}-01`}
function monthMeta(){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric'}).formatToParts(new Date()),o=Object.fromEntries(parts.map(p=>[p.type,p.value])),y=+o.year,m=+o.month,d=+o.day;return{day:d,days:new Date(Date.UTC(y,m,0)).getUTCDate()}}
let WIN_CACHE=null;
function windows(){const key=Math.floor(Date.now()/60000);if(WIN_CACHE?.key===key)return WIN_CACHE.w;const w=windowsNow();WIN_CACHE={key,w};return w}
function windowsNow(){const today=brDate(0);return{today:{since:today,until:today,days:1},yesterday:{since:brDate(-1),until:brDate(-1),days:1},d7:{since:brDate(-6),until:today,days:7},d30:{since:brDate(-29),until:today,days:30},month:{since:monthStart(),until:today,days:monthMeta().day}}}
async function ensureDefaults(env){
 const now=new Date().toISOString();
 for(const s of DEFAULT_SEGMENTS)await env.DB.prepare(`INSERT OR IGNORE INTO optimization_segments(segment_key,label,name_contains,budget,lead_target,cpl_target,updated_at) VALUES(?,?,?,?,?,?,?)`).bind(s.segment_key,s.label,s.name_contains,s.budget,s.lead_target,s.cpl_target,now).run();
 await env.DB.prepare(`INSERT OR IGNORE INTO optimization_settings(key,value_json,updated_at) VALUES('usdBrlRate','5.45',?)`).bind(now).run();
 await env.DB.prepare(`INSERT OR IGNORE INTO optimization_settings(key,value_json,updated_at) VALUES('staleAfterMinutes','180',?)`).bind(now).run();
}
async function getSetting(env,key,fallback=null){const r=await env.DB.prepare(`SELECT value_json FROM optimization_settings WHERE key=?`).bind(key).first();return r?safeJson(r.value_json,fallback):fallback}
async function setSetting(env,key,value){await env.DB.prepare(`INSERT INTO optimization_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`).bind(key,JSON.stringify(value),new Date().toISOString()).run()}
async function configPayload(env){
 await ensureDefaults(env);
 const segments=(await env.DB.prepare(`SELECT * FROM optimization_segments ORDER BY CASE segment_key WHEN 'GERAL' THEN 0 WHEN 'EXTERIOR' THEN 1 WHEN 'BRASIL' THEN 2 WHEN 'CPMAIS' THEN 3 WHEN 'MOBI' THEN 4 ELSE 9 END,label`).all()).results||[];
 const rows=(await env.DB.prepare(`SELECT semantic_stage,stage_ids_json FROM optimization_stage_mapping`).all()).results||[],stageMapping={};
 for(const r of rows)stageMapping[r.semantic_stage]=safeJson(r.stage_ids_json,[]);
 return{segments,settings:{usdBrlRate:await getSetting(env,'usdBrlRate',5.45),staleAfterMinutes:await getSetting(env,'staleAfterMinutes',180)},stageMapping};
}
async function saveConfig(env,b){
 await ensureDefaults(env);const now=new Date().toISOString();
 if(b.createSegment){
   const x=b.createSegment,key=String(x.segment_key||'').trim(),label=String(x.label||key).trim(),contains=String(x.name_contains||'').trim();
   if(!key||!label)throw new Error('Segmentação inválida.');
   await env.DB.prepare(`INSERT INTO optimization_segments(segment_key,label,name_contains,budget,lead_target,cpl_target,updated_at) VALUES(?,?,?,0,0,30,?) ON CONFLICT(segment_key) DO UPDATE SET label=excluded.label,name_contains=excluded.name_contains,updated_at=excluded.updated_at`).bind(key,label,contains,now).run();
 }
 if(b.segment){
   const x=b.segment,key=String(x.segment_key||'').trim();if(!key)throw new Error('segment_key obrigatório.');
   const old=await env.DB.prepare(`SELECT * FROM optimization_segments WHERE segment_key=?`).bind(key).first();if(!old)throw new Error('Segmentação não encontrada.');
   const next={...old};for(const f of SEG_FIELDS)if(x[f]!==undefined)next[f]=x[f];
   const setSql=SEG_FIELDS.map(f=>`${f}=?`).join(',');
   await env.DB.prepare(`UPDATE optimization_segments SET ${setSql},updated_at=? WHERE segment_key=?`).bind(...SEG_FIELDS.map(f=>f==='label'||f==='name_contains'?String(next[f]??''):N(next[f])),now,key).run();
 }
 if(b.settings)for(const [k,v] of Object.entries(b.settings))await setSetting(env,k,v);
 if(b.stageMapping)for(const [k,v] of Object.entries(b.stageMapping)){
   const ids=Array.isArray(v)?v.map(String):[];
   await env.DB.prepare(`INSERT INTO optimization_stage_mapping(semantic_stage,stage_ids_json,updated_at) VALUES(?,?,?) ON CONFLICT(semantic_stage) DO UPDATE SET stage_ids_json=excluded.stage_ids_json,updated_at=excluded.updated_at`).bind(k,JSON.stringify(ids),now).run();
 }
 return configPayload(env);
}
function fx(currency,usd){return String(currency||'BRL').toUpperCase()==='USD'?N(usd)||1:1}
function matchesSegment(ad,s){
 if(!s||s.segment_key==='GERAL'||!String(s.name_contains||'').trim())return true;
 const hay=norm([ad.campaign_name,ad.adset_name,ad.ad_name].join(' '));return String(s.name_contains).split(/[,;|]/).map(norm).filter(Boolean).some(t=>hay.includes(t));
}
function mergeMeta(rows,rate){
 const x={spend:0,impressions:0,leads:0};for(const r of rows||[]){x.spend+=N(r.spend)*rate;x.impressions+=N(r.impressions);x.leads+=N(r.leads)}return x;
}
function stageCount(crm,adId,stageIds){
 if(!stageIds?.length||!crm?.auditLeads?.length)return 0;const set=new Set(stageIds.map(String));let c=0;
 for(const lead of crm.auditLeads){if((lead.adIds||[]).map(String).includes(String(adId))&&set.has(String(lead.stageId||'')))c++}
 return c;
}
function enrichMetrics(meta,crm,adId,map){
 const st=crm?.adStats?.[String(adId)]||{},opps=N(st.opportunities),meet=N(st.meetings),noShows=N(st.noShows),wins=N(st.wins);
 const useCrm=!!crm&&!!crm.adStats;
 const leads=useCrm&&opps>0?opps:N(meta.leads);
 // Sem mapeamento manual: Agendamento = negócio criado no pipeline Closers; 1ª/2ª reunião = atividades realizadas.
 const appointments=map.appointment?.length?stageCount(crm,adId,map.appointment):(st.appointments!==undefined?N(st.appointments):(meet+noShows));
 const meeting1=map.meeting1?.length?stageCount(crm,adId,map.meeting1):meet;
 const meeting2=map.meeting2?.length?stageCount(crm,adId,map.meeting2):N(st.meeting2);
 const sales=map.sale?.length?stageCount(crm,adId,map.sale):wins;
 const spend=N(meta.spend);
 return{spend,impressions:N(meta.impressions),leads,appointments,meeting1,meeting2,sales,revenue:N(st.revenue),leadSource:useCrm&&opps>0?'CRM':'META',
   cpl:leads?spend/leads:null,cpaAppointment:appointments?spend/appointments:null,cpaMeeting1:meeting1?spend/meeting1:null,cpaMeeting2:meeting2?spend/meeting2:null,cac:sales?spend/sales:null};
}
function rate(a,b){return b?100*N(a)/N(b):0}
function sampleEligible(m,s,hours){
 return N(m.spend)>=N(s.min_spend)&&N(m.leads)>=N(s.min_leads)&&N(hours)>=N(s.min_hours)&&N(m.impressions)>=N(s.min_impressions);
}
function scoreWindow(m,s,hours){
 const eligible=sampleEligible(m,s,hours),cplScore=m.leads&&m.cpl?clamp(N(s.cpl_target)/m.cpl*100):0,volumeScore=clamp(N(m.leads)/Math.max(1,N(s.min_leads))*100);
 const apptScore=clamp(rate(m.appointments,m.leads)/Math.max(.0001,N(s.target_appointment_rate))*100);
 const m1Score=clamp(rate(m.meeting1,m.appointments)/Math.max(.0001,N(s.target_meeting1_rate))*100);
 const m2Score=clamp(rate(m.meeting2,m.meeting1)/Math.max(.0001,N(s.target_meeting2_rate))*100);
 const saleScore=clamp(rate(m.sales,m.meeting2||m.meeting1)/Math.max(.0001,N(s.target_sale_rate))*100);
 const scores={cpl:cplScore,volume:volumeScore,appointment:apptScore,meeting1:m1Score,meeting2:m2Score,sale:saleScore};
 const weights={cpl:N(s.weight_cpl),volume:N(s.weight_volume),appointment:N(s.weight_appointment),meeting1:N(s.weight_meeting1),meeting2:N(s.weight_meeting2),sale:N(s.weight_sale)};
 const labels={cpl:'Eficiência de CPL',volume:'Volume de leads',appointment:'Lead → Agendamento',meeting1:'Agendamento → 1ª reunião',meeting2:'1ª → 2ª reunião',sale:'2ª reunião → Venda'};
 let total=0,den=0;const breakdown=[];
 for(const k of Object.keys(scores)){const w=weights[k],sc=scores[k];total+=sc*w;den+=w;breakdown.push({key:k,label:labels[k],score:sc,weight:w,contribution:w?sc*w/(Object.values(weights).reduce((a,b)=>a+b,0)||1):0})}
 return{eligible,score:den?total/den:0,breakdown};
}
function hoursForWindow(w,createdAt=''){
 let h=w.days*24;
 if(w.days===1&&w.since===brDate(0)){const parts=BR_HOUR_FMT.formatToParts(new Date());h=Math.max(1,+parts.find(x=>x.type==='hour')?.value+1)}
 if(createdAt){const age=Math.max(0,(Date.now()-Date.parse(createdAt))/3600000);if(Number.isFinite(age))h=Math.min(h,age)}
 return h;
}
function operationalScore(periods,s,createdAt){
 const specs=[['today',N(s.weight_1d)],['d7',N(s.weight_7d)],['d30',N(s.weight_30d)]],valid=[];let nume=0,den=0;
 for(const [k,w] of specs){const sw=scoreWindow(periods[k],s,hoursForWindow(windows()[k],createdAt));periods[k]._score=sw;if(sw.eligible&&w>0){valid.push(k);nume+=sw.score*w;den+=w}}
 return{score:den?nume/den:null,validWindows:valid};
}
function zeroLeadPause(m,s){return N(m.leads)===0&&N(m.spend)>=N(s.cpl_target)+N(s.zero_lead_extra_spend)}
function actionByScore(score,s){if(score==null)return'AGUARDAR';if(score>=N(s.scale_threshold))return'ESCALAR';if(score>=N(s.maintain_threshold))return'MANTER';if(score>=N(s.reduce_threshold))return'REDUZIR';return'PAUSAR'}
function referenceBudget(periods,s){
 for(const k of ['today','d7','d30']){const p=periods[k],days=windows()[k].days;if(p?._score?.eligible&&N(p.leads)>0)return N(p.leads)/Math.max(1,days)*N(s.cpl_target)}
 return null;
}
function suggestedBudget(action,current,ref,s){
 current=N(current);if(!current)return null;if(action==='MANTER'||action==='AGUARDAR')return current;if(action==='PAUSAR')return null;
 if(action==='ESCALAR'){if(ref==null)return current;return Math.max(current,Math.min(N(ref),current*(1+N(s.max_increase_pct)/100)))}
 if(action==='REDUZIR'){if(ref==null)return current*(1-N(s.max_decrease_pct)/100);return Math.min(current,Math.max(N(ref),current*(1-N(s.max_decrease_pct)/100)))}
 return current;
}
async function metaGet(path,params,cfg){
 const u=new URL(`https://graph.facebook.com/${cfg.apiVersion||'v23.0'}/${String(path).replace(/^\//,'')}`);for(const[k,v]of Object.entries(params||{}))if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v));u.searchParams.set('access_token',cfg.accessToken);
 const r=await fetch(u),j=await r.json();if(!r.ok||j.error)throw new Error(j?.error?.message||`Meta HTTP ${r.status}`);return j;
}
async function metaPost(id,params,cfg){
 const u=`https://graph.facebook.com/${cfg.apiVersion||'v23.0'}/${id}`,body=new URLSearchParams({access_token:cfg.accessToken});for(const[k,v]of Object.entries(params||{}))body.set(k,String(v));
 const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body}),j=await r.json().catch(()=>({}));if(!r.ok||j.error)throw new Error(j?.error?.message||`Meta HTTP ${r.status}`);return j;
}
async function metaBatch(ids,fields,cfg){
 ids=[...new Set((ids||[]).map(String).filter(Boolean))];if(!ids.length)return[];
 const chunks=[];for(let i=0;i<ids.length;i+=40)chunks.push(ids.slice(i,i+40));const out=[];
 for(const part of chunks){const u=new URL(`https://graph.facebook.com/${cfg.apiVersion||'v23.0'}`),batch=part.map(id=>({method:'GET',relative_url:`${id}?fields=${encodeURIComponent(fields)}`})),body=new URLSearchParams({access_token:cfg.accessToken,batch:JSON.stringify(batch),include_headers:'false'}),r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body}),j=await r.json();if(!r.ok||!Array.isArray(j))throw new Error(`Meta batch HTTP ${r.status}`);for(const it of j)if(N(it.code)>=200&&N(it.code)<300&&it.body){try{const x=JSON.parse(it.body);if(x.id)out.push(x)}catch{}}}
 return out;
}
function budgetEntity(raw,rate,type){if(!raw)return null;const daily=N(raw.daily_budget),life=N(raw.lifetime_budget);if(daily>0)return{type,id:String(raw.id),name:raw.name||'',field:'daily_budget',currentBudget:daily/100*rate,modifiable:true,currencyRate:rate};if(life>0)return{type,id:String(raw.id),name:raw.name||'',field:'lifetime_budget',currentBudget:life/100*rate,modifiable:false,currencyRate:rate};return null}
// Orçamentos vêm do D1 (meta_budget, atualizado pelo cron) — consultar a Meta a cada abertura estoura o limite de chamadas.
async function budgetOwners(creatives,cfg,currencyByAccount,usdRate,env){
 const ids=[...new Set(creatives.flatMap(x=>[String(x.campaign_id||''),String(x.adset_id||'')]).filter(Boolean))],rows=[];
 for(let i=0;i<ids.length;i+=90){const part=ids.slice(i,i+90);rows.push(...((await env.DB.prepare(`SELECT * FROM meta_budget WHERE id IN (${part.map(()=>'?').join(',')})`).bind(...part).all()).results||[]))}
 const cm=new Map(rows.filter(x=>x.level==='campaign').map(x=>[String(x.id),x])),sm=new Map(rows.filter(x=>x.level==='adset').map(x=>[String(x.id),x])),out={};
 for(const a of creatives){const rateFx=fx(currencyByAccount.get(String(a.account_id)),usdRate),c=budgetEntity(cm.get(String(a.campaign_id)),rateFx,'campaign'),s=budgetEntity(sm.get(String(a.adset_id)),rateFx,'adset');out[String(a.ad_id)]=c?.field==='daily_budget'?c:(s||c||null)}
 return out;
}
async function loadWindow(env,ids,w,deps,opts={}){
 if(!ids.length)return{ads:[],crm:null,lastUpdated:null};const cached=await deps.loadPersistentCache(env,ids,w.since,w.until,opts);return cached;
}
async function syncWindow(env,ids,w,stored,deps,cfg){
 const sets=await Promise.all(ids.map(id=>deps.getAdInsights(id,w.since,w.until,cfg)));const norm=sets.map(x=>(x||[]).filter(deps.isReferenciaCapitalAdRaw).map(deps.normalizeAd));
 const dailySets=await Promise.all(ids.map(async(id,i)=>{const rows=norm[i];return rows.length?[{account_id:id,date_start:w.since,date_stop:w.until,spend:rows.reduce((a,r)=>a+N(r.spend),0),impressions:rows.reduce((a,r)=>a+N(r.impressions),0),clicks:rows.reduce((a,r)=>a+N(r.clicks),0),inline_link_clicks:rows.reduce((a,r)=>a+N(r.inline_link_clicks),0),lpv:rows.reduce((a,r)=>a+N(r.lpv),0),leads:rows.reduce((a,r)=>a+N(r.leads),0)}]:[]}));
 for(let i=0;i<ids.length;i++)await deps.saveMetaPeriod(env,ids[i],w.since,w.until,norm[i],dailySets[i]);
 const adIds=[...new Set(norm.flat().map(a=>String(a.ad_id||'')).filter(Boolean))];if(adIds.length){const cr=await deps.getCreativesByIds(adIds,cfg);await deps.saveCreativeCache(env,cr)}
 if(stored.pipeRunTokenCipher||env.PIPERUN_TOKEN){try{const token=await deps.getPipeToken(env),crm=await deps.syncPipeRun(token,w.since,w.until,adIds,stored);await deps.saveCrmPeriod(env,w.since,w.until,crm)}catch(e){console.log('Optimization CRM sync:',e.message)}}
 return deps.loadPersistentCache(env,ids,w.since,w.until);
}
async function syncAll(env,stored,deps){
 await ensureDefaults(env);const ids=deps.filterRcAccountIds(stored.selectedAccountIds||[]);if(!ids.length)throw new Error('Selecione ao menos uma conta Meta nas Configurações.');const cfg=await deps.getMetaConfig(env),ws=windows();
 for(const key of ['today','yesterday','d7','d30','month'])await syncWindow(env,ids,ws[key],stored,deps,cfg);
 await env.DB.prepare(`INSERT INTO sync_state(key,value,updated_at) VALUES('optimization_sync',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind(new Date().toISOString(),new Date().toISOString()).run();
 return{ok:true,message:'Meta Ads e PipeRun sincronizados; notas recalculadas na próxima leitura.'};
}

function groupAdsById(caches,accounts,usdRate,map){
 const by=new Map(),created=new Map(),adStatus=new Map();for(const c of Object.values(caches))for(const cr of c.creatives||[]){created.set(String(cr.id),cr.creative?._ad_created_time||'');if(cr.creative?._ad_status)adStatus.set(String(cr.id),cr.creative._ad_status)}
 for(const [key,c] of Object.entries(caches)){const rateBy=new Map(accounts.map(a=>[String(a.id),fx(a.currency,usdRate)]));for(const ad of c.ads||[]){const id=String(ad.ad_id||'');if(!id)continue;if(!by.has(id))by.set(id,{adId:id,accountId:String(ad.account_id||''),accountName:ad.account_name||'',campaignId:String(ad.campaign_id||''),campaignName:ad.campaign_name||'',adsetId:String(ad.adset_id||''),adsetName:ad.adset_name||'',adName:ad.ad_name||'',createdAt:created.get(id)||'',adStatus:adStatus.get(id)||'',periods:{}});const row=by.get(id),rateFx=rateBy.get(String(ad.account_id))||1;if(!row.periods[key])row.periods[key]={spend:0,impressions:0,leads:0};row.periods[key].spend+=N(ad.spend)*rateFx;row.periods[key].impressions+=N(ad.impressions);row.periods[key].leads+=N(ad.leads)}
   for(const row of by.values()){if(row.periods[key])row.periods[key]=enrichMetrics(row.periods[key],c.crm,row.adId,map)}
 }
 return by;
}
function scoreBreakdownForOperational(periods,s,score){
 const valid=['today','d7','d30'].filter(k=>periods[k]?._score?.eligible);if(!valid.length)return[];
 const weights={today:N(s.weight_1d),d7:N(s.weight_7d),d30:N(s.weight_30d)},den=valid.reduce((a,k)=>a+weights[k],0)||1,criteria=['cpl','volume','appointment','meeting1','meeting2','sale'],labels={cpl:'Eficiência de CPL',volume:'Volume de leads',appointment:'Lead → Agendamento',meeting1:'Agendamento → 1ª reunião',meeting2:'1ª → 2ª reunião',sale:'2ª reunião → Venda'},cw={cpl:N(s.weight_cpl),volume:N(s.weight_volume),appointment:N(s.weight_appointment),meeting1:N(s.weight_meeting1),meeting2:N(s.weight_meeting2),sale:N(s.weight_sale)},cwDen=Object.values(cw).reduce((a,b)=>a+b,0)||1;
 return criteria.map(k=>{let sc=0;for(const win of valid){const part=periods[win]._score.breakdown.find(x=>x.key===k);sc+=N(part?.score)*weights[win]/den}return{key:k,label:labels[k],score:sc,weight:cw[k],contribution:sc*cw[k]/cwDen}})
}
async function dataPayload(env,url,stored,deps){
 await ensureDefaults(env);const cfgAll=await configPayload(env),segKey=String(url.searchParams.get('segment')||'GERAL'),s=cfgAll.segments.find(x=>x.segment_key===segKey)||cfgAll.segments[0],allIds=deps.filterRcAccountIds(stored.selectedAccountIds||[]),accountFilter=String(url.searchParams.get('account_id')||''),ids=accountFilter&&allIds.includes(accountFilter)?[accountFilter]:allIds;
 if(!ids.length)return{accounts:[],overview:{budget:N(s.budget),leadTarget:N(s.lead_target),cplTarget:N(s.cpl_target),spend:0,leads:0,available:N(s.budget),missing:N(s.lead_target),usedPct:0},creatives:[],lastUpdated:null};
 const cfg=await deps.getMetaConfig(env),accountList=(await deps.getAccounts(cfg)).filter(a=>ids.includes(String(a.id))).map(a=>({id:String(a.id),name:a.name||a.id,currency:a.currency||'BRL'})),currencyBy=new Map(accountList.map(a=>[a.id,a.currency])),usd=N(cfgAll.settings.usdBrlRate)||5.45,ws={...windows()},caches={};const qs=url.searchParams.get('since'),qu=url.searchParams.get('until');if(qs&&qu)ws.custom={since:qs,until:qu,days:Math.max(1,Math.round((Date.parse(qu)-Date.parse(qs))/864e5)+1)};const WK=['today','yesterday','d7','d30','month',...(ws.custom?['custom']:[])];
 for(const k of WK)caches[k]=await loadWindow(env,ids,ws[k],deps,{creatives:k==='d30'});
 const map=cfgAll.stageMapping||{},by=groupAdsById(caches,accountList,usd,map),allCreatives=[...by.values()].filter(r=>matchesSegment({campaign_name:r.campaignName,adset_name:r.adsetName,ad_name:r.adName},s));
 const owners=await budgetOwners(allCreatives.map(r=>({account_id:r.accountId,campaign_id:r.campaignId,adset_id:r.adsetId,ad_id:r.adId})),cfg,currencyBy,usd,env);
 const stIds=[...new Set(allCreatives.flatMap(r=>[r.campaignId,r.adsetId]).filter(Boolean))],stMap=new Map();
 for(let i=0;i<stIds.length;i+=90){const part=stIds.slice(i,i+90);for(const x of ((await env.DB.prepare(`SELECT id,effective_status FROM meta_budget WHERE id IN (${part.map(()=>'?').join(',')})`).bind(...part).all()).results||[]))stMap.set(String(x.id),x.effective_status||'')}
 for(const r of allCreatives){r.campaignStatus=stMap.get(String(r.campaignId))||'';r.adsetStatus=stMap.get(String(r.adsetId))||''}
 const prior=(await env.DB.prepare(`SELECT ad_id,status FROM optimization_recommendations WHERE segment_key=?`).bind(s.segment_key).all()).results||[],priorMap=new Map(prior.map(x=>[String(x.ad_id),x.status])),results=[],recStmts=[];
 for(const r of allCreatives){
   for(const k of WK)if(!r.periods[k])r.periods[k]=enrichMetrics({spend:0,impressions:0,leads:0},caches[k]?.crm,r.adId,map);
   const op=operationalScore(r.periods,s,r.createdAt),today=r.periods.today,hardPause=zeroLeadPause(today,s);
   let action=hardPause?'PAUSAR':actionByScore(op.score,s),reason=hardPause?`0 leads e gasto de ${today.spend.toFixed(2)} atingiu CPL alvo + gordura`:(op.score==null?'Amostra mínima ainda não atingida':`Nota operacional ${op.score.toFixed(1)}`);
   const owner=owners[r.adId]||null;if(['ESCALAR','REDUZIR'].includes(action)&&(!owner||!owner.modifiable)){action='AGUARDAR';reason='Budget owner sem orçamento diário editável'}
   const ref=referenceBudget(r.periods,s),suggest=suggestedBudget(action,owner?.currentBudget,ref,s),rid=`${s.segment_key}:${r.adId}:${brDate(0)}`,breakdown=scoreBreakdownForOperational(r.periods,s,op.score);
   const sampleEligible=hardPause||op.validWindows.length>0,snapshot={...r,score:op.score,action,reason,referenceBudget:ref,suggestedBudget:suggest,budgetOwner:owner,validWindows:op.validWindows,scoreBreakdown:breakdown,sampleEligible,cplTarget:N(s.cpl_target),segmentKey:s.segment_key,cascadePause:!!N(s.cascade_pause),usdBrlRate:usd};
   const now=new Date().toISOString();recStmts.push(env.DB.prepare(`INSERT INTO optimization_recommendations(id,created_at,updated_at,segment_key,account_id,campaign_id,adset_id,ad_id,score,action,budget_owner_type,budget_owner_id,current_budget,suggested_budget,status,snapshot_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,score=excluded.score,action=excluded.action,budget_owner_type=excluded.budget_owner_type,budget_owner_id=excluded.budget_owner_id,current_budget=excluded.current_budget,suggested_budget=excluded.suggested_budget,snapshot_json=excluded.snapshot_json,status=CASE WHEN optimization_recommendations.status='REALIZADA' THEN optimization_recommendations.status ELSE 'SUGESTION_AVAILABLE' END WHERE optimization_recommendations.action IS NOT excluded.action OR round(IFNULL(optimization_recommendations.score,-1),1) IS NOT round(IFNULL(excluded.score,-1),1) OR optimization_recommendations.suggested_budget IS NOT excluded.suggested_budget OR optimization_recommendations.current_budget IS NOT excluded.current_budget OR optimization_recommendations.budget_owner_id IS NOT excluded.budget_owner_id`).bind(rid,now,now,s.segment_key,r.accountId,r.campaignId,r.adsetId,r.adId,op.score,action,owner?.type||null,owner?.id||null,owner?.currentBudget??null,suggest??null,'SUGGESTION_AVAILABLE',JSON.stringify(snapshot)));
   results.push({...snapshot,recommendationId:rid,optimizationStatus:priorMap.get(r.adId)||'SUGESTÃO DISPONÍVEL'});
 }
 // Grava as recomendações em lote; se o banco recusar (ex.: cota diária), a tela abre mesmo assim.
 let recSaveError=null;try{for(let i=0;i<recStmts.length;i+=80)await env.DB.batch(recStmts.slice(i,i+80))}catch(e){recSaveError=e.message}
 results.sort((a,b)=>(b.score??-1)-(a.score??-1));results.forEach((r,i)=>r.rank=i+1);
 const monthRows=results.map(r=>r.periods.month),spend=monthRows.reduce((a,r)=>a+N(r.spend),0),leads=monthRows.reduce((a,r)=>a+N(r.leads),0),meta=monthMeta(),budget=N(s.budget),target=N(s.lead_target),missing=Math.max(0,target-leads),remaining=Math.max(1,meta.days-meta.day+1),dailyGoal=Math.ceil(missing/remaining),pace=meta.day?leads/meta.day:0,expectedSpend=budget*(meta.day/meta.days),overview={budget,leadTarget:target,cplTarget:N(s.cpl_target),spend,leads,available:Math.max(0,budget-spend),missing,usedPct:budget?100*spend/budget:0,currentCpl:leads?spend/leads:null,dailyGoal,pace,expectedSpend};
 // Visão por segmentação (mês corrente): mesmo cálculo da visão geral, para cada segmentação.
 const allRows=[...by.values()],segmentsOverview=cfgAll.segments.map(sg=>{const rows=allRows.filter(r=>matchesSegment({campaign_name:r.campaignName,adset_name:r.adsetName,ad_name:r.adName},sg)).map(r=>r.periods.month||{}),sp=rows.reduce((a,r)=>a+N(r.spend),0),ld=rows.reduce((a,r)=>a+N(r.leads),0),bu=N(sg.budget),tg=N(sg.lead_target),mi=Math.max(0,tg-ld);
   return{segment_key:sg.segment_key,label:sg.label,budget:bu,spend:sp,expectedSpend:bu*(meta.day/meta.days),available:Math.max(0,bu-sp),usedPct:bu?100*sp/bu:0,leadTarget:tg,leads:ld,missing:mi,dailyGoal:tg?Math.ceil(mi/remaining):null,pace:meta.day?ld/meta.day:0,cplTarget:N(sg.cpl_target),currentCpl:ld?sp/ld:null,creatives:rows.length}});
 const times=Object.values(caches).map(c=>c.lastUpdated).filter(Boolean).sort(),lastUpdated=times.at(-1)||null;
 return{accounts:accountList,segment:s,overview,segmentsOverview,creatives:results,lastUpdated,settings:cfgAll.settings,recSaveError};
}
async function executeRecommendation(env,b,deps){
 const mGet=deps.metaGet||metaGet,mPost=deps.metaPost||metaPost;
 const id=String(b.recommendationId||''),key=String(b.idempotencyKey||'');if(!id||!key)throw new Error('recommendationId e idempotencyKey são obrigatórios.');
 const oldAction=await env.DB.prepare(`SELECT * FROM optimization_actions WHERE idempotency_key=?`).bind(key).first();if(oldAction)return{ok:oldAction.status==='REALIZADA',message:'Requisição idempotente já processada.',action:oldAction};
 const rec=await env.DB.prepare(`SELECT * FROM optimization_recommendations WHERE id=?`).bind(id).first();if(!rec)throw new Error('Recomendação não encontrada.');const snap=safeJson(rec.snapshot_json,{}),cfg=await deps.getMetaConfig(env),action=rec.action,now=new Date().toISOString(),aid=uid(),before={recommendationStatus:rec.status,budgetOwner:snap.budgetOwner};
 await env.DB.prepare(`INSERT INTO optimization_actions(id,recommendation_id,idempotency_key,created_at,account_id,entity_type,entity_id,action,before_json,request_json,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(aid,id,key,now,rec.account_id,action==='PAUSAR'?'ad':rec.budget_owner_type,action==='PAUSAR'?rec.ad_id:rec.budget_owner_id,action,JSON.stringify(before),JSON.stringify(b),'APLICANDO').run();
 try{
   let response,after={};
   if(action==='PAUSAR'){
     response=await mPost(rec.ad_id,{status:'PAUSED'},cfg);after={status:'PAUSED'};
     if(snap.cascadePause){
       const ads=await mGet(`${rec.adset_id}/ads`,{fields:'id,effective_status,status',limit:500},cfg),activeAds=(ads.data||[]).filter(x=>String(x.id)!==String(rec.ad_id)&&!['PAUSED','DELETED','ARCHIVED'].includes(String(x.effective_status||x.status)));
       if(!activeAds.length){await mPost(rec.adset_id,{status:'PAUSED'},cfg);const sets=await mGet(`${rec.campaign_id}/adsets`,{fields:'id,effective_status,status',limit:500},cfg),activeSets=(sets.data||[]).filter(x=>String(x.id)!==String(rec.adset_id)&&!['PAUSED','DELETED','ARCHIVED'].includes(String(x.effective_status||x.status)));if(!activeSets.length)await mPost(rec.campaign_id,{status:'PAUSED'},cfg)}
     }
   }else if(['ESCALAR','REDUZIR'].includes(action)){
     if(!rec.budget_owner_id||!snap.budgetOwner?.modifiable)throw new Error('Budget owner não editável.');
     const cur=await mGet(rec.budget_owner_id,{fields:'id,daily_budget,lifetime_budget,name'},cfg),rate=N(snap.budgetOwner.currencyRate)||1,current=N(cur.daily_budget)/100*rate,expected=N(rec.current_budget);
     if(Math.abs(current-expected)>.02){await env.DB.prepare(`UPDATE optimization_recommendations SET status='DESATUALIZADA',updated_at=? WHERE id=?`).bind(new Date().toISOString(),id).run();throw new Error(`Orçamento mudou na Meta (${current.toFixed(2)} vs ${expected.toFixed(2)}). Recalcule.`)}
     const target=N(rec.suggested_budget),minor=Math.max(1,Math.round(target/rate*100));response=await mPost(rec.budget_owner_id,{daily_budget:minor},cfg);after={daily_budget:minor,convertedBudget:target};
   }else throw new Error(`Ação ${action} não exige execução.`);
   const done=new Date().toISOString();await env.DB.prepare(`UPDATE optimization_actions SET executed_at=?,after_json=?,response_json=?,status='REALIZADA' WHERE id=?`).bind(done,JSON.stringify(after),JSON.stringify(response),aid).run();await env.DB.prepare(`UPDATE optimization_recommendations SET status='REALIZADA',updated_at=? WHERE id=?`).bind(done,id).run();return{ok:true,message:'Otimização confirmada pela Meta.',actionId:aid,response};
 }catch(e){await env.DB.prepare(`UPDATE optimization_actions SET executed_at=?,status='ERRO',error=? WHERE id=?`).bind(new Date().toISOString(),e.message,aid).run();throw e}
}
export async function handleOptimizationApi(req,env,url,stored,deps){
 if(req.method==='GET'&&url.pathname==='/api/optimization/config')return deps.json(await configPayload(env));
 if(req.method==='POST'&&url.pathname==='/api/optimization/config')return deps.json(await saveConfig(env,await deps.reqJson(req)));
 if(req.method==='GET'&&url.pathname==='/api/optimization/data')return deps.json(await dataPayload(env,url,stored,deps));
 if(req.method==='POST'&&url.pathname==='/api/optimization/sync')return deps.json(deps.syncNow?{...(await deps.syncNow()),message:'Meta Ads e PipeRun sincronizados; notas recalculadas na próxima leitura.'}:await syncAll(env,stored,deps));
 if(req.method==='POST'&&url.pathname==='/api/optimization/execute')return deps.json(await executeRecommendation(env,await deps.reqJson(req),deps));
 return deps.json({error:'Endpoint de otimização não encontrado.'},404);
}
export const __optimizationTest={scoreWindow,actionByScore,sampleEligible,suggestedBudget,operationalScore,zeroLeadPause};
