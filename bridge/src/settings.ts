/** Native Nextcloud Personal settings. Server binds all preferences to signed user. */
type Personal = {
  destination_folder:string;app_password_configured:boolean;
  destination_routes:Record<string,string>;
  destination_route_overrides:Record<string,string>;
  existing_file_behavior:'rename'|'skip';
  notify_finished:boolean;notify_failed:boolean;
  default_video_quality:string;default_audio_quality:string;
  engine_settings:Record<string,Record<string,unknown>>;
  header_indicator_visibility:'active'|'always';dropdown_content:'active'|'all';
};
type Folder={name:string;path:string};
type FolderList={path:string;folders:Folder[];offset:number;has_more:boolean};
type Oc={generateUrl:(path:string)=>string;requestToken?:string};
const oc=()=>(window as unknown as {OC?:Oc}).OC;
const apiRoot=()=>oc()!.generateUrl('/apps/app_api/proxy/downloader-server-nextcloud/user/api');
const element=<K extends keyof HTMLElementTagNameMap>(type:K,text=''):HTMLElementTagNameMap[K]=>{
  const node=document.createElement(type);node.textContent=text;return node;
};
async function api<T>(path:string,method='GET',payload?:unknown):Promise<T>{
  const response=await fetch(apiRoot()+path,{
    method,credentials:'same-origin',
    headers:{'OCS-APIRequest':'true',
      ...(oc()?.requestToken?{requesttoken:oc()!.requestToken!}:{}),
      ...(payload===undefined?{}:{'Content-Type':'application/json'})},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
  });
  const body=await response.json().catch(()=>null);
  if(!response.ok){
    const error=body as {detail?:string}|null;
    throw new Error(error?.detail||'Your settings could not be saved.');
  }
  return body as T;
}
const CSS=`
#downloader-settings-app{max-width:1020px;min-width:0;color:var(--color-main-text,#222)}
#downloader-settings-app .downloader-setting-title{margin-bottom:4px;font-size:22px}
#downloader-settings-app .downloader-settings-help{color:var(--color-text-maxcontrast,#666);margin:0 0 14px}
#downloader-settings-app .downloader-save-status{display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-height:26px;color:var(--color-text-maxcontrast,#666);font-size:13px;margin-bottom:14px}
#downloader-settings-app .downloader-settings-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px;align-items:start}
#downloader-settings-app .downloader-settings-card{min-width:0;padding:18px;border:1px solid var(--color-border,#ccc);border-radius:var(--border-radius-large,12px);background:var(--color-main-background,#fff)}
#downloader-settings-app .downloader-settings-card h3{font-size:17px;margin:0 0 10px}
#downloader-settings-app .downloader-settings-card p{font-size:13px;line-height:1.5;color:var(--color-text-maxcontrast,#666);margin:8px 0 14px}
#downloader-settings-app label{display:grid;gap:6px;margin-bottom:12px;font-weight:600;font-size:13px}
#downloader-settings-app :is(input,select,textarea){width:100%;min-width:0;box-sizing:border-box;padding:8px;border:1px solid var(--color-border,#bbb);border-radius:8px;background:var(--color-main-background,#fff);color:var(--color-main-text,#222)}
#downloader-settings-app input[type=checkbox]{width:20px;height:20px}
#downloader-settings-app .downloader-check{display:flex;align-items:center;gap:9px;font-weight:400}
#downloader-settings-app button{cursor:pointer;border:1px solid var(--color-border,#aaa);border-radius:8px;background:var(--color-main-background,#fff);color:inherit;padding:8px 12px;min-height:38px}
#downloader-settings-app button.primary{background:var(--color-primary,#377bd1);color:var(--color-primary-text,#fff)}
#downloader-settings-app button:disabled{opacity:.6;cursor:default}
#downloader-settings-app .downloader-picker{padding:10px;border:1px solid var(--color-border,#bbb);border-radius:9px;margin:12px 0;max-height:320px;overflow-y:auto}
#downloader-settings-app .downloader-picker li{list-style:none;display:flex;gap:8px;align-items:center;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--color-border,#ccc)}
#downloader-settings-app .downloader-picker li button{height:26px;min-height:26px;padding:2px 7px;line-height:1.2}
#downloader-settings-app .downloader-picker ul{padding:0;margin:8px 0}
#downloader-settings-app .downloader-picker-buttons{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}
#downloader-settings-app .downloader-advanced{margin-top:16px;padding:16px;border:1px solid var(--color-border,#ccc);border-radius:10px}
#downloader-settings-app .downloader-advanced summary{font-weight:600;cursor:pointer}
#downloader-settings-app select.downloader-header-select{width:max-content;max-width:100%;align-self:start}
#downloader-settings-app :is(button,input,select,summary):focus-visible{outline:3px solid var(--color-primary,#377bd1);outline-offset:2px}
`;
function start() {
  const root=document.getElementById('downloader-settings-app');
  if(!root)return;
  document.head.append(Object.assign(element('style'),{textContent:CSS}));
  root.replaceChildren();
  const title=element('h2','Downloader settings');title.className='downloader-setting-title';
  const intro=element('p','These preferences apply only to your own downloads and Files.');
  intro.className='downloader-settings-help';
  const status=element('p','Loading your settings…');status.className='downloader-save-status';
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const retry=element('button','Retry saving');retry.hidden=true;retry.type='button';
  status.append(retry);
  const cards=element('div');cards.className='downloader-settings-grid';
  root.append(title,intro,status,cards);
  let personal:Personal|null=null;
  let dirty:Record<string,unknown>={};
  let saving=false;
  let timer:number|undefined;

  async function save(){
    window.clearTimeout(timer);
    if(saving||!Object.keys(dirty).length)return;
    const patch=dirty;dirty={};saving=true;
    status.firstChild!.textContent='Saving changes…';retry.hidden=true;
    try {
      const updated=await api<Personal>('/settings','PUT',patch);
      // Keep the latest locally-selected fields; an in-flight request must
      // never overwrite changes made since the request started.
      personal={...updated,...dirty} as Personal;
      status.firstChild!.textContent=Object.keys(dirty).length
        ? 'Saving your latest changes…' : 'Saved ✓ Changes apply to new downloads.';
    }catch(error){
      dirty={...patch,...dirty};
      status.firstChild!.textContent=error instanceof Error?error.message:'Could not save settings.';
      retry.hidden=false;
    }finally{
      saving=false;
      if(Object.keys(dirty).length && retry.hidden){
        timer=window.setTimeout(()=>{void save();},450);
      }
    }
  }
  retry.addEventListener('click',()=>{retry.hidden=true;void save();});
  function changed(key:string,value:unknown){
    if(key==='destination_routes' && typeof value==='object' && value!==null){
      const before=dirty[key] as Record<string,unknown>|undefined;
      dirty[key]={...(before||{}),...(value as Record<string,unknown>)};
    }else dirty[key]=value;
    if(personal)(personal as unknown as Record<string,unknown>)[key]=value;
    status.firstChild!.textContent='Changes will save automatically…';
    retry.hidden=true;
    window.clearTimeout(timer);
    timer=window.setTimeout(()=>{void save();},450);
  }
  function card(heading:string,description:string){
    const box=element('section');box.className='downloader-settings-card';
    box.append(element('h3',heading),element('p',description));cards.append(box);return box;
  }
  function label(name:string,control:HTMLElement){
    const holder=element('label',name);holder.append(control);return holder;
  }
  function setup(data:Personal){
    personal=data;
    cards.replaceChildren();
    const destination=card('Where your downloads go',
      'Files are delivered to a folder in your own Nextcloud account. Downloads is the default.');
    const folder=element('input');folder.readOnly=true;
    folder.value=data.destination_folder||'(Files root)';
    destination.append(label('Default Files folder',folder));
    const browse=element('button','Browse my Files folders');browse.type='button';
    destination.append(browse);
    const picker=element('div');picker.className='downloader-picker';picker.hidden=true;destination.append(picker);
    let onFolderChosen=(path:string)=>{
      folder.value=path||'(Files root)';
      data.destination_folder=path;
      changed('destination_folder',path);
    };
    async function openFolder(path:string,offset=0){
      picker.hidden=false;picker.replaceChildren(element('p','Loading folders…'));
      try {
        const params=new URLSearchParams({path,offset:String(offset)});
        const page=await api<FolderList>('/folders?'+params);
        picker.replaceChildren(element('strong','Current folder: /'+page.path));
        const buttons=element('div');buttons.className='downloader-picker-buttons';
        const parent=element('button','Parent folder'), choose=element('button','Use this folder');
        parent.disabled=!page.path;choose.className='primary';
        parent.addEventListener('click',()=>{
          void openFolder(page.path.split('/').slice(0,-1).join('/'));
        });
        choose.addEventListener('click',()=>{
          onFolderChosen(page.path);
          picker.hidden=true;
        });
        buttons.append(parent,choose);picker.append(buttons);
        const list=element('ul');
        for(const entry of page.folders){
          const li=element('li');li.append(element('span','📁 '+entry.name));
          const open=element('button','Open');open.type='button';
          open.addEventListener('click',()=>{void openFolder(entry.path);});
          li.append(open);list.append(li);
        }
        picker.append(list);
        if(page.has_more){
          const more=element('button','More folders');
          more.addEventListener('click',()=>{void openFolder(page.path,page.offset+100);});
          picker.append(more);
        }
      }catch(error){
        picker.replaceChildren(element('p',error instanceof Error?error.message:'Unable to browse Files.'));
      }
    }
    browse.addEventListener('click',()=>{
      if(!picker.hidden){picker.hidden=true;return;}
      destination.append(picker);
      onFolderChosen=(path)=>{
        folder.value=path||'(Files root)';
        data.destination_folder=path;
        changed('destination_folder',path);
        // Default route paths follow the configured base until overridden.
        for(const [kind,sub] of Object.entries(routeSubfolders)){
          if(!customRoutes.has(kind))routeFields[kind].value=[path,sub].filter(Boolean).join('/');
        }
      };
      void openFolder(data.destination_folder||'');
    });

    const routes=card('Destination routing by content type',
      'Each type goes to its own folder inside your default Downloads folder unless you choose a different existing Files folder. Starting from a specific folder always overrides these routes.');
    const routeSubfolders:Record<string,string>={
      video:'Video',audio:'Audio',images:'Images',manga:'Manga',
      direct:'Direct files',torrent:'Torrents',
    };
    const routeLabels:Record<string,string>={
      video:'Video',audio:'Audio',images:'Images / galleries',
      manga:'Manga / comics',direct:'Direct files',torrent:'Torrents',
    };
    const customRoutes=new Set(Object.keys(data.destination_route_overrides||{}));
    const routeFields:Record<string,HTMLInputElement>={};
    for(const [kind,subfolder] of Object.entries(routeSubfolders)){
      const group=element('div');group.className='downloader-route-item';
      const field=element('input');field.readOnly=true;
      field.value=data.destination_routes?.[kind]||[data.destination_folder,subfolder].filter(Boolean).join('/');
      routeFields[kind]=field;
      group.append(label(routeLabels[kind]+' folder',field));
      const actions=element('div');actions.className='downloader-picker-buttons';
      const selectFolder=element('button','Choose folder');
      selectFolder.type='button';
      selectFolder.addEventListener('click',()=>{
        routes.append(picker);picker.hidden=true;
        onFolderChosen=(path)=>{
          field.value=path||'(Files root)';
          customRoutes.add(kind);
          data.destination_routes={...data.destination_routes,[kind]:path};
          changed('destination_routes',{[kind]:path});
        };
        // The base Downloads folder may not exist on a brand-new account.
        void openFolder('');
      });
      const reset=element('button','Use default');
      reset.type='button';
      reset.addEventListener('click',()=>{
        customRoutes.delete(kind);
        const next=[data.destination_folder,subfolder].filter(Boolean).join('/');
        field.value=next;
        data.destination_routes={...data.destination_routes,[kind]:next};
        changed('destination_routes',{[kind]:null});
      });
      actions.append(selectFolder,reset);group.append(actions);routes.append(group);
    }

    const collisions=card('When a destination file already exists',
      'Never overwrite an existing file. Choose whether to rename the incoming file or skip it and notify you.');
    const collisionChoice=element('select');
    for(const [value,text] of [
      ['rename','Rename the incoming file'],['skip','Skip the download'],
    ]){
      const option=element('option',text);option.value=value;collisionChoice.append(option);
    }
    collisionChoice.value=data.existing_file_behavior==='skip'?'skip':'rename';
    collisionChoice.addEventListener('change',()=>changed('existing_file_behavior',collisionChoice.value));
    collisions.append(label('Existing-file behaviour',collisionChoice));

    const header=card('Header downloads',
      'Choose when the downloads arrow appears and which downloads its bubble shows.');
    const visibility=element('select');visibility.className='downloader-header-select';
    for(const [value,txt] of [['active','Only while downloading (default)'],['always','Always show the arrow']]){
      const option=element('option',txt);option.value=value;visibility.append(option);
    }
    visibility.value=data.header_indicator_visibility||'active';
    visibility.addEventListener('change',()=>changed('header_indicator_visibility',visibility.value));
    const content=element('select');content.className='downloader-header-select';
    for(const [value,txt] of [['active','Active downloads only (default)'],['all','Active first, then finished']]){
      const option=element('option',txt);option.value=value;content.append(option);
    }
    content.value=data.dropdown_content||'active';
    content.addEventListener('change',()=>changed('dropdown_content',content.value));
    header.append(label('Header indicator visibility',visibility),label('Dropdown content',content));

    const qualityDefaults=card('Default download quality',
      'New Download into my Files dialogs start with these preferences. You can change quality for each download.');
    function qualityPreference(
      field:'default_video_quality'|'default_audio_quality',heading:string,
      choices:Array<[string,string]>,fallback:string
    ){
      const input=element('select');
      for(const [value,display] of choices){
        const option=element('option',display);option.value=value;input.append(option);
      }
      input.value=data[field]||fallback;
      input.addEventListener('change',()=>changed(field,input.value));
      qualityDefaults.append(label(heading,input));
    }
    qualityPreference('default_video_quality','Default video quality',[
      ['best','Best available'],['1080','Up to 1080p'],['720','Up to 720p'],['480','Up to 480p'],
    ],'best');
    qualityPreference('default_audio_quality','Default audio quality',[
      ['best','Best available'],['192','Up to 192 kbps'],['128','Up to 128 kbps'],['small','Smallest available'],
    ],'best');

    const files=card('Files connection',
      'Downloader uses a dedicated, securely stored Nextcloud Files password. Your Core service connection is handled by the installation.');
    const connection=element('p',data.app_password_configured
      ? 'Configured ✓ A Files password is stored for your account.'
      : 'Not connected. Connect Files before starting a download.');
    connection.setAttribute('role','status');files.append(connection);
    const connect=element('button',data.app_password_configured?'Update Files connection':'Connect my Files');
    const form=element('form');form.hidden=true;
    const password=element('input');password.type='password';password.autocomplete='new-password';
    password.placeholder='Nextcloud Files app password';
    const apply=element('button','Save Files connection');apply.className='primary';apply.type='submit';
    const security=element('a','Create an app password in Nextcloud Security');
    security.href=oc()!.generateUrl('/settings/user/security');
    form.append(label('Dedicated Files password',password),security,apply);
    connect.addEventListener('click',()=>{form.hidden=!form.hidden;if(!form.hidden)password.focus();});
    form.addEventListener('submit',event=>{event.preventDefault();
      if(!password.value)return;
      apply.disabled=true;
      const secret=password.value;
      password.value='';
      void api<Personal>('/settings','PUT',{app_password:secret}).then(updated=>{
        personal={...personal,...updated};connection.textContent='Configured ✓ Your Files password was saved.';
        connect.textContent='Update Files connection';form.hidden=true;
      }).catch(error=>{
        connection.textContent=error instanceof Error?error.message:'Could not connect Files.';
      }).finally(()=>{apply.disabled=false;});
    });
    files.append(connect,form);

    const notifications=card('Notifications',
      'Get a native Nextcloud notification when a download finishes or fails.');
    function check(name:string,key:'notify_finished'|'notify_failed',value:boolean){
      const checkbox=element('input');checkbox.type='checkbox';checkbox.checked=value;
      checkbox.addEventListener('change',()=>changed(key,checkbox.checked));
      const holder=element('label',name);holder.className='downloader-check';holder.prepend(checkbox);
      notifications.append(holder);
    }
    check('Notify me when a download finishes','notify_finished',data.notify_finished!==false);
    check('Notify me if a download fails','notify_failed',data.notify_failed!==false);

    const advanced=element('details');advanced.className='downloader-advanced';
    const toggle=element('summary','Advanced — technical engine settings');
    const explanation=element('p','JSON options are for administrators and experienced users only.');
    const json=element('textarea');json.rows=6;
    json.value=JSON.stringify(data.engine_settings||{},null,2);
    const saveJson=element('button','Save advanced settings');
    saveJson.type='button';
    saveJson.addEventListener('click',()=>{
      try {
        const value=JSON.parse(json.value);
        if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
        changed('engine_settings',value);
      }catch{
        status.firstChild!.textContent='Engine settings must be a JSON object.';
        retry.hidden=true;
      }
    });
    advanced.append(toggle,explanation,label('Engine settings JSON',json),saveJson);
    root.append(advanced);
  }
  async function reload(){
    try{
      const data=await api<Personal>('/settings');
      setup(data);
      status.firstChild!.textContent='All changes save automatically.';
    }catch(error){
      status.firstChild!.textContent=error instanceof Error?error.message:'Could not load settings.';
    }
  }
  void reload();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
else start();
