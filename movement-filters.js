/* One query model for the movement list. Periods always refer to local dates. */
(function(root){
  const PERIODS=Object.freeze(['semana','pasada','hoy','mes','anteriores','todos']);
  const STATES=Object.freeze(['todos','pendiente','abonado']);
  const TYPES=Object.freeze(['todos','gastos','abonos']);
  const BUDGETS=Object.freeze(['todos','incluidos','excluidos']);
  const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/\s+/g,' ');
  const label=value=>String(value??'').trim();
  const flag=value=>value===true || value===1 || ['true','si','1'].includes(normalize(value));
  const dateKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  function date(value){
    const text=String(value??'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return null;
    const [year,month,day]=text.split('-').map(Number),parsed=new Date(year,month-1,day,12);
    return parsed.getFullYear()===year && parsed.getMonth()===month-1 && parsed.getDate()===day ? text : null;
  }
  function range(period,today=dateKey(new Date())){
    const key=date(today);if(!key)throw new Error('Fecha de referencia inválida');
    const [year,month,day]=key.split('-').map(Number),now=new Date(year,month-1,day,12);
    // Expense weeks run from Saturday through Friday, using local calendar days.
    const start=new Date(now);start.setDate(start.getDate()-(start.getDay()+1)%7);
    if(period==='todos')return {from:null,to:null};
    if(period==='hoy')return {from:key,to:key};
    if(period==='mes')return {from:dateKey(new Date(year,month-1,1,12)),to:dateKey(new Date(year,month,0,12))};
    if(period==='anteriores'){const previous=new Date(start);previous.setDate(previous.getDate()-1);return {from:null,to:dateKey(previous)};}
    if(period==='pasada')start.setDate(start.getDate()-7);
    const end=new Date(start);end.setDate(end.getDate()+6);
    return {from:dateKey(start),to:dateKey(end)};
  }
  function paymentState(record){return flag(record.abonoTarjeta)?null:flag(record.abonado)?'abonado':'pendiente';}
  function collect(active=[],historical=[]){
    const rows=[],seen=new Set();
    for(const [items,isHistorical] of [[active,false],[historical,true]]){
      for(const record of items){
        if(!record || typeof record!=='object')continue;
        const id=Number(record.id);
        // Active copies take precedence, matching the record opened by the editor.
        if(Number.isFinite(id) && id>0){if(seen.has(id))continue;seen.add(id);}
        rows.push({...record,_esHistorico:isHistorical});
      }
    }
    return rows;
  }
  function options(values){
    const seen=new Set(),result=[];
    for(const value of values){const text=label(value),key=normalize(text);if(key && !seen.has(key)){seen.add(key);result.push(text);}}
    return result;
  }
  function searchMatches(record,query){
    const text=normalize([record.comentarios,record.cuenta,record.motivo,record.reembolsoPersona,record.reembolsoNota].filter(Boolean).join(' '));
    const amount=Number(record.cantidad),money=Number.isFinite(amount)?`${amount} ${amount.toFixed(2)}`:'';
    return normalize(query).replace(/\$\s+(?=\d)/g,'$').split(' ').filter(Boolean).every(token=>{
      const numeric=token.replace(/[$,]/g,'');
      if(token.startsWith('$'))return /^\d+(?:\.\d*)?$/.test(numeric) && money.includes(numeric);
      if(/^\d{4}-\d{2}(?:-\d{2})?$/.test(token))return (date(record.fecha)||'').startsWith(token);
      return text.includes(token) || (numeric && /^\d+(?:\.\d*)?$/.test(numeric) && money.includes(numeric));
    });
  }
  function matches(record,filters={},today=dateKey(new Date())){
    const period=PERIODS.includes(filters.period)?filters.period:'semana';
    const bounds=range(period,today),key=date(record.fecha);
    if(period!=='todos' && (!key || (bounds.from && key<bounds.from) || (bounds.to && key>bounds.to)))return false;
    if(filters.state && filters.state!=='todos' && paymentState(record)!==filters.state)return false;
    const credit=flag(record.abonoTarjeta),excluded=flag(record.ignorar);
    if(filters.type==='gastos' && credit)return false;
    if(filters.type==='abonos' && !credit)return false;
    if(filters.budget==='incluidos' && excluded)return false;
    if(filters.budget==='excluidos' && !excluded)return false;
    if(filters.account && normalize(record.cuenta)!==normalize(filters.account))return false;
    if(filters.category && normalize(record.motivo)!==normalize(filters.category))return false;
    return searchMatches(record,filters.query||'');
  }
  function query(records,filters={},today=dateKey(new Date())){
    return records.filter(record=>matches(record,filters,today)).sort((a,b)=>(date(b.fecha)||'').localeCompare(date(a.fecha)||'') || Number(b.id)-Number(a.id));
  }
  function totals(records){
    return records.reduce((sum,record)=>{
      const value=Number(record.cantidad);if(!Number.isFinite(value))return sum;
      if(flag(record.abonoTarjeta))sum.payments+=value;else sum.expenses+=value;
      return sum;
    },{expenses:0,payments:0});
  }
  const api=Object.freeze({PERIODS,STATES,TYPES,BUDGETS,normalize,label,flag,date,dateKey,range,paymentState,collect,options,matches,query,totals});
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.MovementFilters=api;
})(globalThis);
