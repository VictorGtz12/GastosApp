const assert=require('node:assert/strict');
module.exports=async function flows(page,context,check,seed){
  const failures=[];
  async function reset(){
    await page.evaluate(()=>{
      if(modoMasivo)toggleEdicionMasiva();
      document.querySelectorAll('.overlay.open').forEach(el=>closeModal(el.id));
      localStorage.clear();clearTimeout(window._autoSyncTimer);
      editingId=null;window._editandoHistorico=false;window._desdeConciliador=null;
      Object.assign(uiState,{formScope:null,skipDraft:false,restoring:false,creditMode:false,categoryManual:false,accountManual:false});
      activeFilter='todos';conciliados={};reconciliationScope='';window._reconciliationRequest=null;
      pantryBarcodes=[];pantryMovements=[];pantryMovementLines=[];pantryExpirationProfiles=[];pantryOcrCorrections=[];
    });
    await seed(page);
    await page.evaluate(()=>{syncBloqueado=true;saveLocal();syncBloqueado=false;});
  }
  async function run(name,work){await reset();try{await check(name,work);}catch(error){failures.push(name+': '+error.message);console.log('REPRODUCED',name,error.message.slice(0,180));}}
  async function quota(work){return page.evaluate(async work=>{
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){if(key===appDataStorageKey())throw new DOMException('fixture quota','QuotaExceededError');return original.call(this,key,value);};
    try{return await (new Function('return ('+work+')()'))();}finally{Storage.prototype.setItem=original;}
  },work.toString());}
  await run('clearing the entire draft does not resurrect its previous amount',async()=>{
    const result=await page.evaluate(()=>{
      showTab('nuevo');uiDiscardDraft();document.getElementById('f-cantidad').value='19';uiCaptureDraft();
      document.getElementById('f-cantidad').value='';uiCaptureDraft();showTab('menu');showTab('nuevo');return document.getElementById('f-cantidad').value;
    });assert.equal(result,'');
  });
  await run('historical expenses retain archived account and category when edited',async()=>{
    const result=await page.evaluate(async()=>{
      historico[0].cuenta='Banco anterior';historico[0].motivo='Categoría anterior';uiStartEdit(3,true);
      document.getElementById('f-cantidad').value='80';await uiSubmitExpense();
      return {record:historico[0],tab:tabActualGlobal};
    });assert.equal(result.record.cuenta,'Banco anterior');assert.equal(result.record.motivo,'Categoría anterior');assert.equal(result.record.cantidad,80);assert.notEqual(result.tab,'nuevo');
  });
  await run('renaming savings keeps expense withdrawals linked',async()=>{
    const result=await page.evaluate(async()=>{
      gastos[0].ahorroDesc='Emergencias';cuentasAhorro[0].movimientos.push(nuevoMov({tipo:'retiro',cantidad:65,gastoId:1,fecha:today()}));
      editarCuentaAhorro(1);document.getElementById('nc-nombre').value='Reserva';await crearCuentaAhorro();
      return {name:gastos[0].ahorroDesc,balance:saldoCuenta(cuentasAhorro[0])};
    });assert.deepEqual(result,{name:'Reserva',balance:1935});
  });
  await run('duplicate savings names and negative targets are rejected',async()=>{
    await page.evaluate(async()=>{openNuevaCuenta();document.getElementById('nc-nombre').value='Emergencias';await crearCuentaAhorro();});
    assert.equal(await page.evaluate(()=>cuentasAhorro.length),1);
    await page.evaluate(async()=>{openNuevaCuenta();document.getElementById('nc-nombre').value='Viaje';document.getElementById('nc-meta').value='-10';await crearCuentaAhorro();});
    assert.equal(await page.evaluate(()=>cuentasAhorro.length),1);
  });
  await run('savings withdrawal edits cannot create a negative balance',async()=>{
    const result=await page.evaluate(()=>{
      cuentasAhorro[0].movimientos.push(nuevoMov({tipo:'retiro',cantidad:10,fecha:today()}));
      editarMovimientoAhorro(1,1);document.getElementById('editar-mov-cantidad').value='3000';confirmarEditarMovAhorro();return saldoCuenta(cuentasAhorro[0]);
    });assert.equal(result,1990);
  });
  await run('editing a savings withdrawal linked to an expense opens that expense',async()=>{
    const result=await page.evaluate(()=>{
      gastos[0].ahorroDesc='Emergencias';cuentasAhorro[0].movimientos.push(nuevoMov({tipo:'retiro',cantidad:65,gastoId:1,fecha:today()}));
      showTab('ahorros');editarMovimientoAhorro(1,1);return {tab:tabActualGlobal,id:editingId};
    });assert.deepEqual(result,{tab:'nuevo',id:1});
  });
  await run('failed savings deposits can retry without duplicating money',async()=>{
    await page.evaluate(()=>{openMovAhorro(1,'abono');document.getElementById('ahorro-cantidad').value='20';});
    const failed=await quota(async()=>{try{await confirmarMovAhorro();}catch{}return {balance:saldoCuenta(cuentasAhorro[0]),open:document.getElementById('modal-ahorro').classList.contains('open')};});
    assert.deepEqual(failed,{balance:2000,open:true});
    await page.evaluate(()=>confirmarMovAhorro());assert.equal(await page.evaluate(()=>saldoCuenta(cuentasAhorro[0])),2020);
  });
  await run('failed transfers preserve both account balances',async()=>{
    await page.evaluate(()=>{cuentasAhorro.push({id:2,nombre:'Viaje',movimientos:[]});openTraspaso(1);document.getElementById('traspaso-cantidad').value='20';});
    const balances=await quota(async()=>{try{await confirmarTraspaso();}catch{}return cuentasAhorro.map(saldoCuenta);});assert.deepEqual(balances,[2000,0]);
  });
  await run('failed weekly close preserves active expenses and pending operations',async()=>{
    await page.evaluate(()=>openCorte());
    const result=await quota(async()=>{const before=getPendingSyncOps().length;try{await hacerCorte();}catch{}return {active:gastos.length,history:historico.length,queued:getPendingSyncOps().length-before};});
    assert.deepEqual(result,{active:2,history:1,queued:0});
  });
  await run('card cutoffs clamp to February end including leap years',async()=>{
    const result=await page.evaluate(()=>{catalogoCuentas[0].diaCorte=31;return [calcularPeriodoCorte('Banamex','2026-02-20'),calcularPeriodoCorte('Banamex','2024-02-29'),periodoDesde('Banamex|2026-03-31')];});
    assert.deepEqual(result,['Banamex|2026-02-28','Banamex|2024-02-29','2026-03-01']);
  });
  await run('editing a catalog cannot create duplicate accounts or categories',async()=>{
    await page.evaluate(async()=>{editarCuenta(1);document.getElementById('cc-nombre').value='Banamex';await guardarCuenta_cat();});
    assert.equal(await page.evaluate(()=>catalogoCuentas[1].nombre),'Debito');
    await page.evaluate(async()=>{editarMotivo(2);document.getElementById('cm-nombre').value='Comida';await guardarMotivo_cat();});
    assert.equal(await page.evaluate(()=>catalogoMotivos[2]),'Otros');
  });
  await run('debt capture rejects negative totals and invalid paid installments',async()=>{
    const count=await page.evaluate(()=>{
      abrirNuevaDeuda();for(const [id,value] of Object.entries({'deuda-nombre':'Compra','deuda-total':'-60','deuda-cuota':'20','deuda-meses':'3','deuda-dia':'15','deuda-pagados':'-1'}))document.getElementById(id).value=value;
      guardarDeuda();return deudas.length;
    });assert.equal(count,0);
  });
  await run('editing a paid-off debt is allowed without resetting its start date',async()=>{
    const result=await page.evaluate(()=>{
      deudas=[{id:1,nombre:'Compra',cuenta:'Banamex',total:60,cuota:20,mesesTotal:3,mesesPagados:3,diaCorte:15,fechaInicio:'2025-01-10'}];editarDeuda(0);document.getElementById('deuda-nombre').value='Equipo';guardarDeuda();return deudas[0];
    });assert.equal(result.nombre,'Equipo');assert.equal(result.fechaInicio,'2025-01-10');
  });
  await run('pantry physical adjustment requires an explicit quantity',async()=>{
    const quantity=await page.evaluate(()=>{showTab('despensa');openPantryAdjustment('lot1');document.getElementById('pantry-adj-qty').value='';confirmPantryAdjustment();return pantryLots[0].quantity;});assert.equal(quantity,3);
  });
  await run('selecting another pantry lot updates the displayed physical quantity',async()=>{
    await page.evaluate(()=>{pantryLots.push({...pantryLots[0],id:'lot2',quantity:7});openPantryAdjustment('lot1');});
    await page.locator('#pantry-adj-lot').selectOption('lot2');assert.equal(await page.locator('#pantry-adj-qty').inputValue(),'7');
  });
  await run('pantry can correct a zero-stock lot after a physical recount',async()=>{
    const quantity=await page.evaluate(()=>{pantryLots[0].quantity=0;openPantryAdjustment('lot1');document.getElementById('pantry-adj-qty').value='2';confirmPantryAdjustment();return pantryLots[0].quantity;});assert.equal(quantity,2);
  });
  await run('failed pantry entry retains the form and does not add stock twice',async()=>{
    await page.evaluate(()=>{showTab('despensa');openPantryEntry('p1');document.getElementById('pantry-entry-qty').value='2';});
    const result=await quota(()=>{try{confirmPantryEntry();}catch{}return {qty:pantryQty(),movements:pantryMovements.length,open:document.getElementById('modal-pantry-form').classList.contains('open')};});
    assert.deepEqual(result,{qty:3,movements:0,open:true});
    await page.evaluate(()=>confirmPantryEntry());assert.equal(await page.evaluate(()=>pantryQty()),5);
  });
  await run('all navigation views expose working primary action handlers',async()=>{
    const missing=await page.evaluate(()=>{
      const missing=new Set();for(const tab of TABS){showTab(tab);for(const el of document.querySelectorAll('.content.active [onclick]')){
        const name=/^\s*([\w$]+)\s*\(/.exec(el.getAttribute('onclick'))?.[1];if(name && !['if','confirm'].includes(name) && typeof window[name]!=='function')missing.add(name);
      }}return [...missing];
    });assert.deepEqual(missing,[]);
  });
  await run('a card payment with an archived account retains its operation and statement period',async()=>{
    const result=await page.evaluate(async()=>{
      historico[0]={...historico[0],cuenta:'Tarjeta anterior',abonoTarjeta:true,abonado:true,ignorar:true,periodoCorte:'Tarjeta anterior|2025-01-28'};
      uiStartEdit(3,true);document.getElementById('f-comentarios-input').value='Corregido';await uiSubmitExpense();return historico[0];
    });assert.equal(result.abonoTarjeta,true);assert.equal(result.ignorar,true);assert.equal(result.periodoCorte,'Tarjeta anterior|2025-01-28');assert.equal(result.comentarios,'Corregido');
  });
  await run('sub-cent expense amounts are rejected instead of silently rounded',async()=>{
    const count=await page.evaluate(async()=>{showTab('nuevo');uiDiscardDraft();document.getElementById('f-cantidad').value='0.001';await uiSubmitExpense();return gastos.length;});assert.equal(count,2);
  });
  await run('a savings balance can be fully withdrawn after decimal arithmetic',async()=>{
    const balance=await page.evaluate(async()=>{
      cuentasAhorro[0].movimientos=[nuevoMov({tipo:'abono',cantidad:.3,fecha:today()}),nuevoMov({tipo:'retiro',cantidad:.1,fecha:today()})];
      openMovAhorro(1,'retiro');document.getElementById('ahorro-cantidad').value='.2';await confirmarMovAhorro();return saldoCuenta(cuentasAhorro[0]);
    });assert.equal(balance,0);
  });
  await run('savings edits resolve their original movement after a list reorder',async()=>{
    const result=await page.evaluate(()=>{
      cuentasAhorro[0].movimientos.push(nuevoMov({tipo:'abono',cantidad:10,fecha:today()}));editarMovimientoAhorro(1,1);
      const id=cuentasAhorro[0].movimientos[1].movId;cuentasAhorro[0].movimientos.reverse();document.getElementById('editar-mov-cantidad').value='15';confirmarEditarMovAhorro();return cuentasAhorro[0].movimientos.find(m=>m.movId===id).cantidad;
    });assert.equal(result,15);
  });
  await run('a cutoff exception remains correct when moved across the end of a month',async()=>{
    const result=await page.evaluate(()=>{
      catalogoCuentas[0].diaCorte=28;openCorteTarjeta('Banamex');window._openExc();
      document.getElementById('exc-periodo-key').value='2026-02-28';document.getElementById('exc-fecha-nueva').value='2026-03-02';guardarExcepcion();
      return {original:excepciones[0].FechaOriginal,period:calcularPeriodoCorte('Banamex','2026-03-01'),start:periodoDesde('Banamex|2026-03-02')};
    });assert.deepEqual(result,{original:'2026-02-28',period:'Banamex|2026-03-02',start:'2026-01-29'});
  });
  await run('closing a scanner before camera permission resolves releases the late stream',async()=>{
    const result=await page.evaluate(async()=>{
      const original=Object.getOwnPropertyDescriptor(navigator,'mediaDevices'),video=document.getElementById('pantry-scan-video');let release,stopped=0,attached;
      const stream={getTracks:()=>[{stop(){stopped++;}}]};
      Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>new Promise(resolve=>release=resolve)}});
      Object.defineProperty(video,'srcObject',{configurable:true,get(){return attached;},set(value){attached=value;}});
      try{const opening=startPantryScanner(()=>{});closePantryScanner();release(stream);await opening;return {stopped,active:!!pantryScanner.stream};}
      finally{closePantryScanner();delete video.srcObject;if(original)Object.defineProperty(navigator,'mediaDevices',original);else delete navigator.mediaDevices;}
    });assert.deepEqual(result,{stopped:1,active:false});
  });
  await run('closing the OCR camera through the shared modal close releases its tracks',async()=>{
    const result=await page.evaluate(()=>{
      let stopped=0;pantryOcr.stream={getTracks:()=>[{stop(){stopped++;}}]};openModal('modal-pantry-ocr');closeModal('modal-pantry-ocr');return {stopped,active:!!pantryOcr.stream};
    });assert.deepEqual(result,{stopped:1,active:false});
  });
  await run('bank capture fills immediately and removes exactly one saved bank charge',async()=>{
    const result=await page.evaluate(async()=>{
      abrirConciliacion();const movement={fecha:today(),monto:20,descripcion:'Banco prueba'};
      window._noConcilBanco=[{...movement},{...movement}];registrarDesdeBanco(movement);
      const before=document.getElementById('f-cantidad').value;await uiSubmitExpense();
      return {before,count:gastos.length,remaining:window._noConcilBanco.length,tab:tabActualGlobal};
    });assert.deepEqual(result,{before:'20',count:3,remaining:1,tab:'conciliacion'});
  });
  await run('reconciliation checkmarks persist on this device and stay isolated by workspace',async()=>{
    const result=await page.evaluate(()=>{
      abrirConciliacion();toggleConcil(1);const first=concilCuenta+'|'+concilPeriodo;
      conciliados={};reconciliationScope='';renderConciliacion();const restored=!!conciliados[first]?.[1];
      const old=currentWorkspaceId();setCurrentWorkspaceId('other-reconciliation');reconciliationScope='';loadReconciliationState();const separate=Object.keys(conciliados).length===0;
      setCurrentWorkspaceId(old);loadReconciliationState();return {restored,separate};
    });assert.deepEqual(result,{restored:true,separate:true});
  });
  await run('a late statement extraction cannot publish into a different account',async()=>{
    const result=await page.evaluate(async()=>{
      abrirConciliacion();const original=extraerTextoPDF;let release;extraerTextoPDF=()=>new Promise(resolve=>release=resolve);
      const input={files:[new File(['fixture'],'bank.pdf',{type:'application/pdf'})],value:'bank.pdf'};
      try{
        const parsing=procesarEstadoCuenta({target:input});
        for(let i=0;i<30&&!release;i++)await new Promise(resolve=>setTimeout(resolve,0));if(!release)throw new Error('Extraction did not start');
        concilCuenta='Otra cuenta';window._bancMovs=[];release('Estado bancario de prueba con suficiente texto para verificar el procesamiento.');await parsing;
        return window._bancMovs.length;
      }finally{extraerTextoPDF=original;}
    });assert.equal(result,0);
  });
  await run('an expense already saved is preserved even when the following navigation fails',async()=>{
    const result=await page.evaluate(async()=>{
      showTab('nuevo');uiDiscardDraft();document.getElementById('f-cantidad').value='5';const original=showTab;
      showTab=()=>{throw new Error('fixture navigation failure');};
      try{await uiSubmitExpense();return {memory:gastos.length,stored:JSON.parse(localStorage.getItem(appDataStorageKey())).gastos.length};}finally{showTab=original;}
    });assert.deepEqual(result,{memory:3,stored:3});
  });
  await run('renaming a bank keeps its expenses statements rules and draft together',async()=>{
    const result=await page.evaluate(async()=>{
      gastos[0].periodoCorte='Banamex|2026-10-28';reglasAutomaticas=[{texto:'Cafe',cuenta:'Banamex',motivo:'Comida'}];
      showTab('nuevo');uiDiscardDraft();document.getElementById('f-cantidad').value='10';uiCaptureDraft();showTab('catalogos');
      editarCuenta(0);document.getElementById('cc-nombre').value='Tarjeta principal';await guardarCuenta_cat();
      return {name:gastos[0].cuenta,period:gastos[0].periodoCorte,rule:reglasAutomaticas[0].cuenta,draft:JSON.parse(localStorage.getItem(uiDraftKey())).fields['f-cuenta']};
    });assert.deepEqual(result,{name:'Tarjeta principal',period:'Tarjeta principal|2026-10-28',rule:'Tarjeta principal',draft:'Tarjeta principal'});
  });
  await run('renaming a category keeps transactions and automatic rules grouped correctly',async()=>{
    const result=await page.evaluate(async()=>{
      reglasAutomaticas=[{texto:'Cafe',cuenta:'Banamex',motivo:'Comida'}];editarMotivo(0);document.getElementById('cm-nombre').value='Alimentos';await guardarMotivo_cat();return {category:gastos[0].motivo,rule:reglasAutomaticas[0].motivo};
    });assert.deepEqual(result,{category:'Alimentos',rule:'Alimentos'});
  });
  await run('saving settings after a weekly close never forces an overwrite of local history',async()=>{
    const result=await page.evaluate(async()=>{
      historico.push(...gastos);gastos=[];queueSyncOperation('corte');localStorage.setItem('lastSync','2025-01-01');
      openModal('modal-ajustes');document.getElementById('ajuste-presupuesto').value='80';document.getElementById('ajuste-modo-viaje').checked=false;
      const originalDownload=downloadRemote,originalUpload=uploadRemote;let downloaded=false;
      downloadRemote=async()=>{downloaded=true;return true;};uploadRemote=async()=>true;
      try{await guardarAjustes();return {downloaded,history:historico.length,budget:PRESUPUESTO};}finally{downloadRemote=originalDownload;uploadRemote=originalUpload;localStorage.setItem('modoViaje','1');}
    });assert.deepEqual(result,{downloaded:false,history:3,budget:80});
  });
  await run('failed settings save restores the budget and releases the sync lock',async()=>{
    await page.evaluate(()=>{openModal('modal-ajustes');document.getElementById('ajuste-presupuesto').value='80';document.getElementById('ajuste-modo-viaje').checked=true;});
    const result=await quota(async()=>{await guardarAjustes();return {budget:PRESUPUESTO,locked:syncBloqueado,open:document.getElementById('modal-ajustes').classList.contains('open')};});
    assert.deepEqual(result,{budget:100,locked:false,open:true});
  });
  await run('a failed first settings download never rolls back a newer saved capture',async()=>{
    const result=await page.evaluate(async()=>{
      gastos=[];historico=[];cuentasAhorro=[];recurrentes=[];deudas=[];pantryLots=[];
      for(const key of ['lastSync','lastRemoteSync','localModified'])localStorage.removeItem(key);
      setPendingSyncOps([]);localStorage.setItem(workspaceStorageKey('structuredDirty'),'{}');
      openModal('modal-ajustes');document.getElementById('ajuste-presupuesto').value='80';document.getElementById('ajuste-modo-viaje').checked=false;
      const originalDownload=downloadRemote,originalStorage=Storage.prototype.setItem;let release,force;
      downloadRemote=async value=>{force=value;return new Promise(resolve=>release=()=>resolve('skip'));};
      try{
        const settings=guardarAjustes();for(let i=0;i<20&&!release;i++)await Promise.resolve();if(!release)throw new Error('Download did not start');
        localStorage.setItem('modoViaje','1');showTab('nuevo');uiDiscardDraft();document.getElementById('f-cantidad').value='5';await guardarGasto();
        Storage.prototype.setItem=function(key,value){if(key===appDataStorageKey())throw new DOMException('fixture quota','QuotaExceededError');return originalStorage.call(this,key,value);};
        release();await settings;return {force,count:gastos.length,stored:JSON.parse(localStorage.getItem(appDataStorageKey())).gastos.length,locked:syncBloqueado};
      }finally{downloadRemote=originalDownload;Storage.prototype.setItem=originalStorage;}
    });assert.deepEqual(result,{force:false,count:1,stored:1,locked:false});
  });
  await reset();
  if(failures.length)throw new Error('Flow failures:\n'+failures.join('\n'));
};
