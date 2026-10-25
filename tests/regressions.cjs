const assert = require('node:assert/strict');

module.exports = async function regressions(page, context, check, seed) {
  const failures=[];
  async function reset(){
    await page.evaluate(()=>{
      localStorage.clear();clearTimeout(window._autoSyncTimer);
      document.querySelectorAll('.overlay.open').forEach(el=>closeModal(el.id));
      editingId=null;window._editandoHistorico=false;window._desdeConciliador=null;window._guardarGastoPendiente=null;
      Object.assign(uiState,{formScope:null,skipDraft:false,restoring:false,creditMode:false,categoryManual:false,accountManual:false});
      activeFilter='todos';modoMasivo=false;seleccionMasiva.clear();
    });
    await seed(page);
  }
  async function run(name,work){await reset();try{await check(name,work);}catch(error){failures.push(name+': '+error.message);console.log('REPRODUCED',name,error.message.slice(0,150));}}
  async function expense(){
    await page.evaluate(async()=>{
      showTab('nuevo');uiDiscardDraft();document.getElementById('f-cantidad').value='10';
      setDescAhorro(true);document.getElementById('f-ahorro-cuenta').value='1';await guardarGasto();
    });
  }
  await run('historical expense edits update their savings withdrawal',async()=>{
    await expense();
    const balance=await page.evaluate(async()=>{
      const g=gastos.pop();historico.push(g);uiStartEdit(g.id,true);
      document.getElementById('f-cantidad').value='15';await guardarGasto();return saldoCuenta(cuentasAhorro[0]);
    });assert.equal(balance,1985);
  });
  await run('switching savings A to B and back does not leave free money',async()=>{
    await expense();
    const balances=await page.evaluate(async()=>{
      cuentasAhorro.push({id:2,nombre:'Otra',movimientos:[nuevoMov({tipo:'abono',cantidad:1500,fecha:today()})]});
      const id=gastos.at(-1).id;
      for(const account of ['2','1']){
        uiStartEdit(id);setDescAhorro(true);document.getElementById('f-ahorro-cuenta').value=account;
        await guardarGasto();if(window._guardarGastoPendiente)_confirmarGuardarGastoConRevertAhorro();
      }
      return cuentasAhorro.map(saldoCuenta);
    });assert.deepEqual(balances,[1990,1500]);
  });
  await run('deleting a funded expense also deletes its remote withdrawal',async()=>{
    await expense();
    const result=await page.evaluate(()=>{
      const g=gastos.at(-1),m=cuentasAhorro[0].movimientos.find(m=>m.gastoId===g.id);
      const rowId=structuredMovimientoRowId(1,m);window._eliminarId=g.id;confirmarEliminar();
      return {rowId,deleted:getStructuredDeleted().movimientosAhorro||[]};
    });assert.ok(result.deleted.some(row=>row.id===result.rowId));
  });
  await run('an upload keeps edits made while its request is in flight',async()=>{
    const result=await page.evaluate(async()=>{
      const oldFetch=sqliteApiFetch,oldSettings=remoteStructuredSettings;
      let release;const response=new Promise(resolve=>release=resolve);
      sqliteApiFetch=async()=>response;remoteStructuredSettings=async()=>null;
      try{
        localStorage.setItem('lastSync','2020-01-01T00:00:00Z');
        markStructuredDirty('catalogos');queueSyncOperation('gastos');
        const upload=uploadStructuredSync({full:true});await Promise.resolve();await Promise.resolve();
        gastos.push({...gastos[0],id:99,cantidad:99,updatedAt:new Date().toISOString()});
        markStructuredDirty('catalogos');saveLocal();
        const pending=getPendingSyncOps().at(-1).id;release({});await upload;
        return {pending,ops:getPendingSyncOps(),dirty:getStructuredDirty()};
      }finally{sqliteApiFetch=oldFetch;remoteStructuredSettings=oldSettings;}
    });
    assert.ok(result.ops.some(op=>op.id===result.pending),'the new operation must remain pending');
    assert.ok(result.dirty.catalogos,'the new catalog revision must stay dirty');
  });
  await run('a delayed download never overwrites a newly saved local expense',async()=>{
    const result=await page.evaluate(async()=>{
      const oldFetch=sqliteApiFetch;let release;const response=new Promise(resolve=>release=resolve);
      sqliteApiFetch=async()=>response;
      try{
        const download=downloadStructuredSync(true);
        gastos.push({...gastos[0],id:100,updatedAt:new Date().toISOString()});saveLocal();
        release({json:async()=>({tables:{gs_gastos:[{id:'1',estado:'activo',updated_at:new Date().toISOString(),data:{...gastos[0]}}]}})});
        await download;return gastos.some(g=>g.id===100);
      }finally{sqliteApiFetch=oldFetch;}
    });assert.equal(result,true);
  });
  await run('switching workspaces retains unsynced operations in the old base',async()=>{
    const result=await page.evaluate(()=>{
      queueSyncOperation('gastos');const id=getPendingSyncOps().at(-1).id;
      setCurrentWorkspaceId('second');setCurrentWorkspaceId('test-space');return {id,ops:getPendingSyncOps()};
    });assert.ok(result.ops.some(op=>op.id===result.id));
    const other=await page.evaluate(()=>{setCurrentWorkspaceId('second');return getPendingSyncOps();});
    assert.deepEqual(other,[],'operations must not leak into the other base');
  });
  await run('temporary network failures do not erase a cached login',async()=>{
    const auth=await page.evaluate(async()=>{
      const oldFetch=window.fetch;setServerAuth({access_token:'fixture',refresh_token:'fixture',expires_at:1,user:{id:'test-user'}});
      window.fetch=async()=>{throw new TypeError('Load failed');};
      try{await refreshServerSession();return getServerAuth();}finally{window.fetch=oldFetch;}
    });assert.ok(auth?.access_token);
  });
  await run('IndexedDB stores can actually save and read application data',async()=>{
    const result=await page.evaluate(async()=>({saved:await DB.saveAppData({fixture:123}),data:await DB.loadAppData()}));
    assert.equal(result.saved,true);assert.deepEqual(result.data,{fixture:123});
  });
  await run('OCR rejects impossible dates and preserves ISO years',async()=>{
    const result=await page.evaluate(()=>({bad:parsePantryExpirationText('CAD 31/02/2027'),iso:parsePantryExpirationText('CAD 2027/12/25')}));
    assert.equal(result.bad.date,'');assert.equal(result.iso.date,'2027-12-25');
  });
  await run('expense descriptions are displayed as text, not executable HTML',async()=>{
    const literal=await page.evaluate(()=>{
      gastos[0].comentarios='<img src=x onerror="window.__unsafeNote=true">';openDetail(gastos[0].id);
      return document.getElementById('modal-detail-body').querySelector('img')===null;
    });assert.equal(literal,true);
  });
  await run('canceling a recurrent or debt form does not count it as paid',async()=>{
    const result=await page.evaluate(()=>{
      recurrentes=[{id:1,nombre:'Servicio',cuenta:'Banamex',motivo:'Otros',cantidad:20,dia:1,activo:true}];
      deudas=[{id:1,nombre:'Compra',cuenta:'Banamex',cuota:20,total:60,mesesTotal:3,mesesPagados:0}];
      registrarRecurrente(0);cancelForm();registrarPagoDeuda(0);cancelForm();
      return {paid:recurrentes[0].ultimoPago||null,installments:deudas[0].mesesPagados};
    });assert.deepEqual(result,{paid:null,installments:0});
  });
  await run('editing the second transfer updates its matching pair only',async()=>{
    const result=await page.evaluate(async()=>{
      cuentasAhorro.push({id:2,nombre:'Otra',movimientos:[]});
      for(const amount of ['10','20']){openTraspaso(1);document.getElementById('traspaso-cantidad').value=amount;document.getElementById('traspaso-destino').value='2';await confirmarTraspaso();}
      editarMovimientoAhorro(1,2);document.getElementById('editar-mov-cantidad').value='30';confirmarEditarMovAhorro();
      return cuentasAhorro[1].movimientos.map(m=>m.cantidad);
    });assert.deepEqual(result,[10,30]);
  });
  await run('canceling savings deletion does not change expense deletion handlers',async()=>{
    const result=await page.evaluate(()=>{
      const original=window.confirmarEliminar;eliminarMovimientoAhorro(1,0);closeModal('modal-confirm-eliminar');return window.confirmarEliminar===original;
    });assert.equal(result,true);
  });
  await run('failed local storage keeps the form draft and prevents duplicate retries',async()=>{
    const result=await page.evaluate(async()=>{
      showTab('nuevo');uiDiscardDraft();document.getElementById('f-cantidad').value='9';uiCaptureDraft();
      const count=gastos.length;const original=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key===appDataStorageKey())throw new DOMException('Storage full','QuotaExceededError');return original.call(this,key,value);};
      try{await uiSubmitExpense();return {sameCount:gastos.length===count,draft:!!localStorage.getItem(uiDraftKey()),form:tabActualGlobal,error:document.getElementById('form-error').textContent};}
      finally{Storage.prototype.setItem=original;}
    });assert.equal(result.sameCount,true);assert.equal(result.draft,true);assert.equal(result.form,'nuevo');assert.match(result.error,/No se pudo guardar/);
  });
  await run('scheduled payments count only on save and edits do not count twice',async()=>{
    const result=await page.evaluate(async()=>{
      deudas=[{id:1,nombre:'Compra',cuenta:'Banamex',cuota:20,total:60,mesesTotal:3,mesesPagados:0}];
      registrarPagoDeuda(0);await guardarGasto();const afterSave=deudas[0].mesesPagados;
      const id=gastos.at(-1).id;uiStartEdit(id);document.getElementById('f-cantidad').value='21';await guardarGasto();
      const afterEdit=deudas[0].mesesPagados;eliminar(id);confirmarEliminar();
      return {afterSave,afterEdit,afterDelete:deudas[0].mesesPagados};
    });assert.deepEqual(result,{afterSave:1,afterEdit:1,afterDelete:0});
  });
  await run('an upload finishing after a base switch cannot acknowledge the new base',async()=>{
    const result=await page.evaluate(async()=>{
      const oldFetch=sqliteApiFetch,oldSettings=remoteStructuredSettings;let release;
      sqliteApiFetch=async()=>new Promise(resolve=>release=resolve);remoteStructuredSettings=async()=>null;
      try{
        queueSyncOperation('gastos');const request=uploadStructuredSync({full:true});await Promise.resolve();await Promise.resolve();
        setCurrentWorkspaceId('second');queueSyncOperation('gastos');const id=getPendingSyncOps().at(-1).id;
        release({});await request;return {id,pending:getPendingSyncOps(),last:localStorage.getItem('lastSync')};
      }finally{sqliteApiFetch=oldFetch;remoteStructuredSettings=oldSettings;}
    });assert.ok(result.pending.some(op=>op.id===result.id));assert.equal(result.last,null);
  });
  await run('an explicit server overwrite clears the replaced pending queue',async()=>{
    const result=await page.evaluate(async()=>{
      const oldFetch=sqliteApiFetch;queueSyncOperation('gastos');markStructuredDirty('catalogos');
      sqliteApiFetch=async()=>({json:async()=>({tables:{gs_gastos:[{id:'1',estado:'activo',updated_at:new Date().toISOString(),data:{...gastos[0]}}]}})});
      try{await downloadStructuredSync(true);return {pending:getPendingSyncOps(),dirty:getStructuredDirty()};}finally{sqliteApiFetch=oldFetch;}
    });assert.deepEqual(result,{pending:[],dirty:{}});
  });
  await run('startup still renders cached expenses when profile requests fail',async()=>{
    const isolated=await context.browser().newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    try{
      const base=new URL(page.url()).origin;
      await isolated.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
      await isolated.addInitScript(()=>{
        localStorage.setItem('serverAuth',JSON.stringify({access_token:'fixture',user:{id:'offline-user',email:'offline@example.test'}}));
        localStorage.setItem('currentWorkspaceId','offline-space');localStorage.setItem('modoViaje','1');
        localStorage.setItem('appData_v1:offline-space',JSON.stringify({gastos:[{id:1,fecha:'2026-10-25',cuenta:'Banamex',motivo:'Otros',cantidad:35,abonado:false,ignorar:false,externo:'no'}],historico:[]}));
      });
      const cached=await isolated.newPage(),errors=[];cached.on('pageerror',error=>errors.push(error.message));
      await cached.goto(base);await cached.waitForFunction(()=>document.getElementById('s-total').textContent.includes('35'));
      assert.deepEqual(errors,[]);assert.equal(await cached.locator('#modal-auth').isVisible(),false);
    }finally{await isolated.close();}
  });
  await reset();
  if(failures.length)throw new Error('Regression failures:\n'+failures.join('\n'));
};
