const assert=require('node:assert/strict');

module.exports=async function movementChecks(page,check,seed){
  const failures=[];
  async function reset(){
    await page.evaluate(()=>{
      if(modoMasivo)toggleEdicionMasiva();
      document.getElementById('toast').classList.remove('show');
    });
    await seed(page);
    await page.evaluate(()=>{
      activeFilter='todos';modoMasivo=false;seleccionMasiva.clear();
      const now=new Date(),monday=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
      monday.setDate(monday.getDate()-(monday.getDay()+6)%7);
      const day=offset=>{const d=new Date(monday);d.setDate(d.getDate()+offset);return fmtD(d);};
      const row=(id,fecha,props={})=>({id,fecha,cuenta:'Banamex',motivo:'Comida',cantidad:10,comentarios:'Compra '+id,abonado:false,ignorar:false,externo:'no',...props});
      gastos=[row(11,day(0)),row(12,today(),{abonado:true}),row(13,day(-1)),row(14,day(7)),row(15,today(),{abonoTarjeta:true,abonado:true,ignorar:true}),row(16,today(),{ignorar:true}),row(17,today(),{externo:'externo'}),row(18,today(),{cuenta:'Debito',motivo:'Otros',cantidad:25}),row(19,day(-4),{cuenta:'Debito',motivo:'Otros'}),row(20,today(),{externo:'pagado'})];
      historico=[row(21,day(-7)),row(22,today(),{cantidad:30}),row(11,day(0)),row(23,day(-14),{cuenta:'Cuenta antigua',motivo:'Categoría anterior'})];
      catalogoCuentas.push({...catalogoCuentas[0]});catalogoMotivos.push('Comida');
      document.getElementById('search-in').value='';
      document.getElementById('movement-period').value='semana';
      for(const id of ['movement-account','movement-category','movement-type','movement-budget']){const el=document.getElementById(id);if(el)el.value=el.options[0]?.value||'';}
      showTab('gastos');
    });
  }
  const ids=()=>page.locator('#gastos-list .movement-row').evaluateAll(rows=>rows.map(row=>Number(row.dataset.movement)).sort((a,b)=>a-b));
  async function run(name,work){await reset();try{await check(name,work);}catch(error){failures.push(name+': '+error.message);console.log('REPRODUCED',name,error.message.slice(0,180));}}
  await run('current-week unpaid never includes past weeks or future weeks',async()=>{
    await page.evaluate(()=>setFilter('pendiente'));
    assert.deepEqual(await ids(),[11,16,17,18,20,22]);
  });
  await run('calendar week uses dates from active and historical collections exactly once',async()=>{
    assert.deepEqual(await ids(),[11,12,15,16,17,18,20,22]);
  });
  await run('returning to the iPhone app after the week changes refreshes offline results',async()=>{
    const result=await page.evaluate(()=>{
      const OriginalDate=window.Date;
      // Resume on the known fixture's next-week Monday.
      const target=gastos.find(g=>g.id===14).fecha+'T12:00:00';
      const timestamp=new OriginalDate(target).getTime();
      window.Date=class extends OriginalDate {
        constructor(...args){super(...(args.length?args:[timestamp]));}
        static now(){return timestamp;}
      };
      try {
        window.dispatchEvent(new Event('focus'));
        return {ids:[...document.querySelectorAll('#gastos-list .movement-row')].map(r=>Number(r.dataset.movement)),reference:uiState.movementDate};
      } finally {window.Date=OriginalDate;renderGastos();}
    });
    assert.deepEqual(result.ids,[14]);assert.ok(result.reference);
  });
  await run('period and state each have a single non-overlapping control',async()=>{
    assert.equal(await page.locator('#f-hist-pendiente,#f-ignorar,#f-externo').count(),0);
    assert.deepEqual(await page.locator('#movement-state-filters button').evaluateAll(nodes=>nodes.map(n=>n.textContent.trim())),['Todos los estados','Sin abonar','Abonados']);
    const duplicates=await page.locator('#movement-account,#movement-category').evaluateAll(selects=>selects.some(select=>new Set([...select.options].map(o=>o.value)).size!==select.options.length));
    assert.equal(duplicates,false);
  });
  await run('older pending shortcut changes the visible period instead of bypassing it',async()=>{
    await page.locator('#older-pending-link').click();
    assert.equal(await page.locator('#movement-period').inputValue(),'anteriores');
    assert.deepEqual(await ids(),[13,19,21,23]);
    assert.equal(await page.locator('#f-pendiente').getAttribute('aria-pressed'),'true');
  });
  await run('account category budget and status combine without broadening the period',async()=>{
    await page.evaluate(()=>{document.getElementById('movement-account').value='Debito';document.getElementById('movement-category').value='Otros';setFilter('pendiente');});
    assert.deepEqual(await ids(),[18]);
  });
  await run('payment type is independent from payment status with clear empty results',async()=>{
    await page.evaluate(()=>{document.getElementById('movement-type').value='abonos';renderGastos();});
    assert.deepEqual(await ids(),[15]);
    await page.evaluate(()=>setFilter('pendiente'));assert.deepEqual(await ids(),[]);
    assert.match(await page.locator('#gastos-list').innerText(),/estado.*gastos|estado.*aplica/i);
  });
  await run('excluded and reimbursement flags do not masquerade as paid status',async()=>{
    await page.evaluate(()=>{document.getElementById('movement-budget').value='excluidos';setFilter('pendiente');});
    assert.deepEqual(await ids(),[16]);
    assert.match(await page.locator('#gastos-list').innerText(),/Sin abonar/);
    assert.match(await page.locator('#gastos-list').innerText(),/Fuera del presupuesto/);
  });
  await run('searching old expenses respects the chosen period until it is changed',async()=>{
    await page.locator('#search-in').fill('Compra 21');assert.deepEqual(await ids(),[]);
    await page.locator('#movement-period').selectOption('todos');assert.deepEqual(await ids(),[21]);
  });
  await run('amount search ignores date digits and currency searches only amounts',async()=>{
    await page.locator('#search-in').fill('$25');assert.deepEqual(await ids(),[18]);
    await page.locator('#search-in').fill('2026');assert.deepEqual(await ids(),[]);
  });
  await run('historical-only accounts and categories remain available for filtering',async()=>{
    assert.equal(await page.locator('#movement-account option[value="Cuenta antigua"]').count(),1);
    await page.evaluate(()=>{document.getElementById('movement-period').value='todos';document.getElementById('movement-account').value='Cuenta antigua';document.getElementById('movement-category').value='Categoría anterior';renderGastos();});
    assert.deepEqual(await ids(),[23]);
  });
  await run('changing filters removes hidden records from a bulk selection',async()=>{
    await page.evaluate(()=>{toggleEdicionMasiva();toggleSeleccionMasiva(11);});
    await page.locator('#search-in').fill('Compra 18');
    assert.equal(await page.evaluate(()=>seleccionMasiva.size),0);
    assert.equal(await page.locator('#bulk-apply').isDisabled(),true);
  });
  await run('visible totals count excluded purchases and separate card payments',async()=>{
    const summary=await page.locator('#movement-count').innerText();
    assert.match(summary,/8 movimientos/);assert.match(summary,/Gastos.*105/);assert.match(summary,/Abonos.*10/);
  });
  await run('clearing filters resets all axes and preserves a valid weekly range',async()=>{
    await page.evaluate(()=>{document.getElementById('movement-period').value='todos';document.getElementById('movement-type').value='abonos';document.getElementById('movement-budget').value='excluidos';setFilter('abonado');uiClearMovementFilters();});
    assert.deepEqual(await ids(),[11,12,15,16,17,18,20,22]);
    assert.equal(await page.locator('#movement-type').inputValue(),'todos');
    assert.equal(await page.locator('#movement-budget').inputValue(),'todos');
    assert.equal(await page.locator('#clear-movement-filters').isVisible(),false);
  });
  await run('filters remain selected after switching movement views',async()=>{
    await page.locator('#movement-filter-toggle').tap();
    assert.equal(await page.locator('#movement-filter-toggle').getAttribute('aria-expanded'),'true');
    await page.locator('#movement-period').selectOption('todos');
    await page.locator('#movement-account').selectOption('Debito');
    await page.locator('#movement-category').selectOption('Otros');
    await page.locator('#movement-type').selectOption('gastos');
    await page.locator('#movement-budget').selectOption('incluidos');
    await page.locator('#f-pendiente').tap();
    assert.deepEqual(await ids(),[18,19]);
    await page.locator('#content-gastos [data-go="externos"]').tap();
    await page.locator('#content-externos [data-go="gastos"]').tap();
    assert.deepEqual(await ids(),[18,19]);
    assert.equal(await page.locator('#f-pendiente').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('#movement-type').inputValue(),'gastos');
    assert.equal(await page.locator('#movement-budget').inputValue(),'incluidos');
  });
  await run('bulk account changes recalculate statement periods and leave hidden expenses intact',async()=>{
    const result=await page.evaluate(()=>{
      gastos.find(g=>g.id===11).periodoCorte='stale';
      toggleEdicionMasiva();toggleSeleccionMasiva(11);
      document.getElementById('masiva-cuenta').value='Debito';aplicarEdicionMasiva();
      return {changed:gastos.find(g=>g.id===11),other:gastos.find(g=>g.id===13),bulk:modoMasivo};
    });
    assert.equal(result.changed.cuenta,'Debito');assert.equal(result.changed.periodoCorte,null);
    assert.equal(result.other.cuenta,'Banamex');assert.equal(result.bulk,false);
  });
  await run('bulk edits preserve data and selection after a storage failure and can retry',async()=>{
    const result=await page.evaluate(()=>{
      toggleEdicionMasiva();toggleSeleccionMasiva(11);document.getElementById('masiva-motivo').value='Otros';
      const original=Storage.prototype.setItem;
      try {
        Storage.prototype.setItem=function(key,value){if(key===appDataStorageKey())throw new DOMException('fixture quota','QuotaExceededError');return original.call(this,key,value);};
        aplicarEdicionMasiva();
      } finally {Storage.prototype.setItem=original;}
      const before={category:gastos.find(g=>g.id===11).motivo,selected:seleccionMasiva.size,bulk:modoMasivo};
      aplicarEdicionMasiva();return {before,after:gastos.find(g=>g.id===11).motivo,count:gastos.length};
    });
    assert.deepEqual(result.before,{category:'Comida',selected:1,bulk:true});
    assert.equal(result.after,'Otros');assert.equal(result.count,10);
  });
  await run('bulk editing protects card payments and archived rows',async()=>{
    await page.evaluate(()=>{toggleEdicionMasiva();toggleSeleccionMasiva(22);});
    assert.equal(await page.locator('[data-movement="22"]').isDisabled(),true);
    assert.equal(await page.evaluate(()=>seleccionMasiva.size),0);
    const result=await page.evaluate(()=>{
      toggleSeleccionMasiva(15);document.getElementById('masiva-estado').value='pendiente';aplicarEdicionMasiva();
      document.getElementById('masiva-estado').value='';document.getElementById('masiva-cuenta').value='Debito';aplicarEdicionMasiva();
      return gastos.find(g=>g.id===15);
    });
    assert.equal(result.abonado,true);assert.equal(result.cuenta,'Banamex');assert.equal(result.ignorar,true);
  });
  await run('older pending notice uses the current account category and search',async()=>{
    await page.evaluate(()=>{document.getElementById('movement-account').value='Debito';document.getElementById('movement-category').value='Otros';setFilter('pendiente');});
    assert.match(await page.locator('#gastos-hist-pend-text').innerText(),/^1 gasto/);
    await page.locator('#search-in').fill('Compra 18');assert.equal(await page.locator('#gastos-hist-pend-alert').isVisible(),false);
  });
  await run('reimbursement filters never double-count an archived copy',async()=>{
    await page.evaluate(()=>{historico.push({...gastos.find(g=>g.id===17)});showTab('externos');setExtFilter('todos');});
    assert.equal(await page.locator('#externos-list .ext-item').count(),2);
    await page.locator('#ef-pendiente').tap();assert.equal(await page.locator('#externos-list .ext-item').count(),1);
    assert.match(await page.locator('#externos-list').innerText(),/Compra 17/);
    await page.locator('#ef-pagado').tap();assert.equal(await page.locator('#externos-list .ext-item').count(),1);
    assert.match(await page.locator('#externos-list').innerText(),/Compra 20/);
    assert.equal(await page.locator('#ef-pagado').getAttribute('aria-pressed'),'true');
    await page.evaluate(()=>setExtFilter('todos'));
  });
  await run('expanded filters and unpaid summaries fit iPhone widths with touch controls',async()=>{
    await page.evaluate(()=>{document.getElementById('movement-filter-panel').hidden=false;document.getElementById('movement-filter-toggle').setAttribute('aria-expanded','true');setFilter('pendiente');});
    for(const width of [320,390,430]){
      await page.setViewportSize({width,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No overflow at '+width);
      for(const box of await page.locator('#movement-state-filters button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height};}))){
        assert.ok(box.left>=0 && box.right<=width);assert.ok(box.height>=44);
      }
    }
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:require('node:path').join(process.env.TEST_OUTPUT||require('node:path').resolve('test-results'),'iphone-movement-filters.png'),fullPage:true});
    await page.evaluate(()=>{document.getElementById('movement-filter-panel').hidden=true;document.getElementById('movement-filter-toggle').setAttribute('aria-expanded','false');});
  });
  await seed(page);
  if(failures.length)throw new Error('Movement failures:\n'+failures.join('\n'));
};
