(function(){
  const LOCAL="http://127.0.0.1:8789";
  const iso=d=>d.toISOString().slice(0,10);
  const addDays=(s,n)=>{const d=new Date(`${s}T12:00:00`);d.setDate(d.getDate()+n);return iso(d)};
  const hotCutoff=()=>{const d=new Date();d.setDate(d.getDate()-29);return iso(d)};
  async function jsonFetch(url,timeout=10000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeout);
    try{
      const r=await fetch(url,{headers:{accept:"application/json"},signal:controller.signal});
      const j=await r.json().catch(()=>({error:`HTTP ${r.status}`}));
      if(!r.ok||j.error)throw new Error(j.error||`HTTP ${r.status}`);
      return j;
    }finally{clearTimeout(timer)}
  }
  const cloud=(since,until)=>jsonFetch(`/api/history?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`,15000);
  const local=(since,until)=>jsonFetch(`${LOCAL}/api/history?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`,3500);
  function mergeRows(a,b){
    const map=new Map();
    for(const row of [...(a||[]),...(b||[])]){
      const day=String(row.day||"");if(!day)continue;
      map.set(day,{...(map.get(day)||{}),...row,day});
    }
    return [...map.values()].sort((x,y)=>x.day.localeCompare(y.day));
  }
  async function hybrid(since,until){
    const cutoff=hotCutoff();
    if(since>=cutoff){
      const j=await cloud(since,until);
      return{...j,historySource:"cloud_hot"};
    }
    if(until<cutoff){
      try{
        const j=await local(since,until);
        return{...j,historySource:"local_archive"};
      }catch(error){
        console.warn("Arquivo local indisponivel; consulta historica pode ficar parcial.",error);
        const j=await cloud(since,until);
        return{...j,historySource:"cloud_partial",archiveUnavailable:true};
      }
    }
    const oldUntil=addDays(cutoff,-1);
    let old={metaDaily:[],crmDaily:[]},archiveUnavailable=false;
    try{old=await local(since,oldUntil)}
    catch(error){archiveUnavailable=true;console.warn("Arquivo local indisponivel para trecho historico.",error)}
    const recent=await cloud(cutoff,until);
    return{
      metaDaily:mergeRows(old.metaDaily,recent.metaDaily),
      crmDaily:mergeRows(old.crmDaily,recent.crmDaily),
      since,until,
      historySource:archiveUnavailable?"cloud_hot_plus_missing_archive":"hybrid_local_cloud",
      archiveUnavailable
    };
  }
  window.historyHybridFetch=hybrid;
  window.historyArchiveStatus=async()=>{try{return await jsonFetch(`${LOCAL}/api/status`,1500)}catch{return{ok:false,offline:true}}};
})();