/** Native Nextcloud Personal settings. Server binds all preferences to signed user. */
type Personal = {
  destination_folder:string;default_preset:string;app_password_configured:boolean;
  notify_finished:boolean;notify_failed:boolean;
  engine_settings:Record<string,Record<string,unknown>>;
  header_indicator_visibility:'active'|'always';dropdown_content:'active'|'all';
  preset_hidden:string[];preset_order:string[];
};
type Preset={id:string;name:string;description?:string;engine?:string;is_shared?:boolean;
  is_builtin?:boolean;is_hidden?:boolean;is_admin_managed?:boolean;settings?:Record<string,string>};
type AdminCatalog={presets:Preset[];order:string[];hidden:string[]};
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
async function adminApi<T>(path:string,method='GET',payload?:unknown):Promise<T>{
  const prefix=oc()!.generateUrl('/apps/app_api/proxy/downloader-server-nextcloud/admin/api');
  const res=await fetch(prefix+path,{
    method,credentials:'same-origin',headers:{
      'OCS-APIRequest':'true',
      ...(oc()?.requestToken?{requesttoken:oc()!.requestToken!}:{}),
      ...(payload===undefined?{}:{'Content-Type':'application/json'})},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
  });
  const body=await res.json().catch(()=>null);
  if(!res.ok)throw new Error((body as {detail?:string}|null)?.detail||'Cannot update shared presets');
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
#downloader-settings-app .downloader-picker li{list-style:none;display:flex;gap:8px;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--color-border,#ccc)}
#downloader-settings-app .downloader-picker ul{padding:0;margin:8px 0}
#downloader-settings-app .downloader-picker-buttons{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}
#downloader-settings-app .downloader-advanced{margin-top:16px;padding:16px;border:1px solid var(--color-border,#ccc);border-radius:10px}
#downloader-settings-app .downloader-advanced summary{font-weight:600;cursor:pointer}
#downloader-settings-app .preset-list{display:grid;gap:4px;padding:0;margin:8px 0}
#downloader-settings-app .preset-row{display:flex;gap:6px;align-items:center;min-width:0;padding:5px 0;border-bottom:1px solid var(--color-border,#ddd);font-size:12px}
#downloader-settings-app .preset-row .preset-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
#downloader-settings-app .preset-row button{padding:2px 6px;min-height:28px}
#downloader-settings-app .preset-row .preset-toggle{width:16px;height:16px}
.downloader-preset-dialog[open]{position:fixed!important;inset:0!important;margin:auto!important;width:min(480px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:22px;border:1px solid var(--color-border,#bbb);border-radius:12px;background:var(--color-main-background,#fff);color:var(--color-main-text,#222)}
.downloader-preset-dialog::backdrop{background:#0008}
.downloader-preset-dialog form{display:grid;gap:10px}
.downloader-preset-dialog :is(input,select){width:100%;padding:8px;box-sizing:border-box}
.downloader-preset-dialog .preset-dialog-actions{display:flex;justify-content:flex-end;gap:8px}
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
    dirty[key]=value;
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
  function setup(data:Personal,presets:Preset[],adminUser:boolean,adminCatalog:AdminCatalog|null){
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
          folder.value=page.path||'(Files root)';
          changed('destination_folder',page.path);
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
    browse.addEventListener('click',()=>{if(!picker.hidden)picker.hidden=true;
      else void openFolder(data.destination_folder||'');});
    const preset=element('select');
    const defaultOption=element('option','Automatic / no preset');defaultOption.value='';preset.append(defaultOption);
    for(const item of presets.filter(item=>!item.is_hidden)){
      const choice=element('option',item.name);choice.value=item.id;preset.append(choice);
    }
    preset.value=data.default_preset||'';
    preset.addEventListener('change',()=>changed('default_preset',preset.value));
    destination.append(label('Default preset',preset),
      element('p','Presets are displayed by name. You can override this for an individual download.'));


    const header=card('Header downloads',
      'Choose when the downloads arrow appears and which downloads its bubble shows.');
    const visibility=element('select');
    for(const [value,txt] of [['active','Only while downloading (default)'],['always','Always show the arrow']]){
      const option=element('option',txt);option.value=value;visibility.append(option);
    }
    visibility.value=data.header_indicator_visibility||'active';
    visibility.addEventListener('change',()=>changed('header_indicator_visibility',visibility.value));
    const content=element('select');
    for(const [value,txt] of [['active','Active downloads only (default)'],['all','Active first, then finished']]){
      const option=element('option',txt);option.value=value;content.append(option);
    }
    content.value=data.dropdown_content||'active';
    content.addEventListener('change',()=>changed('dropdown_content',content.value));
    header.append(label('Header indicator visibility',visibility),label('Dropdown content',content));

    const presetsCard=card('Download presets',
      'Move presets up or down for your own menu, or hide them. You can restore hidden presets here.');
    const personalList=element('div');personalList.className='preset-list';
    const current=new Map(presets.map(item=>[item.id,item]));
    const ownHidden=new Set(data.preset_hidden||[]);
    let ownOrder=[...new Set([...(data.preset_order||[]),...presets.map(item=>item.id)])]
      .filter(id=>current.has(id));
    function drawPersonal(){
      personalList.replaceChildren();
      ownOrder.forEach((id,index)=>{
        const item=current.get(id)!;
        const row=element('div');row.className='preset-row';
        const checkbox=element('input');checkbox.type='checkbox';
        checkbox.className='preset-toggle';checkbox.checked=!ownHidden.has(id);
        checkbox.setAttribute('aria-label','Show '+item.name);
        checkbox.addEventListener('change',()=>{
          checkbox.checked?ownHidden.delete(id):ownHidden.add(id);
          changed('preset_hidden',[...ownHidden]);drawPersonal();
        });
        const name=element('span',item.name);name.className='preset-name';
        name.title=(item.description||'')+(item.engine?' · '+item.engine:'');
        const up=element('button','↑'),down=element('button','↓');
        for(const button of [up,down])button.type='button';
        up.setAttribute('aria-label','Move '+item.name+' up');
        down.setAttribute('aria-label','Move '+item.name+' down');
        up.disabled=index===0;down.disabled=index===ownOrder.length-1;
        function move(to:number){
          [ownOrder[index],ownOrder[to]]=[ownOrder[to],ownOrder[index]];
          changed('preset_order',[...ownOrder]);drawPersonal();
        }
        up.addEventListener('click',()=>move(index-1));
        down.addEventListener('click',()=>move(index+1));
        row.append(checkbox,name,up,down);
        personalList.append(row);
      });
    }
    drawPersonal();presetsCard.append(personalList);
    if(adminUser&&adminCatalog){
      const adminHeading=element('h3','Shared catalogue (administrators only)');
      const note=element('p','Change the global default order, exclude shared entries, or add and edit your own shared presets.');
      const add=element('button','+ Add preset');add.type='button';
      const globalList=element('div');globalList.className='preset-list';
      const globals=new Map(adminCatalog.presets.map(item=>[item.id,item]));
      let globalOrder=[...new Set([...(adminCatalog.order||[]),...adminCatalog.presets.map(item=>item.id)])]
        .filter(id=>globals.has(id));
      const globalHidden=new Set(adminCatalog.hidden||[]);
      let adminTimer:number|undefined;
      async function saveGlobal(){
        try {
          await adminApi('/preset-catalog','PUT',{order:globalOrder,hidden:[...globalHidden]});
          status.firstChild!.textContent='Shared catalogue saved.';
        }catch(error){
          status.firstChild!.textContent=error instanceof Error?error.message:'Could not save catalogue.';
        }
      }
      function queueGlobal(){window.clearTimeout(adminTimer);adminTimer=window.setTimeout(()=>{void saveGlobal();},450);}
      function editModal(item?:Preset){
        const dlg=element('dialog');dlg.className='downloader-preset-dialog';
        const form=element('form');form.method='dialog';
        const h=element('h2',item?'Edit shared preset':'Add preset');
        const name=element('input');name.required=true;name.maxLength=120;name.value=item?.name||'';
        const description=element('input');description.maxLength=500;
        description.value=item?.description||'';
        const engine=element('select');
        for(const [key,name] of [['yt-dlp','Video / audio'],['gallery-dl','Image gallery'],
          ['aria2c','Large direct file'],['generic','Direct file']]){
          const opt=element('option',name);opt.value=key;engine.append(opt);
        }
        engine.value=item?.engine||'yt-dlp';
        const format=element('select');
        for(const [value,name] of [
          ['','Automatic'],['bv*+ba/b','Best video'],['bv*[height<=1080]+ba/b[height<=1080]','Up to 1080p'],
          ['bv*[height<=720]+ba/b[height<=720]','Up to 720p'],
          ['bv*[height<=480]+ba/b[height<=480]','Up to 480p'],
          ['bestaudio/best','Audio only'],['bestaudio[ext=m4a]/bestaudio/best','Audio M4A'],
          ['bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b','MP4 preferred']]){
          const option=element('option',name);option.value=value;format.append(option);
        }
        format.value=item?.settings?.format||'';
        const updateEngine=()=>{format.disabled=engine.value!=='yt-dlp';if(format.disabled)format.value='';};
        engine.addEventListener('change',updateEngine);updateEngine();
        const controls=element('div');controls.className='preset-dialog-actions';
        const cancel=element('button','Cancel');cancel.type='button';
        const submit=element('button',item?'Save preset':'Create preset');
        submit.className='primary';submit.type='submit';
        cancel.addEventListener('click',()=>dlg.close());
        controls.append(cancel,submit);
        form.append(h,label('Preset name (required)',name),label('Description (optional)',description),
          label('Download type',engine),label('Quality / format',format),controls);
        dlg.append(form);document.body.append(dlg);
        dlg.addEventListener('close',()=>dlg.remove(),{once:true});
        form.addEventListener('submit',event=>{
          event.preventDefault();submit.disabled=true;
          void adminApi(item?'/presets/'+encodeURIComponent(item.id):'/presets',
            item?'PUT':'POST',{name:name.value,description:description.value,
              engine:engine.value,format:format.value}).then(()=>{
            dlg.close();void reload();
          }).catch(error=>{
            status.firstChild!.textContent=error instanceof Error?error.message:'Could not save preset.';
          }).finally(()=>{submit.disabled=false;});
        });
        dlg.showModal();name.focus();
      }
      function drawGlobal(){
        globalList.replaceChildren();
        globalOrder.forEach((id,index)=>{
          const item=globals.get(id)!;
          const row=element('div');row.className='preset-row';
          const checkbox=element('input');checkbox.type='checkbox';
          checkbox.className='preset-toggle';checkbox.checked=!globalHidden.has(id);
          checkbox.setAttribute('aria-label','Include globally: '+item.name);
          checkbox.addEventListener('change',()=>{
            checkbox.checked?globalHidden.delete(id):globalHidden.add(id);
            queueGlobal();
          });
          const title=element('span',item.name);title.className='preset-name';
          const up=element('button','↑'),down=element('button','↓');
          up.type='button';down.type='button';
          up.disabled=index===0;down.disabled=index===globalOrder.length-1;
          function move(to:number){
            [globalOrder[index],globalOrder[to]]=[globalOrder[to],globalOrder[index]];
            drawGlobal();queueGlobal();
          }
          up.addEventListener('click',()=>move(index-1));
          down.addEventListener('click',()=>move(index+1));
          row.append(checkbox,title,up,down);
          if(item.is_admin_managed){
            const edit=element('button','Edit');edit.type='button';
            edit.addEventListener('click',()=>editModal(item));row.append(edit);
            const remove=element('button','Delete');remove.type='button';
            remove.setAttribute('aria-label','Delete shared preset '+item.name);
            remove.addEventListener('click',()=>{
              const dlg=element('dialog');dlg.className='downloader-preset-dialog';
              const message=element('p','Delete "'+item.name+'" from the shared catalogue? This does not delete downloaded Files.');
              const actions=element('div');actions.className='preset-dialog-actions';
              const cancel=element('button','Keep preset'),confirm=element('button','Delete preset');
              cancel.type='button';confirm.type='button';
              cancel.addEventListener('click',()=>dlg.close());
              confirm.addEventListener('click',()=>{
                confirm.disabled=true;
                void adminApi('/presets/'+encodeURIComponent(item.id),'DELETE').then(()=>{
                  dlg.close();void reload();
                }).catch(error=>{
                  status.firstChild!.textContent=error instanceof Error?error.message:'Could not delete preset.';
                }).finally(()=>{confirm.disabled=false;});
              });
              actions.append(cancel,confirm);dlg.append(element('h2','Delete shared preset'),message,actions);
              document.body.append(dlg);
              dlg.addEventListener('close',()=>dlg.remove(),{once:true});
              dlg.showModal();
            });
            row.append(remove);
          }
          globalList.append(row);
        });
      }
      add.addEventListener('click',()=>editModal());
      drawGlobal();presetsCard.append(adminHeading,note,add,globalList);
    }

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
      const [data,presets,me]=await Promise.all([
        api<Personal>('/settings'),api<Preset[]>('/presets?include_hidden=true'),
        api<{can_manage_presets:boolean}>('/me'),
      ]);
      const admin=me.can_manage_presets
        ?await adminApi<AdminCatalog>('/preset-catalog'):null;
      setup(data,presets,!!me.can_manage_presets,admin);
      status.firstChild!.textContent='All changes save automatically.';
    }catch(error){
      status.firstChild!.textContent=error instanceof Error?error.message:'Could not load settings.';
    }
  }
  void reload();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
else start();
