import { useCallback, useEffect, useState, type FormEvent } from 'react';

type Connection = {
  connected: boolean; core_origin: string; token_configured: boolean;
  engines_ready: number; message: string;
};
type Entitlements = {allowed_users: string; allowed_groups: string};
type ConnectionUser = {
  user_id: string; via_groups: string[]; explicit: boolean;
  connection: 'connected' | 'not_connected' | 'unknown';
};
type GroupConnection = {
  name: string; members_checked: number;
  connected: number; not_connected: number; unknown: number; partial: boolean;
};
type FilesConnections = {
  users: ConnectionUser[]; groups: GroupConnection[];
  partial: boolean; scan_limit: number;
};
const ROOT = window.location.pathname.replace(/\/+$/, '');
const TOKEN = (window as unknown as {OC?: {requestToken?: string}}).OC?.requestToken;
async function request<T>(path:string,init:RequestInit={}):Promise<T> {
  const response = await fetch(ROOT + '/admin/api' + path,{
    credentials:'same-origin', ...init,
    headers:{'Content-Type':'application/json','OCS-APIRequest':'true',
      ...(TOKEN ? {requesttoken:TOKEN}:{}),...init.headers},
  });
  const body:unknown = await response.json().catch(()=>null);
  if(!response.ok){
    const detail = body && typeof body === 'object' && 'detail' in body
      ? String((body as {detail:unknown}).detail) : 'Administrator request failed';
    throw new Error(detail);
  }
  return body as T;
}
function members(raw:string):string[]{return [...new Set(raw.split(/[,\n\r]+/).map(v=>v.trim()).filter(Boolean))];}
function MemberEditor({title,items,onChange}:{title:string;items:string[];onChange:(next:string[])=>void}){
  const [draft,setDraft]=useState('');
  function add(event:FormEvent){
    event.preventDefault();
    const value=draft.trim();
    if(!value || value.length>255 || /[,\r\n]/.test(value))return;
    onChange([...new Set([...items,value])]);setDraft('');
  }
  return <section className="admin-members">
    <h3>{title}</h3><div className="admin-chips">
      {items.length ? items.map(item=><span className="admin-chip" key={item}>
        {item}<button type="button" aria-label={'Remove '+item} onClick={()=>onChange(items.filter(name=>name!==item))}>×</button>
      </span>) : <p className="muted">Nobody added yet.</p>}
    </div>
    <form onSubmit={add} className="admin-add">
      <label>{title === 'People' ? 'Nextcloud user ID' : 'Nextcloud group ID'}
        <input value={draft} maxLength={255} onChange={e=>setDraft(e.target.value)} placeholder={title==='People'?'username':'group-id'} />
      </label><button type="submit">Add</button>
    </form>
  </section>;
}
export default function AdminApp(){
  const [connection,setConnection]=useState<Connection|null>(null);
  const [users,setUsers]=useState<string[]>([]);
  const [groups,setGroups]=useState<string[]>([]);
  const [tab,setTab]=useState<'connection'|'access'>('connection');
  const [message,setMessage]=useState('');
  const [loading,setLoading]=useState(true);
  const [checking,setChecking]=useState(false);
  const [saving,setSaving]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [filesConnections,setFilesConnections]=useState<FilesConnections|null>(null);
  const [connectionsBusy,setConnectionsBusy]=useState(false);
  const [connectionError,setConnectionError]=useState('');
  const check=useCallback(async()=>{
    setChecking(true);
    try{setConnection(await request<Connection>('/connection'));}
    catch{setConnection(null);setMessage('Unable to check the Downloader connection.');}
    finally{setChecking(false);}
  },[]);
  useEffect(()=>{
    let live=true;
    void Promise.allSettled([request<Connection>('/connection'),request<Entitlements>('/entitlements')])
      .then(results=>{
        if(!live)return;
        const [source,access]=results;
        if(source.status==='fulfilled')setConnection(source.value);
        else setMessage('Unable to read the Downloader service status.');
        if(access.status==='fulfilled'){
          setUsers(members(access.value.allowed_users));
          setGroups(members(access.value.allowed_groups));
        }else setMessage('Unable to read who can download.');
      }).finally(()=>{if(live)setLoading(false)});
    return ()=>{live=false};
  },[]);
  async function refreshFilesConnections() {
    setConnectionsBusy(true);
    setConnectionError('');
    try {
      const current=await request<FilesConnections>('/files-connections');
      setFilesConnections(current);
    } catch(error) {
      setConnectionError(error instanceof Error ? error.message :
        'Could not check users’ Files connection status.');
    } finally {setConnectionsBusy(false);}
  }

  async function save(event:FormEvent){
    event.preventDefault();setSaving(true);
    try{
      const result=await request<Entitlements>('/entitlements',{method:'PUT',body:JSON.stringify({
        allowed_users:users.join(','),allowed_groups:groups.join(','),
      })});
      setUsers(members(result.allowed_users));setGroups(members(result.allowed_groups));
      setDirty(false);setMessage('Saved ✓ Access changes now apply to Nextcloud users.');
      setFilesConnections(null);
    }catch(error){setMessage(error instanceof Error?error.message:'Could not save access.');}
    finally{setSaving(false);}
  }
  return <main className="downloader-admin">
    <header className="admin-heading">
      <div><p className="eyebrow">NEXTCLOUD ADMINISTRATION</p><h1>Downloader settings</h1>
        <p className="muted">Core downloads are managed by your standalone Downloader Server. Nextcloud controls who can use it.</p></div>
      <a href={ROOT+'/api-reference'}>For developers: API reference</a>
    </header>
    {message&&<p className="admin-notice" role="status">{message}</p>}
    <nav className="admin-tabs" aria-label="Downloader administration">
      <button className={tab==='connection'?'active':''} onClick={()=>setTab('connection')}>Service connection</button>
      <button className={tab==='access'?'active':''} onClick={()=>setTab('access')}>Who can download</button>
    </nav>
    {loading&&<section className="admin-card" role="status"><div className="skeleton"/>
      <p>Checking Downloader configuration…</p></section>}
    {!loading&&tab==='connection'&&<section className="admin-card">
      <h2>Service connection</h2>
      <p>Downloader runs in a separate container. Nextcloud connects securely through AppAPI.</p>
      <dl>
        <div><dt>Core URL</dt><dd>{connection?.core_origin||'Not available'}</dd></div>
        <div><dt>Core token</dt><dd>{connection?.token_configured?'Configured ✓ (never sent to the browser)':'Not configured'}</dd></div>
        <div><dt>Status</dt><dd className={connection?.connected?'ok':'problem'}>
          {connection?.connected?'Connected ✓':connection?.message||'Not connected'}</dd></div>
        {connection?.connected&&<div><dt>Ready engines</dt><dd>{connection.engines_ready}</dd></div>}
      </dl>
      <button type="button" className="primary" disabled={checking} onClick={()=>void check()}>
        {checking?'Checking…':'Check connection'}
      </button>
      <p className="muted">To change the core URL or private API token, use Nextcloud Administration → AppAPI for this ExApp. The token is kept server-side and is not editable from this browser.</p>
    </section>}
    {!loading&&tab==='access'&&<section className="admin-card">
      <h2>Who can download</h2>
      <p>Only people on this list can use the downloader. Everyone else does not see the Downloader controls.</p>
      <p className="muted">Add individual Nextcloud user IDs or a group ID to grant access to every member. Leaving both lists empty denies all ordinary users.</p>
      <form onSubmit={save}>
        <MemberEditor title="People" items={users} onChange={items=>{setUsers(items);setDirty(true)}}/>
        <MemberEditor title="Groups" items={groups} onChange={items=>{setGroups(items);setDirty(true)}}/>
        <button type="submit" className="primary" disabled={saving||!dirty}>{saving?'Saving…':'Save access'}</button>
      </form>
      <section className="admin-readiness" aria-label="Entitled users Files connection status">
        <div className="admin-readiness-heading">
          <div><h3>Files connection status</h3>
            <p className="muted">Check which people granted access have connected their own Files.
              Only the connection state is shown; app passwords stay private.</p></div>
          <button type="button" className="secondary" disabled={connectionsBusy||dirty}
            onClick={()=>void refreshFilesConnections()}>
            {connectionsBusy?'Checking…':'Check Files connections'}</button>
        </div>
        {dirty&&<p className="muted">Save your access changes before checking current users.</p>}
        {connectionError&&<p className="admin-notice" role="alert">{connectionError}
          {' '}Try again to refresh the results.</p>}
        {filesConnections&&<>
          {filesConnections.partial&&<p className="admin-notice" role="status">
            Partial group results: Nextcloud could not list everyone or this installation has
            more than {filesConnections.scan_limit} users. A missing row does not mean disconnected.
          </p>}
          {!filesConnections.users.length&&!filesConnections.groups.length
            ? <p className="muted">No individual entitlements or group members are available to check.</p>
            : <>
              <h4>People with access</h4>
              <div className="admin-chips admin-status-list">
                {filesConnections.users.map(person=><div key={person.user_id}
                  className="admin-connection-person">
                  <strong>{person.user_id}</strong>
                  <span className={'admin-connection-state '+person.connection}>
                    {person.connection==='connected'?'Connected ✓'
                      :person.connection==='not_connected'?'Not connected':'Status unavailable'}
                  </span>
                  {person.via_groups.length>0&&<small className="muted">
                    via {person.via_groups.join(', ')}</small>}
                </div>)}
              </div>
              {!!filesConnections.groups.length&&<>
                <h4>Entitled groups</h4>
                <div className="admin-group-list">
                  {filesConnections.groups.map(group=><p key={group.name}>
                    <strong>{group.name}</strong> — {group.connected} connected,
                    {' '}{group.not_connected} not connected,
                    {' '}{group.unknown} unavailable
                    {group.partial?' · partial scan':''}
                  </p>)}
                </div>
              </>}
            </>}
        </>}
      </section>
    </section>}
    <footer className="muted">Downloader Server · Nextcloud AppAPI administrator settings</footer>
  </main>;
}
