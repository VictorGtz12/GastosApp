/* Scoped, atomic local storage and revision-aware reminder synchronization. */
let taskLoadedScope=null,taskSyncState=null,taskPersistedState=null;
let taskSyncBusy=false,taskSyncQueued=false,taskSyncTimer;
const taskClone=value=>JSON.parse(JSON.stringify(value));
const taskRevision=()=>globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
function taskScope(){return {userId:taskUserId(),workspaceId:taskWorkspaceId(),token:getServerAuth()?.access_token,base:sqliteApiBase()};}
function taskScopeActive(scope){return scope.userId===taskUserId() && scope.workspaceId===taskWorkspaceId() && scope.userId===taskLoadedScope?.userId && scope.workspaceId===taskLoadedScope?.workspaceId;}
function taskKey(name,scope=taskLoadedScope||taskScope()){return `${name}:${scope.userId}:${scope.workspaceId}`;}
function taskNotice(message,error=false){
  document.querySelectorAll('.task-form-error').forEach(el=>el.remove());
  const el=document.getElementById('task-notice');if(el){el.textContent=message;el.hidden=!message;el.setAttribute('role',error?'alert':'status');}
  const modal=document.querySelector('.overlay.open .modal');
  if(error&&message&&modal){const note=document.createElement('p');note.className='task-form-error';note.setAttribute('role','alert');note.textContent=message;modal.prepend(note);note.scrollIntoView({block:'nearest'});}
}
function loadLocal(){
  taskLoadedScope=taskScope();
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}};
  const legacy=name=>`${name}:${taskLoadedScope.workspaceId}`;
  const stored=read(taskKey('mr_state'),null);
  taskSyncState=stored || {tasks:read(legacy('mr_tasks'),[]),projects:read(legacy('mr_projs'),[]),deleted:read(legacy('mr_deleted'),{}),lastSync:localStorage.getItem(legacy('mr_lastSync'))||null,pending:{tasks:{},projects:{}}};
  for(const key of ['tasks','projects']){
    if(!Array.isArray(taskSyncState[key]))taskSyncState[key]=[];
    taskSyncState.pending||={};taskSyncState.pending[key]||={};taskSyncState.deleted||={};taskSyncState.deleted[key]||=[];
    if(!stored)for(const row of taskSyncState[key])if(!taskSyncState.lastSync || new Date(row.updatedAt||0)>=new Date(taskSyncState.lastSync))taskSyncState.pending[key][row.id]=taskRevision();
  }
  tasks=taskSyncState.tasks;proyectos=taskSyncState.projects;
  taskPersistedState=taskClone(taskSyncState);
}
function ensureTaskScope(){
  if(taskLoadedScope && taskScopeActive(taskLoadedScope))return true;
  loadLocal();editingId=null;
  document.querySelectorAll('.overlay.open').forEach(el=>cerrarModal(el.id));
  renderAll();taskNotice('La base cambió. Revisa la lista antes de continuar.');return false;
}
function taskHasPending(){return ['tasks','projects'].some(key=>Object.keys(taskSyncState?.pending?.[key]||{}).length || taskSyncState?.deleted?.[key]?.length);}
function persistTaskState(){
  taskSyncState.tasks=tasks;taskSyncState.projects=proyectos;
  try{
    localStorage.setItem(taskKey('mr_state'),JSON.stringify(taskSyncState));
    taskPersistedState=taskClone(taskSyncState);return true;
  }catch(error){
    taskSyncState=taskClone(taskPersistedState);tasks=taskSyncState.tasks;proyectos=taskSyncState.projects;
    taskNotice('No se pudo guardar en este iPhone. Conservamos tus datos; vuelve a intentarlo.',true);return false;
  }
}
function saveLocal(){
  if(!ensureTaskScope())return false;
  if(!taskSyncBlocked){
    const revision=taskRevision(),now=new Date().toISOString();
    for(const [key,rows] of [['tasks',tasks],['projects',proyectos]]){
      const before=new Map(taskPersistedState[key].map(row=>[String(row.id),row]));
      for(const row of rows){if(JSON.stringify(row)!==JSON.stringify(before.get(String(row.id)))){row.updatedAt=now;taskSyncState.pending[key][row.id]=revision;}before.delete(String(row.id));}
      for(const id of before.keys()){markTaskDeleted(key,id);delete taskSyncState.pending[key][id];}
    }
  }
  if(!persistTaskState())return false;
  taskNotice('');if(!taskSyncBlocked){checkNotificaciones();scheduleSync();}return true;
}
function getTaskDeleted(){return taskClone(taskSyncState?.deleted||{});}
function setTaskDeleted(value){taskSyncState.deleted=value;}
function markTaskDeleted(kind,id){
  if(!id)return;
  const deleted=getTaskDeleted();deleted[kind]||=[];
  deleted[kind]=[...deleted[kind].filter(row=>String(row.id)!==String(id)),{id:String(id),deleted_at:new Date().toISOString(),updated_by_device:taskDeviceId()}];
  setTaskDeleted(deleted);
}
function scheduleSync(){
  actualizarSyncStatus('pending');clearTimeout(taskSyncTimer);
  if(navigator.onLine && localStorage.getItem('modoViaje')!=='1')taskSyncTimer=setTimeout(syncUp,250);
}
async function taskFetch(path,opts={},scope=taskScope()){
  const send=token=>fetch(`${scope.base}/rest/${path}`,{...opts,headers:{...opts.headers,Authorization:'Bearer '+(token||'')}});
  let response=await send(scope.token);
  if(response.status===401 && taskScopeActive(scope)){
    await refreshTaskSession(true);
    if(taskScopeActive(scope) && getServerAuth()?.access_token!==scope.token)response=await send(getServerAuth()?.access_token);
  }
  if(!response.ok)throw new Error(`No se pudo sincronizar (HTTP ${response.status})`);
  return response;
}
async function taskUpsert(table,rows,scope=taskScope()){
  if(rows.length)await taskFetch(`${table}?on_conflict=workspace_id,id`,{method:'POST',headers:{'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows)},scope);
}
async function taskSoftDelete(table,rows,scope=taskScope()){
  for(const row of rows)await taskFetch(`${table}?workspace_id=eq.${encodeURIComponent(scope.workspaceId)}&id=eq.${encodeURIComponent(row.id)}`,{method:'PATCH',headers:{'Content-Type':'application/json','Prefer':'return=minimal'},body:JSON.stringify({deleted_at:row.deleted_at,updated_at:row.deleted_at,updated_by_device:row.updated_by_device||taskDeviceId()})},scope);
}
async function fetchTaskRows(table,scope){
  const rows=[];
  for(let offset=0;;offset+=500){
    const response=await taskFetch(`${table}?select=id,data,updated_at,deleted_at&workspace_id=eq.${encodeURIComponent(scope.workspaceId)}&order=id.asc&limit=500&offset=${offset}`,{},scope);
    const page=await response.json();if(!Array.isArray(page))throw new Error('Respuesta de tareas inválida');
    if(offset && page.length && page.every(row=>rows.some(old=>String(old.id)===String(row.id))))throw new Error('El servidor repitió una página de tareas');
    rows.push(...page);if(page.length<500)return rows;
  }
}
async function syncDown(force=false,internal=false){
  if(!ensureTaskScope() || !taskUsingAuth() || !navigator.onLine || localStorage.getItem('modoViaje')==='1' || (taskSyncBusy&&!internal))return false;
  const scope=taskScope();actualizarSyncStatus('syncing');
  try{
    const [remoteTasks,remoteProjects]=await Promise.all([fetchTaskRows('gs_tasks',scope),fetchTaskRows('gs_task_projects',scope)]);
    if(!taskScopeActive(scope))return false;
    for(const [key,remote,local] of [['tasks',remoteTasks,tasks],['projects',remoteProjects,proyectos]]){
      const pending=taskSyncState.pending[key],deleted=new Set((taskSyncState.deleted[key]||[]).map(row=>String(row.id)));
      const merged=new Map(remote.filter(row=>!row.deleted_at&&row.data&&!deleted.has(String(row.id))).map(row=>[String(row.id),row.data]));
      for(const row of local)if(pending[row.id]&&!deleted.has(String(row.id)))merged.set(String(row.id),row);
      if(key==='tasks')tasks=[...merged.values()];else proyectos=[...merged.values()];
    }
    taskSyncState.lastSync=new Date().toISOString();
    if(!persistTaskState())return false;
    renderAll();actualizarSyncStatus(taskHasPending()?'pending':'ok');return true;
  }catch(error){actualizarSyncStatus('error');taskNotice('No se pudo sincronizar. Conservamos los datos de este iPhone; toca Sincronizar para reintentar.',true);return false;}
}
async function syncUp(){
  if(!ensureTaskScope() || !taskUsingAuth() || !navigator.onLine || localStorage.getItem('modoViaje')==='1')return false;
  if(taskSyncBusy){taskSyncQueued=true;return false;}
  taskSyncBusy=true;const scope=taskScope();actualizarSyncStatus('syncing');
  try{
    if(!taskSyncState.lastSync && !(await syncDown(true,true)))return false;
    if(!taskScopeActive(scope))return false;
    const snapshot=taskClone({...taskSyncState,tasks,projects:proyectos}),startedAt=new Date().toISOString();
    for(const [key,table] of [['tasks','gs_tasks'],['projects','gs_task_projects']]){
      const rows=snapshot[key].filter(row=>snapshot.pending[key][row.id]).map(row=>({workspace_id:scope.workspaceId,id:String(row.id),data:row,updated_at:row.updatedAt,updated_by_device:taskDeviceId(),deleted_at:null}));
      await taskUpsert(table,rows,scope);if(!taskScopeActive(scope))return false;
      await taskSoftDelete(table,snapshot.deleted[key]||[],scope);if(!taskScopeActive(scope))return false;
    }
    for(const key of ['tasks','projects']){
      for(const [id,revision] of Object.entries(snapshot.pending[key]))if(taskSyncState.pending[key][id]===revision)delete taskSyncState.pending[key][id];
      taskSyncState.deleted[key]=taskSyncState.deleted[key].filter(row=>!snapshot.deleted[key].some(old=>old.id===row.id&&old.deleted_at===row.deleted_at));
    }
    taskSyncState.lastSync=startedAt;
    if(!persistTaskState())return false;
    actualizarSyncStatus(taskHasPending()?'pending':'ok');return true;
  }catch(error){actualizarSyncStatus('error');taskNotice('No se pudo sincronizar. Conservamos los datos de este iPhone; toca Sincronizar para reintentar.',true);return false;}
  finally{taskSyncBusy=false;if(taskSyncQueued){taskSyncQueued=false;scheduleSync();}}
}
async function sincronizarTareas(){if(await syncUp())await syncDown();}
window.addEventListener('storage',event=>{
  if(['currentWorkspaceId','serverAuth'].includes(event.key)){
    if(!taskUsingAuth()){location.replace('index.html');return;}
    if(!taskScopeActive(taskLoadedScope||{})){ensureTaskScope();syncDown();}
  }
});
