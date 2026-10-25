// Run with NODE_PATH pointing to Playwright, against the static local test server.
// All remote requests are blocked. Fixtures never touch a user's session or backend.
const { webkit, chromium, devices } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let base = process.env.TEST_URL;
let server;
const output = process.env.TEST_OUTPUT || path.resolve('test-results');
fs.mkdirSync(output,{recursive:true});
const checks=[];
async function check(name,work) { await work(); checks.push(name); console.log('PASS',name); }
async function seed(page) {
  await page.evaluate(()=>{
    closeModal('modal-auth');
    localStorage.setItem('modoViaje','1');
    localStorage.setItem('serverAuth',JSON.stringify({access_token:'fixture-only',user:{id:'test-user'}}));
    localStorage.setItem('currentWorkspaceId','test-space');
    PRESUPUESTO=100;
    catalogoCuentas=[{nombre:'Banamex',color:'#8273ee',tieneCorte:true,diaCorte:28},{nombre:'Debito',color:'#81bba8',tieneCorte:false}];
    catalogoMotivos=['Comida','Mandado','Otros'];
    const create=(id,fields)=>({id,fecha:today(),cuenta:'Banamex',motivo:'Comida',cantidad:65,comentarios:'Café '+id,abonado:false,ignorar:false,externo:'no',...fields});
    gastos=[create(1,{}),create(2,{comentarios:'Supermercado',motivo:'Mandado'})];
    historico=[create(3,{fecha:'2025-01-12',cantidad:75,comentarios:'Compra antigua'})];
    cuentasAhorro=[{id:1,nombre:'Emergencias',meta:5000,movimientos:[{movId:1,tipo:'abono',cantidad:2000,fecha:today(),nota:'Inicio'}]}];
    nextId=4; nextAhorroId=2; nextMovId=2;
    recurrentes=[];deudas=[];ajustesPresupuesto=[];excepciones=[];
    pantryProducts=[{id:'p1',nombre:'Leche',activo:true,category_id:'cat1',default_location_id:'loc1'}];
    pantryCategories=[{id:'cat1',nombre:'Lácteos',activo:true}];
    pantryLocations=[{id:'loc1',nombre:'Refrigerador',activo:true}];
    pantryLots=[{id:'lot1',product_id:'p1',quantity:3,location_id:'loc1',expiration_date:'2026-12-01'}];
    actualizarSelectCuentas();actualizarSelectMotivos();resetForm();
    renderMenu();uiPopulateFilters();showTab('menu');mostrarEstadoSync(false);
  });
}
(async()=>{
  if(!base){
    const root=path.resolve(__dirname,'..');
    server=require('node:http').createServer((request,response)=>{
      const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
      const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(root+path.sep)){response.writeHead(403).end();return;}
      fs.readFile(file,(error,data)=>{
        if(error){response.writeHead(404).end();return;}
        const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
        response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});response.end(data);
      });
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    base=`http://127.0.0.1:${server.address().port}`;
  }
  const browser=await webkit.launch({headless:true});
  try {
    const context=await browser.newContext({...devices['iPhone 13'],locale:'es-MX',timezoneId:'America/Los_Angeles',serviceWorkers:'block'});
    await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
    const page=await context.newPage();const errors=[];
    page.on('pageerror',err=>errors.push(err.message));
    await page.goto(base);await page.waitForSelector('#modal-auth.open');await seed(page);
    if(process.env.REGRESSION_ONLY){
      await require('./regressions.cjs')(page,context,check,seed);
      assert.deepEqual(errors,[],'No browser runtime errors');
      await context.close();console.log(`Verified ${checks.length} regression scenarios.`);return;
    }
    await check('budget shows the real overspend',async()=>{
      assert.match(await page.locator('#budget-available-label').innerText(),/Excediste/);
      assert.match(await page.locator('#s-disp').innerText(),/30/);
      assert.equal(await page.locator('.tabs .tab').count(),5);
      assert.equal(await page.locator('#banner-pendientes').isVisible(),false);
    });
    await page.screenshot({path:path.join(output,'iphone-home.png')});
    await check('movement period, date grouping and clearing filters',async()=>{
      await page.locator('#tab-gastos').click();
      assert.equal(await page.locator('#gastos-list .movement-row').count(),2);
      await page.locator('#movement-period').selectOption('todos');
      assert.equal(await page.locator('#gastos-list .movement-row').count(),3);
      await page.locator('#search-in').fill('antigua');
      assert.equal(await page.locator('#gastos-list .movement-row').count(),1);
      await page.locator('#clear-movement-filters').click();
      assert.equal(await page.locator('#movement-period').inputValue(),'semana');
      assert.equal(await page.locator('#gastos-list .movement-row').count(),2);
    });
    await check('form drafts survive navigation and save returns to origin with filters',async()=>{
      await page.locator('#search-in').fill('super');
      await page.locator('.fab').click();
      await page.locator('#f-cantidad').fill('12.50');
      await page.locator('#f-comentarios-input').fill('Compra nueva');
      await page.locator('#tab-menu').click();
      await page.locator('.fab').click();
      assert.equal(await page.locator('#f-cantidad').inputValue(),'12.50');
      assert.equal(await page.locator('#draft-notice').isVisible(),true);
      await page.locator('#expense-save').tap();
      assert.equal(await page.evaluate(()=>gastos.length),3);
      // This form was reopened from Home, so saving returns there.
      assert.equal(await page.locator('#content-menu').isVisible(),true);
      assert.equal(await page.evaluate(()=>localStorage.getItem(uiDraftKey())),null);
      await page.locator('#tab-gastos').click();
      assert.equal(await page.locator('#search-in').inputValue(),'super');
      assert.equal(await page.locator('#gastos-list .movement-row').count(),1);
      await page.locator('#clear-movement-filters').click();
    });
    await check('editing a historical expense changes only its original record',async()=>{
      await page.locator('#movement-period').selectOption('todos');
      await page.locator('#gastos-list [data-movement="3"]').click();
      await page.locator('#modal-detail-body button').filter({hasText:'Editar'}).click();
      await page.waitForFunction(()=>document.getElementById('f-cantidad').value==='75');
      await page.locator('#f-cantidad').fill('80');
      await page.locator('#expense-save').tap();
      await page.waitForFunction(()=>historico[0].cantidad===80);
      assert.equal(await page.evaluate(()=>historico[0].cantidad),80);
      assert.equal(await page.evaluate(()=>gastos.some(g=>g.id===3)),false);
      assert.equal(await page.locator('#content-gastos').isVisible(),true);
    });
    await check('credit operation excludes payment from budget and reduces card debt',async()=>{
      await page.locator('#tab-cortes').click();
      await page.locator('[data-credit-account="Banamex"]').click();
      assert.equal(await page.locator('#content-nuevo').isVisible(),true);
      assert.equal(await page.locator('.overlay.open').count(),0);
      await page.locator('#f-cantidad').fill('20');
      await page.locator('#expense-save').tap();
      const payment=await page.evaluate(()=>gastos.at(-1));
      assert.equal(payment.abonoTarjeta,true);assert.equal(payment.ignorar,true);assert.equal(payment.abonado,true);
      assert.equal(await page.locator('#content-cortes').isVisible(),true);
    });
    await check('reconciliation opens on the requested account and retains navigation',async()=>{
      await page.locator('[data-concile-account="Banamex"]').click();
      assert.equal(await page.locator('#content-conciliacion').isVisible(),true);
      assert.equal(await page.locator('#concil-cuenta').inputValue(),'Banamex');
      assert.equal(await page.locator('#reconciliation-steps li').count(),3);
      assert.equal(await page.locator('.tabs').isVisible(),true);
    });
    await check('pantry search retains typing focus through redraws',async()=>{
      await page.evaluate(()=>showTab('despensa'));
      await page.getByRole('button',{name:'Inventario',exact:true}).click();
      await page.locator('#pantry-search').pressSequentially('Leche');
      assert.equal(await page.locator('#pantry-search').inputValue(),'Leche');
      assert.equal(await page.locator('#pantry-search').evaluate(el=>el===document.activeElement),true);
      assert.equal(await page.locator('.pantry-card').count(),1);
      assert.equal(await page.locator('.tabs').isVisible(),true);
    });
    await check('all views fit small and large iPhone widths in all themes',async()=>{
      for(const width of [320,375,390,430]){
        await page.setViewportSize({width,height:844});
        for(const theme of ['oscuro','claro','revolut']){
          await page.evaluate(mode=>aplicarTema(mode),theme);
          for(const tab of ['menu','gastos','nuevo','cortes','ahorros','dashboard','mas','despensa','recurrentes','catalogos','externos','historico','conciliacion']){
            await page.evaluate(view=>showTab(view),tab);
            await page.waitForTimeout(25);
            const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
            assert.ok(overflow<=1,`${tab} overflows ${overflow}px at ${width}px (${theme})`);
          }
        }
      }
    });
    await check('user and workspace drafts are isolated',async()=>{
      await page.evaluate(()=>{showTab('nuevo');uiDiscardDraft();});
      await page.locator('#f-cantidad').fill('9');
      await page.evaluate(()=>{showTab('menu');setCurrentWorkspaceId('another-test-space');showTab('nuevo');});
      assert.equal(await page.locator('#f-cantidad').inputValue(),'');
      await page.evaluate(()=>{showTab('menu');setCurrentWorkspaceId('test-space');showTab('nuevo');});
      assert.equal(await page.locator('#f-cantidad').inputValue(),'9');

    });
    await check('a new browser load restores the scoped draft',async()=>{
      await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
        // Test startup uses fixtures; all remote requests remain blocked.
        window.refreshServerSession=async()=>true;window.ensureUserProfile=async()=>true;
        window.cargarWorkspaces=async()=>[];window.iniciarAutoSync=()=>{};
      }));
      await page.reload();await page.waitForSelector('#main-app[style*="block"]');
      await page.locator('.fab').click();
      assert.equal(await page.locator('#f-cantidad').inputValue(),'9');
      assert.equal(await page.locator('#draft-notice').isVisible(),true);
    });
    await check('manual category and account choices survive rules and saving',async()=>{
      await page.evaluate(()=>{uiDiscardDraft();reglasAutomaticas=[{texto:'Tienda',cuenta:'Banamex',motivo:'Comida'}];});
      await page.locator('#f-cantidad').fill('10');
      await page.locator('#f-comentarios-input').fill('Tienda');
      await page.locator('#f-motivo').selectOption('Otros');
      await page.locator('#f-cuenta').selectOption('Debito');
      await page.locator('#expense-save').tap();
      const saved=await page.evaluate(()=>gastos.at(-1));
      assert.equal(saved.motivo,'Otros');assert.equal(saved.cuenta,'Debito');
    });
    await check('savings-funded expenses preserve one withdrawal across edits',async()=>{
      await page.evaluate(()=>{showTab('gastos');showTab('nuevo');uiDiscardDraft();});
      await page.locator('#f-cantidad').fill('10');
      await page.locator('#expense-options summary').click();
      await page.locator('#desc-si').click();
      await page.locator('#f-ahorro-cuenta').selectOption('1');
      await page.locator('#expense-save').tap();
      assert.equal(await page.evaluate(()=>saldoCuenta(cuentasAhorro[0])),1990);
      await page.evaluate(()=>uiStartEdit(gastos.at(-1).id));
      assert.equal(await page.locator('#f-ahorro-cuenta').inputValue(),'1');
      await page.locator('#f-cantidad').fill('15');
      await page.locator('#expense-save').tap();
      assert.equal(await page.evaluate(()=>saldoCuenta(cuentasAhorro[0])),1985);
      assert.equal(await page.evaluate(()=>cuentasAhorro[0].movimientos.filter(m=>m.tipo==='retiro').length),1);
    });
    await check('offline saving persists locally without blocking the form',async()=>{
      await page.evaluate(()=>{showTab('menu');showTab('nuevo');uiDiscardDraft();});
      await context.setOffline(true);
      await page.locator('#f-cantidad').fill('7');
      await page.locator('#f-comentarios-input').fill('Compra sin conexión');
      await page.locator('#expense-save').tap();
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(appDataStorageKey())).gastos.at(-1).cantidad),7);
      assert.match(await page.locator('#sync-status').innerText(),/Sin conexión/);
      await context.setOffline(false);
    });
    await check('reminders share the mobile palette and fit the phone',async()=>{
      await page.goto(base+'/tasks.html');
      await page.waitForSelector('#content-hoy.active');
      assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.tabs')).position),'fixed');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.goto(base);await page.waitForSelector('#main-app[style*="block"]');
    });
    await require('./regressions.cjs')(page,context,check,seed);
    // Capture final examples using only generated fixtures.
    await page.evaluate(()=>{closeModal('modal-auth');aplicarTema('oscuro');showTab('nuevo');});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(output,'iphone-expense.png')});
    await page.evaluate(()=>showTab('mas'));
    await page.screenshot({path:path.join(output,'iphone-more.png')});
    assert.deepEqual(errors,[],'No browser runtime errors');
    console.log(`Verified ${checks.length} scenarios in WebKit. Screenshots: ${output}`);
    await context.close();
    await check('PWA loads the new interface from cache while offline',async()=>{
      // Windows WebKit cannot reliably emulate offline SW navigations. UI and
      // local persistence run in WebKit above; use Chromium for this cache smoke test.
      const cacheBrowser=await chromium.launch({headless:true,...(process.env.PWA_BROWSER_CHANNEL?{channel:process.env.PWA_BROWSER_CHANNEL}:{})});
      try {
      const pwa=await cacheBrowser.newContext({...devices['iPhone 13'],serviceWorkers:'allow'});
      await pwa.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
      const offlinePage=await pwa.newPage();
      await offlinePage.goto(base);
      await offlinePage.evaluate(async()=>{await navigator.serviceWorker.ready;});
      await offlinePage.waitForFunction(()=>!!navigator.serviceWorker.controller);
      await offlinePage.waitForLoadState('networkidle');
      await offlinePage.waitForSelector('#modal-auth.open');
      const assets=await offlinePage.evaluate(async()=>{const cache=await caches.open('gastos-v2.76');return (await cache.keys()).map(r=>new URL(r.url).pathname);});
      for(const asset of ['/mobile.css','/mobile-ui.js','/theme.js'])assert.ok(assets.includes(asset),asset+' must be cached');
      await pwa.setOffline(true);
      await offlinePage.goto(base+'/index.html',{waitUntil:'domcontentloaded'});
      await offlinePage.waitForSelector('#modal-auth.open');
      assert.equal(await offlinePage.evaluate(()=>typeof uiRenderMovements),'function');
      assert.equal(await offlinePage.evaluate(()=>getComputedStyle(document.querySelector('.tabs')).position),'fixed');
      await pwa.close();
      } finally {await cacheBrowser.close();}
    });
    console.log(`All ${checks.length} mobile and offline scenarios passed.`);
  } finally { await browser.close();if(server)await new Promise(resolve=>server.close(resolve)); }
})().catch(err=>{console.error(err.stack);process.exitCode=1;});
