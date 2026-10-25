const assert=require('node:assert/strict');
module.exports=async function reminders(context,check,base){
  const page=await context.newPage(),errors=[],failures=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/tasks.html');await page.waitForSelector('#content-hoy.active');
  async function reset(){await page.evaluate(()=>{
    clearTimeout(taskSyncTimer);localStorage.setItem('modoViaje','1');
    document.querySelectorAll('.overlay.open').forEach(el=>cerrarModal(el.id));
    const empty={tasks:[],projects:[],pending:{tasks:{},projects:{}},deleted:{tasks:[],projects:[]},lastSync:null};
    localStorage.setItem(taskKey('mr_state'),JSON.stringify(empty));loadLocal();editingId=null;editingProjId=null;renderAll();
  });}
  async function run(name,work){await reset();try{await check(name,work);}catch(error){failures.push(name+': '+error.message);console.log('REPRODUCED',name,error.message.slice(0,180));}}
  await run('reminders save edit filter complete and delete a task',async()=>{
    await page.evaluate(()=>{abrirNuevo();document.getElementById('f-titulo').value='Revisar pago';guardarTask();});
    assert.equal(await page.evaluate(()=>tasks.length),1);
    await page.evaluate(()=>{editarTask(tasks[0].id);document.getElementById('f-titulo').value='Pago revisado';guardarTask();toggleTask(tasks[0].id);showTab('todas');document.getElementById('fil-estado').value='completada';renderTodas();});
    assert.match(await page.locator('#todas-list').innerText(),/Pago revisado/);
    await page.evaluate(()=>{editarTask(tasks[0].id);eliminarTask();});assert.equal(await page.evaluate(()=>tasks.length),0);
  });
  await run('reminder titles notes and project names render as plain text',async()=>{
    await page.evaluate(()=>{
      const payload='<img src=x onerror="window.reminderInjected=true">';
      tasks=[{id:'plain',tipo:'nota',titulo:payload,descripcion:payload,createdAt:new Date().toISOString()}];
      proyectos=[{id:'p',nombre:payload,icono:'📁',color:'#123456'}];renderAll();
    });
    assert.equal(await page.locator('#notas-list img,#proyectos-list img').count(),0);
    assert.equal(await page.evaluate(()=>!!window.reminderInjected),false);
  });
  await run('failed reminder save keeps its form and does not duplicate a retry',async()=>{
    const result=await page.evaluate(()=>{
      abrirNuevo();document.getElementById('f-titulo').value='No perder';const original=Storage.prototype.setItem;
      Storage.prototype.setItem=function(key,value){if(key===taskKey('mr_state'))throw new DOMException('fixture quota','QuotaExceededError');return original.call(this,key,value);};
      try{guardarTask();}finally{Storage.prototype.setItem=original;}
      const failed={count:tasks.length,open:document.getElementById('modal-nuevo').classList.contains('open'),notice:!!document.querySelector('.task-form-error')};
      guardarTask();return {failed,count:tasks.length};
    });assert.deepEqual(result,{failed:{count:0,open:true,notice:true},count:1});
  });
  await run('first reminder sync merges remote data and uploads unsynced local captures',async()=>{
    const result=await page.evaluate(async()=>{
      tasks=[{id:'local',tipo:'tarea',titulo:'Local'}];saveLocal();const original=taskFetch,posted=[];
      taskFetch=async(path,opts)=>{if(opts?.method==='POST'){posted.push(...JSON.parse(opts.body));return {};}return {json:async()=>path.startsWith('gs_tasks?')?[{id:'remote',data:{id:'remote',tipo:'tarea',titulo:'Servidor'}}]:[]};};
      localStorage.removeItem('modoViaje');
      try{await syncUp();return {ids:tasks.map(t=>t.id).sort(),posted:posted.map(t=>t.id),pending:taskHasPending()};}finally{taskFetch=original;localStorage.setItem('modoViaje','1');clearTimeout(taskSyncTimer);}
    });assert.deepEqual(result,{ids:['local','remote'],posted:['local'],pending:false});
  });
  await run('reminder edits during upload stay pending with their exact new content',async()=>{
    const result=await page.evaluate(async()=>{
      taskSyncState.lastSync='2025-01-01';tasks=[{id:'one',tipo:'tarea',titulo:'A'}];saveLocal();
      const original=taskFetch;let release,sent;
      taskFetch=async(path,opts)=>{if(opts?.method==='POST'){sent=JSON.parse(opts.body);return new Promise(resolve=>release=()=>resolve({}));}return {};};
      localStorage.removeItem('modoViaje');
      try{
        const upload=syncUp();for(let i=0;i<20&&!release;i++)await Promise.resolve();if(!release)throw new Error('Upload did not start');
        localStorage.setItem('modoViaje','1');tasks[0].titulo='B';saveLocal();release();await upload;
        return {sent:sent[0].data.titulo,current:tasks[0].titulo,pending:taskHasPending()};
      }finally{taskFetch=original;clearTimeout(taskSyncTimer);}
    });assert.deepEqual(result,{sent:'A',current:'B',pending:true});
  });
  await run('a delayed reminder download preserves edits and deletions made while waiting',async()=>{
    const result=await page.evaluate(async()=>{
      tasks=[{id:'one',tipo:'tarea',titulo:'Inicial'},{id:'delete',tipo:'tarea',titulo:'Borrar'}];saveLocal();taskSyncState.pending={tasks:{},projects:{}};persistTaskState();
      const original=taskFetch;let release;
      taskFetch=async path=>path.startsWith('gs_tasks?')?new Promise(resolve=>release=()=>resolve({json:async()=>[{id:'one',data:{id:'one',tipo:'tarea',titulo:'Viejo'}},{id:'delete',data:{id:'delete',tipo:'tarea',titulo:'Borrar'}}]})):{json:async()=>[]};
      localStorage.removeItem('modoViaje');
      try{
        const download=syncDown();for(let i=0;i<20&&!release;i++)await Promise.resolve();
        localStorage.setItem('modoViaje','1');tasks[0].titulo='Nuevo';tasks.pop();saveLocal();release();await download;
        return {titles:tasks.map(t=>t.titulo),pending:taskHasPending()};
      }finally{taskFetch=original;clearTimeout(taskSyncTimer);}
    });assert.deepEqual(result,{titles:['Nuevo'],pending:true});
  });
  await run('an old reminder upload cannot acknowledge or overwrite another workspace',async()=>{
    const result=await page.evaluate(async()=>{
      const first=taskWorkspaceId(),original=taskFetch;taskSyncState.lastSync='2025-01-01';tasks=[{id:'old',tipo:'tarea',titulo:'Base A'}];saveLocal();const oldKey=taskKey('mr_state');
      let release,posted;
      taskFetch=async(path,opts)=>{if(opts?.method==='POST'){posted=JSON.parse(opts.body);return new Promise(resolve=>release=()=>resolve({}));}return {};};
      localStorage.removeItem('modoViaje');
      try{
        const upload=syncUp();for(let i=0;i<20&&!release;i++)await Promise.resolve();
        localStorage.setItem('modoViaje','1');localStorage.setItem('currentWorkspaceId','reminder-other');ensureTaskScope();tasks=[{id:'new',tipo:'tarea',titulo:'Base B'}];saveLocal();
        release();await upload;
        return {workspace:posted[0].workspace_id===first,title:tasks[0].titulo,pending:taskHasPending(),oldPending:!!JSON.parse(localStorage.getItem(oldKey)).pending.tasks.old};
      }finally{taskFetch=original;localStorage.setItem('currentWorkspaceId',first);loadLocal();clearTimeout(taskSyncTimer);}
    });assert.deepEqual(result,{workspace:true,title:'Base B',pending:true,oldPending:true});
  });
  await run('reminder pagination requests distinct pages and never truncates 501 rows',async()=>{
    const result=await page.evaluate(async()=>{
      const original=taskFetch,offsets=[];
      taskFetch=async path=>{const offset=Number(new URL('http://fixture/'+path).searchParams.get('offset'));offsets.push(offset);return {json:async()=>Array.from({length:offset?1:500},(_,i)=>({id:String(i+offset),data:{id:String(i+offset)}}))};};
      try{const rows=await fetchTaskRows('gs_tasks',taskScope());return {length:rows.length,offsets};}finally{taskFetch=original;}
    });assert.deepEqual(result,{length:501,offsets:[0,500]});
  });
  await run('daily reminders created last year still generate today without inheriting completion',async()=>{
    const result=await page.evaluate(()=>{
      const date=new Date();date.setFullYear(date.getFullYear()-1);
      const all=expandirRepeticion({id:'daily',tipo:'recordatorio',titulo:'Diario',fecha:taskDateKey(date),repeticion:'diaria',completada:true});
      const current=all.find(t=>t.fecha===today());return {exists:!!current,done:current?.completada};
    });assert.deepEqual(result,{exists:true,done:false});
  });
  await run('monthly reminders clamp February dates rather than skipping that month',async()=>{
    const result=await page.evaluate(()=>{
      const OriginalDate=Date,at=new OriginalDate('2026-02-01T12:00:00').getTime();window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};
      try{return expandirRepeticion({id:'month',fecha:'2026-01-31',repeticion:'mensual'}).map(t=>t.fecha);}finally{window.Date=OriginalDate;}
    });assert.ok(result.includes('2026-02-28'));assert.ok(result.includes('2026-03-31'));
  });
  await run('completed reminder occurrences remain visible to completed filters',async()=>{
    const result=await page.evaluate(()=>{
      const yesterday=addDays(today(),-1);tasks=[{id:'repeat',tipo:'recordatorio',titulo:'Rutina',prioridad:'media',repeticion:'diaria',fecha:yesterday,completada:false,completadasFechas:[today()]}];saveLocal();
      document.getElementById('fil-estado').value='completada';renderTodas();return document.getElementById('todas-list').textContent;
    });assert.match(result,/Rutina/);
  });
  await run('the selected reminder calendar day refreshes immediately after completion',async()=>{
    await page.evaluate(()=>{tasks=[{id:'calendar',tipo:'tarea',titulo:'Calendario',fecha:today(),completada:false}];saveLocal();showTab('calendario');selDia(today());toggleTask('calendar');});
    assert.equal(await page.locator('#cal-selected-tasks .task-item.done').count(),1);
  });
  await run('editing or completing a reminder cancels its old notification timer',async()=>{
    const result=await page.evaluate(()=>{
      const descriptor=Object.getOwnPropertyDescriptor(window,'Notification');class FixtureNotification{}FixtureNotification.permission='granted';
      Object.defineProperty(window,'Notification',{configurable:true,value:FixtureNotification});
      try{
        tasks=[{id:'notice',tipo:'recordatorio',titulo:'Aviso',fecha:addDays(today(),1),hora:'00:01',completada:false}];
        programarNotificacion(tasks[0]);const first=taskNotificationTimers.size;
        tasks[0].hora='00:02';programarNotificacion(tasks[0]);const edited=taskNotificationTimers.size;
        tasks[0].completada=true;checkNotificaciones();return {first,edited,completed:taskNotificationTimers.size};
      }finally{for(const timer of taskNotificationTimers.values())clearTimeout(timer);taskNotificationTimers.clear();if(descriptor)Object.defineProperty(window,'Notification',descriptor);else delete window.Notification;}
    });assert.deepEqual(result,{first:1,edited:1,completed:0});
  });
  await run('reminder views and captures fit iPhone widths in every theme',async()=>{
    for(const width of [320,390,430]){
      await page.setViewportSize({width,height:844});
      for(const theme of ['oscuro','claro','revolut']){
        await page.evaluate(mode=>{uiApplyTheme(mode);},theme);
        for(const tab of ['hoy','calendario','todas','proyectos','notas','stats']){
          await page.evaluate(value=>showTab(value),tab);
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),tab+' at '+width);
        }
        await page.evaluate(()=>abrirNuevo());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.evaluate(()=>cerrarModal('modal-nuevo'));
      }
    }
    await page.setViewportSize({width:390,height:844});
  });
  await run('reminders render cached tasks before a slow session refresh completes',async()=>{
    const isolated=await context.browser().newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
    try{
      await isolated.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
      await isolated.addInitScript(()=>{
        const d=new Date(),date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        localStorage.setItem('serverAuth',JSON.stringify({access_token:'cached-token',refresh_token:'cached-refresh',expires_at:1,user:{id:'cached-user'}}));
        localStorage.setItem('currentWorkspaceId','cached-base');localStorage.setItem('modoViaje','1');
        localStorage.setItem('mr_state:cached-user:cached-base',JSON.stringify({tasks:[{id:'cached',titulo:'Disponible durante la espera',tipo:'tarea',fecha:date}],projects:[],pending:{tasks:{cached:'revision'},projects:{}},deleted:{tasks:[],projects:[]},lastSync:null}));
        const original=window.fetch;
        window.fetch=(url,options)=>String(url).includes('/auth/refresh')?new Promise(resolve=>window.releaseRefresh=()=>resolve({ok:true,json:async()=>({access_token:'new-token',refresh_token:'new-refresh',expires_at:9999999999,user:{id:'cached-user'}})})):original(url,options);
      });
      const cached=await isolated.newPage();await cached.goto(base+'/tasks.html');
      await cached.waitForFunction(()=>document.getElementById('hoy-hoy').textContent.includes('Disponible durante la espera'));
      assert.equal(await cached.evaluate(()=>getServerAuth().access_token),'cached-token');
      await cached.evaluate(()=>window.releaseRefresh());
      await cached.waitForFunction(()=>getServerAuth().access_token==='new-token');
    }finally{await isolated.close();}
  });
  assert.deepEqual(errors,[],'No reminder runtime errors');
  await page.close();if(failures.length)throw new Error('Reminder failures:\n'+failures.join('\n'));
};
