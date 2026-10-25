const test=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const F=require('../movement-filters.js');
const today='2026-10-25'; // Sunday: week is October 19–25.
const make=(id,fecha,fields={})=>({id,fecha,comentarios:'Compra '+id,cuenta:'Tarjeta',motivo:'Comida',cantidad:10,abonado:false,ignorar:false,externo:'no',...fields});
const rows=[
  make(1,'2026-10-19'),make(2,today,{abonado:true}),make(3,'2026-10-18'),
  make(4,'2026-10-26'),make(5,today,{abonoTarjeta:true,abonado:true,ignorar:true}),
  make(6,today,{ignorar:true}),make(7,today,{externo:'externo'}),
  make(8,today,{cuenta:'Débito',motivo:'Otros',cantidad:25}),make(9,'2026-09-30'),
  make(10,'2026-11-01'),make(11,'fecha inválida'),make(12,today,{externo:'pagado'})
];
const ids=rows=>rows.map(r=>r.id).sort((a,b)=>a-b);
test('1,215 combinations intersect date, state, type, budget, account and category',()=>{
  const dateIds={semana:[1,2,5,6,7,8,12],hoy:[2,5,6,7,8,12],mes:[1,2,3,4,5,6,7,8,12],anteriores:[3,9],todos:rows.map(r=>r.id)};
  let combinations=0;
  for(const period of F.PERIODS)for(const state of F.STATES)for(const type of F.TYPES)
  for(const budget of F.BUDGETS)for(const account of ['', 'Tarjeta','Débito'])for(const category of ['', 'Comida','Otros']){
    const filters={period,state,type,budget,account,category};
    const expected=rows.filter(r=>dateIds[period].includes(r.id))
      .filter(r=>state==='todos'||(!r.abonoTarjeta && r.abonado===(state==='abonado')))
      .filter(r=>type==='todos'||Boolean(r.abonoTarjeta)===(type==='abonos'))
      .filter(r=>budget==='todos'||r.ignorar===(budget==='excluidos'))
      .filter(r=>!account||r.cuenta===account).filter(r=>!category||r.motivo===category);
    assert.deepEqual(ids(F.query(rows,filters,today)),ids(expected),JSON.stringify(filters));
    combinations++;
  }
  assert.equal(combinations,1215);
});
test('Monday and Sunday are inclusive; adjacent weeks never leak',()=>{
  for(const now of ['2026-10-19','2026-10-21','2026-10-25']){
    assert.deepEqual(F.range('semana',now),{from:'2026-10-19',to:'2026-10-25'});
    assert.deepEqual(ids(F.query(rows,{period:'semana'},now)),[1,2,5,6,7,8,12]);
  }
});
test('calendar boundaries handle years, leap days and full months',()=>{
  assert.deepEqual(F.range('semana','2027-01-01'),{from:'2026-12-28',to:'2027-01-03'});
  assert.deepEqual(F.range('anteriores','2027-01-01'),{from:null,to:'2026-12-27'});
  assert.deepEqual(F.range('mes','2024-02-20'),{from:'2024-02-01',to:'2024-02-29'});
  assert.deepEqual(F.range('mes','2025-02-20'),{from:'2025-02-01',to:'2025-02-28'});
  assert.deepEqual(F.range('mes','2026-12-01'),{from:'2026-12-01',to:'2026-12-31'});
});
test('local week boundaries survive DST and differing time zones',()=>{
  for(const TZ of ['America/Los_Angeles','America/Mexico_City','Pacific/Auckland']){
    const actual=JSON.parse(execFileSync(process.execPath,['-e',`const f=require('./movement-filters.js');console.log(JSON.stringify([f.range('semana','2026-03-08'),f.range('semana','2026-11-01')]));`],{cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,TZ},encoding:'utf8'}));
    assert.deepEqual(actual,[{from:'2026-03-02',to:'2026-03-08'},{from:'2026-10-26',to:'2026-11-01'}],TZ);
  }
});
test('invalid dates stay out of bounded periods and remain discoverable in all dates',()=>{
  for(const value of ['','2026-02-29','2026-13-01','2026-00-01','2026-04-31','23/10/2026',null]){
    assert.equal(F.date(value),null);
    assert.equal(F.matches(make(1,value),{period:'semana'},today),false);
    assert.equal(F.matches(make(1,value),{period:'todos'},today),true);
  }
  assert.equal(F.date('2024-02-29'),'2024-02-29');
  assert.equal(F.date('2026-10-25T23:59:00'),'2026-10-25');
});
test('record identity is unique across collections without mutating stored data',()=>{
  const active=Object.freeze([Object.freeze(make(1,today)),Object.freeze(make(2,today))]);
  const history=[make(1,'2025-01-01'),make(3,today),make(3,today)];
  const snapshot=JSON.stringify({active,history}),all=F.collect(active,history);
  assert.deepEqual(ids(all),[1,2,3]);
  assert.equal(all.find(r=>r.id===1)._esHistorico,false);
  assert.equal(all.find(r=>r.id===3)._esHistorico,true);
  assert.equal(F.query(all,{period:'semana'},today).length,3);
  assert.equal(JSON.stringify({active,history}),snapshot);
});
test('account and category catalogs deduplicate accents, casing and spaces',()=>{
  assert.deepEqual(F.options(['Comida',' comida ','COMIDA','Débito','Debito','','  ',null,'Vieja']),['Comida','Débito','Vieja']);
  assert.equal(F.matches(rows[7],{account:' debito ',category:' OTROS '},today),true);
});
test('search handles accents, multiple words and formatted amounts without overriding dates',()=>{
  const record=make(30,today,{comentarios:'Café del centro',cantidad:1250,cuenta:'Débito'});
  for(const query of ['cafe CENTRO','centro cafe','debito cafe','$1,250.00','$ 1,250.00','1250','2026-10-25']){
    assert.equal(F.matches(record,{query},today),true,query);
  }
  assert.equal(F.matches(record,{query:'cafe farmacia'},today),false);
  // Numeric searches must not match the month/day hidden in every stored date.
  assert.equal(F.matches(record,{query:'2026'},today),false);
  assert.equal(F.matches(make(40,today,{cantidad:35,comentarios:'Mercado'}),{query:'25'},today),false);
  assert.equal(F.matches(make(41,today,{cantidad:35,comentarios:'Ticket 1250.00'}),{query:'$1,250.00'},today),false);
  assert.equal(F.matches({...record,fecha:'2025-01-01'},{query:'cafe'},today),false);
  assert.equal(F.matches({...record,fecha:'2025-01-01'},{query:'cafe',period:'todos'},today),true);
});
test('status remains independent of budget and reimbursements and excludes payment operations',()=>{
  for(const fields of [{ignorar:true},{externo:'externo'},{externo:'pagado'}]){
    assert.equal(F.paymentState(make(1,today,fields)),'pendiente');
    assert.equal(F.paymentState(make(1,today,{...fields,abonado:true})),'abonado');
  }
  assert.equal(F.paymentState(make(1,today,{abonoTarjeta:true})),null);
  assert.equal(F.paymentState(make(1,today,{abonado:'SI'})),'abonado');
  assert.equal(F.paymentState(make(1,today,{abonado:'false'})),'pendiente');
});
test('totals include every visible purchase and keep card payments separate',()=>{
  const current=F.query(rows,{period:'semana'},today);
  assert.deepEqual(F.totals(current),{expenses:75,payments:10});
  assert.deepEqual(F.totals([]),{expenses:0,payments:0});
  assert.deepEqual(F.totals([make(1,today,{cantidad:'NaN'}),make(2,today,{cantidad:'20'})]),{expenses:20,payments:0});
});
