import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';
import {downloadStatus, downloadTitle, downloadBubbleStatus, DOWNLOAD_QUEUED_MESSAGE} from '../src/download-labels.mjs';

const catalog=JSON.parse(readFileSync(new URL('../l10n/he.json', import.meta.url), 'utf8'));
const javascript=readFileSync(new URL('../l10n/he.js', import.meta.url), 'utf8');
const labels=readFileSync(new URL('../src/download-labels.mjs', import.meta.url), 'utf8');
const library=readFileSync(new URL('../src/library.ts', import.meta.url), 'utf8');
const bridge=readFileSync(new URL('../src/bridge.ts', import.meta.url), 'utf8');

test('Nextcloud Hebrew JavaScript and PHP catalog forms are identical',()=>{
  let browserCatalog;
  const sandbox={OC:{L10N:{register:(app,translations,pluralForm)=>{
    assert.equal(app,'downloader_bridge');
    browserCatalog={translations,pluralForm};
  }}}};
  vm.runInNewContext(javascript,sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(browserCatalog)), catalog);
  for(const match of labels.matchAll(/t\('downloader_bridge', '([^']+)'/g)){
    assert.equal(typeof catalog.translations[match[1]],'string',
      'Translation missing for: '+match[1]);
  }
});

test('Library labels resolve through the same Nextcloud domain and catalog',()=>{
  assert.match(library,/downloadSymbol, t \} from '\.\/download-labels\.mjs'/);
  const matches=[...library.matchAll(/t\('downloader_bridge', '([^']+)'/g)];
  assert.ok(matches.length>=35,'A full Library screen must not fall back to unlocalized raw labels');
  for(const match of matches){
    assert.equal(typeof catalog.translations[match[1]],'string',
      'Missing native Library catalog translation for '+match[1]);
  }
});

test('shared status labels use native user-language translation when provided',()=>{
  const previous=globalThis.t;
  try {
    globalThis.t=(app,source,replacements={})=>{
      assert.equal(app,'downloader_bridge');
      return (catalog.translations[source]||source)
        .replace(/\{(\w+)\}/g,(_,name)=>replacements[name]??'{'+name+'}');
    };
    const source={id:'a',status:'queued',url:'https://example.org/video'};
    assert.equal(downloadStatus(source),'ממתין בתור');
    assert.equal(downloadStatus({...source,status:'failed',error:'No connection'}),'ההורדה נכשלה — No connection');
    assert.equal(downloadStatus({...source,status:'downloading'}),'בהורדה');
    assert.equal(downloadBubbleStatus({...source,status:'paused'}),'מושהה');
    assert.equal(downloadTitle({id:'a',status:'queued',url:'not-a-url'}),'הורדה');
  } finally {
    if(previous===undefined) delete globalThis.t;
    else globalThis.t=previous;
  }
  assert.equal(DOWNLOAD_QUEUED_MESSAGE,'Download queued. Follow progress in Downloads.');
});

test('RTL-native overlays and badges use logical inline positions',()=>{
  for(const key of ['.dl-toast','.dl-entry-live-badge','.dl-viewer-trigger','.dl-count']){
    assert.ok(bridge.includes(key),'Missing native element '+key);
  }
  for(const css of ['top:70px;inset-inline-end:16px;', 'top:5px;inset-inline-end:5px;',
    'top:18px;inset-inline-end:108px;', 'top:6px;inset-inline-start:6px;']){
    assert.ok(bridge.includes(css),'Expected RTL-aware CSS '+css);
  }
  assert.doesNotMatch(bridge,/\.dl-toast\{[^']*right:/);
});

test('release packaging includes matching catalogs for PHP and JavaScript',t=>{
  // The bridge-package workflow intentionally runs tests in an isolated
  // bridge-only directory. Repository workflows are verified by the separate
  // root-level Python packaging contract in Nextcloud preflight CI.
  if(!existsSync(new URL('../../.github/workflows/bridge-package.yml',import.meta.url))){
    t.skip('Workflow files excluded by isolated bridge build');
    return;
  }
  const release=readFileSync(new URL('../../.github/workflows/bridge-package.yml',import.meta.url),'utf8');
  const deploy=readFileSync(new URL('../../.github/workflows/appapi-docker-deploy-e2e.yml',import.meta.url),'utf8');
  assert.match(release,/cp -a bridge\/appinfo bridge\/lib bridge\/js bridge\/templates bridge\/l10n/);
  assert.match(deploy,/cp -a bridge\/appinfo bridge\/lib bridge\/js bridge\/templates bridge\/l10n/);
  const listener=readFileSync(new URL('../lib/Listener/AssetsListener.php',import.meta.url),'utf8');
  assert.match(listener,/Util::addTranslations\(Application::APP_ID\)/);
  assert.ok(listener.indexOf('Util::addTranslations')<listener.indexOf('Util::addInitScript'));
});


test('Native Files actions, Talk and header use the existing locale catalog',()=>{
  const header=bridge.slice(0,bridge.indexOf('type Provenance ='));
  const matches=[...header.matchAll(/t\('downloader_bridge', '([^']+)'/g)];
  assert.ok(matches.length>=25,'Expected translated actions and header copy');
  for(const match of matches)assert.equal(typeof catalog.translations[match[1]],'string','Missing native header translation: '+match[1]);
  for(const key of ['Download into this folder','Download with Downloader','Download linked URL into my Files','Downloads: {count} unfinished','Resume this download','Pause this download','No active downloads.','Download complete. Open it in Nextcloud Files.']){
    assert.ok(matches.some(match=>match[1]===key),'Missing translated native control: '+key);
  }
  assert.match(header,/\{count: running\.length\}/);
});


test('Cookie vault row labels and status follow the native inline direction',()=>{
  const settings=readFileSync(new URL('../src/settings.ts',import.meta.url),'utf8');
  assert.match(settings,/\.downloader-vault-site\{[^}]*text-align:start/);
  assert.match(settings,/\.downloader-vault-site-status\{[^}]*text-align:end/);
  assert.doesNotMatch(settings,/\.downloader-vault-site(?:-status)?\{[^}]*text-align:(?:left|right)/);
});

import {linkFailureMessage} from '../src/link-first-dialog.mjs';

test('Link dialog entry, failure and direct metadata labels use the native catalog',()=>{
  const dialog=readFileSync(new URL('../src/link-first-dialog.mjs',import.meta.url),'utf8');
  for(const [key] of [["Paste a valid HTTP(S) link or magnet URI.","הדביקו קישור HTTP(S) או קישור מגנט תקין."],["This link is not supported. Try a direct file link or another media link.","הקישור אינו נתמך. נסו קישור ישיר לקובץ או קישור מדיה אחר."],["This link no longer exists. It may have been deleted or made private.","הקישור אינו קיים עוד. ייתכן שנמחק או הוגדר כפרטי."],["Nothing downloadable was found at this link. Ordinary web pages cannot be downloaded here.","לא נמצא תוכן להורדה בקישור הזה. לא ניתן להוריד כאן דפי אינטרנט רגילים."],["Could not check this link. Try again.","לא ניתן לבדוק את הקישור. נסו שוב."],["Download link","הורדה מקישור"],["Paste a link…","הדביקו קישור…"],["Source link","קישור מקור"],["Detecting link content","בודק את תוכן הקישור"],["Download","הורדה"],["Open Downloader settings","פתיחת הגדרות Downloader"],["Connect your Nextcloud Files in Downloader settings before starting a download.","חברו את הקבצים שלכם ב־Nextcloud דרך הגדרות Downloader לפני התחלת ההורדה."],["Could not check your Files connection. Open Downloader settings to reconnect or retry.","לא ניתן לבדוק את החיבור לקבצים. פתחו את הגדרות Downloader כדי להתחבר מחדש או לנסות שוב."],["Could not load more items. Please try again.","לא ניתן לטעון פריטים נוספים. נסו שוב."],["Direct .torrent URLs cannot be inspected or submitted.","לא ניתן לבדוק או לשלוח קישורים ישירים לקובצי torrent."],["Loading torrent file list…","טוען את רשימת קובצי הטורנט…"],["Could not load the torrent file list. Check the magnet link.","לא ניתן לטעון את רשימת קובצי הטורנט. בדקו את קישור המגנט."],["Not a direct file","זה אינו קובץ ישיר"],["This address returns a web page, not a downloadable file.","כתובת זו מובילה לדף אינטרנט ולא לקובץ להורדה."],["Unknown filename","שם קובץ לא ידוע"],["Unverified direct file","קובץ ישיר שלא אומת"],["Direct file","קובץ ישיר"],["Name: {filename}","שם: {filename}"],["Type: {fileType}","סוג: {fileType}"],["Size: {size}","גודל: {size}"],["No quality or conversion controls apply.","אין אפשרויות איכות או המרה לקובץ זה."],["We have not confirmed this file's type or size. Review the filename before downloading.","סוג הקובץ או גודלו טרם אומתו. בדקו את שם הקובץ לפני ההורדה."],["Your Nextcloud Files connection needs attention. Reconnect in Downloader settings.","יש לבדוק את החיבור לקבצים ב־Nextcloud. התחברו מחדש דרך הגדרות Downloader."],["Connect Files in Downloader settings before retrying.","חברו את הקבצים בהגדרות Downloader לפני ניסיון נוסף."],["The destination folder is unavailable. Choose a folder in Downloader settings and retry.","תיקיית היעד אינה זמינה. בחרו תיקייה בהגדרות Downloader ונסו שוב."],["Downloader is not available for this account. Ask your Nextcloud administrator.","Downloader אינו זמין לחשבון זה. פנו למנהל Nextcloud."],["Could not start the download. Please try again. Your link and selections were kept.","לא ניתן להתחיל את ההורדה. נסו שוב. הקישור והבחירות שלכם נשמרו."],["Video","וידאו"],["Audio / music","שמע / מוזיקה"],["Playlist","רשימת השמעה"],["Channel / series","ערוץ / סדרה"],["Image gallery / album","גלריית תמונות / אלבום"],["Manga / comics","מנגה / קומיקס"],["Media","מדיה"],["Live","שידור חי"]]){
    const escaped=key.replaceAll("'", "\\'");
    assert.ok(dialog.includes("t('downloader_bridge', '"+escaped+"'"),'Missing native dialog translation call: '+key);
    assert.equal(typeof catalog.translations[key],'string');
  }
  const previous=globalThis.t;
  try{
    globalThis.t=(app,key)=>{assert.equal(app,'downloader_bridge');return catalog.translations[key]||key;};
    assert.equal(linkFailureMessage('malformed'),catalog.translations['Paste a valid HTTP(S) link or magnet URI.']);
    assert.equal(linkFailureMessage('item_not_found'),catalog.translations['This link no longer exists. It may have been deleted or made private.']);
    assert.equal(linkFailureMessage('unknown'),catalog.translations['Could not check this link. Try again.']);
  }finally{if(previous===undefined)delete globalThis.t;else globalThis.t=previous;}
  assert.equal(linkFailureMessage('malformed'),'Paste a valid HTTP(S) link or magnet URI.');
});


test('Torrent picker labels, tooltips and dynamic summaries use the native catalog',()=>{
  const dialog=readFileSync(new URL('../src/link-first-dialog.mjs',import.meta.url),'utf8');
  const picker=dialog.slice(dialog.indexOf('  function torrentPicker()'),dialog.indexOf('  async function render('));
  for(const key of ["View","File view","Tree view","Flat list","Order by","Name","Size","Ascending (A–Z)","Descending (Z–A)","ascending","descending","Order by: {field}, {direction}","Torrent file filters","File type","No extension","File size (MiB)","Min","Max","Minimum","Maximum","File name","Filter by file name","Path name","Path segment","Filter by partial path segment","{selected} of {total} files selected · {size} total","Select files in {name}","All files","No files match the current filter.","No selectable files were reported for this torrent."]){
    assert.ok(picker.includes("t('downloader_bridge', '"+key+"'"),'Missing translated torrent label: '+key);
    assert.equal(typeof catalog.translations[key],'string');
    assert.deepEqual([...catalog.translations[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...key.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort());
  }
});


test('Media and non-torrent picker controls use native translations',()=>{
  const dialog=readFileSync(new URL('../src/link-first-dialog.mjs',import.meta.url),'utf8');
  for(const key of ["Audio only","Best quality","Up to 192 kbps","Up to 128 kbps","Smallest audio","Up to 1080p","Up to 720p","Up to 480p","Quality","Advanced","Subtitles","Download subtitles","System language ({language})","Subtitle language","No subtitles available.","Original format","Prefer M4A","Prefer WebM","Prefer MP4","Format","No entries match the current filter.","Thumbnail unavailable","Loading additional entries…","Load next batch","Select all / none (loaded entries)","Search / filter","Filter loaded titles","Filter loaded items","All available","Maximum visible items","Check / uncheck loaded items matching filter","Pack as a single CBZ file","Packing these pages into one comic book file is not available yet. Turn this off to download individual items.","Page selection is not available yet","Pages","Try as a direct file","Items appear in the order received. Some previews may not include dates or pictures; more items can be loaded."]){
    assert.ok(dialog.includes("t('downloader_bridge', '"+key+"'"),'Missing translated media label: '+key);
    assert.equal(typeof catalog.translations[key],'string');
    assert.deepEqual([...catalog.translations[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...key.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort());
  }
});


test('Native personal settings use translated static labels and placeholders without changing route IDs',()=>{
  const settings=readFileSync(new URL('../src/settings.ts',import.meta.url),'utf8');
  const keys=[...settings.matchAll(/t\('downloader_bridge', '([^']+)'/g)].map(match=>match[1]);
  assert.ok(keys.length>=65);
  for(const key of keys)assert.equal(typeof catalog.translations[key],'string','Missing native settings translation: '+key);
  for(const key of ['Downloader settings','Choose folder','Use default','Current folder: /{path}','Default Files folder','Video folder','Default download quality','Connect my Files','Save Files connection','Notifications','Advanced — technical engine settings'])assert.ok(keys.includes(key),key);
  assert.match(settings,/CONTENT_ROUTES\.map\(route=>\[route\.id,route\.subfolder\]\)/);
  assert.match(settings,/setDefaultFolder\('Downloads'\)/);
});


test('Cookie vault translated labels keep dynamic site names as replacements, never raw secrets',()=>{
  const vault=readFileSync(new URL('../src/cookie-vault.ts',import.meta.url),'utf8');
  const keys=[...vault.matchAll(/t\('downloader_bridge', '([^']+)'/g)].map(match=>match[1]);
  assert.ok(keys.length>=25);
  for(const key of keys)assert.equal(typeof catalog.translations[key],'string','Missing native vault translation: '+key);
  for(const key of ['Site cookies','Saved site cookies','Select site cookies for {site}','Cookies removed for {site}','Cookies stored for {site}.','Saved · validity not tested'])assert.ok(keys.includes(key),key);
  const form=readFileSync(new URL('../lib/Settings/PersonalSettings.php',import.meta.url),'utf8');
  assert.ok(form.indexOf('Util::addTranslations')<form.indexOf('Util::addScript'));
});

import {previewSelectionSummary, previewRows, previewMeta} from '../src/link-first-dialog.mjs';

test('Remaining dynamic Link and Library messages are extracted and keep named replacements',()=>{
  const dialog=readFileSync(new URL('../src/link-first-dialog.mjs',import.meta.url),'utf8');
  const keys=["Untitled","About {size}","Size not available","{selected} of {total} selected","0 B selected","About {size} for {count} sized item","About {size} for {count} sized items","{size} for {count} sized item","{size} for {count} sized items","size unknown for {count} item","size unknown for {count} items","Please review your download options and try again.","A secure browser connection is required to start downloads.","Downloader is unavailable. Retry in a moment.","Source: {url}","Verified","Awaiting verification","{count} history entries hidden. Files were not deleted.","More actions for {name}","{count} downloads queued to retry.","Download skipped: a file already exists in Nextcloud Files. The existing file was kept."];
  for(const key of keys){
    assert.ok([dialog,library,labels].some(source=>source.includes("t('downloader_bridge', '"+key+"'")),key);
    assert.equal(typeof catalog.translations[key],'string',key);
    assert.deepEqual([...catalog.translations[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...key.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort());
  }
  const previous=globalThis.t;
  try{
    globalThis.t=(app,key,values={})=>{assert.equal(app,'downloader_bridge');return (catalog.translations[key]||key).replace(/\{(\w+)\}/g,(_,name)=>values[name]);};
    const rows=previewRows({entries:[{index:1,size_estimate_bytes:1024},{index:2}]});
    assert.equal(rows[0].title,catalog.translations.Untitled);
    assert.equal(previewMeta(rows[0]),'כ־1.0 KiB');
    assert.equal(previewSelectionSummary(rows,new Set([1,2])),'נבחרו 2 מתוך 2 · כ־1.0 KiB עבור פריט אחד (1) שגודלו ידוע · גודל לא ידוע עבור פריט אחד (1)');
  }finally{if(previous===undefined)delete globalThis.t;else globalThis.t=previous;}
  assert.equal(previewSelectionSummary([{index:1,size_bytes:1024}],new Set([1])),'1 of 1 selected · 1.0 KiB for 1 sized item');
});

test('Torrent segmented control mirrors movement in RTL; Library menu uses logical axes',()=>{
  assert.match(bridge,/inset-block:3px;inset-inline-start:3px/);
  assert.match(bridge,/data-view=flat\]:dir\(rtl\) \.dl-segmented-slider/);
  assert.match(bridge,/translateX\(calc\(-100% - 1px\)\)/);
  assert.match(bridge,/\.dl-torrent-expander:dir\(rtl\)/);
  assert.match(library,/inset-inline-end:0;inset-block-start:100%/);
});


test('All literal translation keys in Link, Library and shared native labels exist with matching placeholders',()=>{
  const dialog=readFileSync(new URL('../src/link-first-dialog.mjs',import.meta.url),'utf8');
  for(const [name,source] of Object.entries({dialog,library,labels,bridge})){
    for(const match of source.matchAll(/t\('downloader_bridge',\s*'((?:\\.|[^'\\])*)'/g)){
      const key=match[1].replace(/\\'/g,"'");
      assert.equal(typeof catalog.translations[key],'string',name+': '+key);
      assert.deepEqual([...catalog.translations[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...key.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),key);
    }
  }
  // Direct UI literal sinks; symbols, element/attribute names, data and internal
  // exceptions are not messages. Dynamic copy is checked separately above.
  for(const source of [dialog,library]){
    assert.doesNotMatch(source, /\b(?:e|el)\('[a-z0-9]+',\s*'[A-Za-z][^']*'/);
    assert.doesNotMatch(source, /\.(?:textContent|placeholder|title)\s*=\s*'[A-Za-z][^']*'/);
    assert.doesNotMatch(source, /setAttribute\('aria-label',\s*'[A-Za-z][^']*'/);
    assert.doesNotMatch(source, /\bnotify\('[A-Za-z][^']*'/);
  }
  const template=readFileSync(new URL('../templates/library.php',import.meta.url),'utf8');
  for(const key of ['My downloads','Loading your download history…','Downloads are not enabled for your account. Ask your Nextcloud administrator for access.']){
    assert.ok(template.includes("$l->t('"+key+"')"),key);
    assert.equal(typeof catalog.translations[key],'string',key);
  }
  assert.doesNotMatch(bridge,/gap:0;direction:ltr;/);
  assert.match(dialog,/dialog\.dir = /);
});

import {ALL_JOB_STATES} from '../src/job-states.generated.mjs';

test('Every current Core job state resolves a native catalog label',()=>{
  const previous=globalThis.t;
  try{
    globalThis.t=(app,key,replacements={})=>{
      assert.equal(app,'downloader_bridge');
      assert.equal(typeof catalog.translations[key],'string',key);
      return catalog.translations[key].replace(/\{(\w+)\}/g,(_,name)=>String(replacements[name]));
    };
    for(const state of ALL_JOB_STATES){
      const value=downloadStatus({id:'fixture',url:'https://example.org/file',status:state});
      assert.match(value,/[\u0590-\u05ff]/,state);
      assert.doesNotMatch(value,/undefined/);
    }
    assert.equal(downloadStatus({status:'new-state'}),'מצב לא ידוע: new-state');
  }finally{if(previous===undefined)delete globalThis.t;else globalThis.t=previous;}
});

test('Dashboard and native PHP headings use the shared catalog and logical menu placement',()=>{
  const dashboard=readFileSync(new URL('../src/dashboard.ts', import.meta.url),'utf8');
  for(const match of dashboard.matchAll(/t\('downloader_bridge',\s*'([^']+)'/g)){
    const key=match[1];
    assert.equal(typeof catalog.translations[key],'string',key);
    assert.deepEqual([...catalog.translations[key].matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),[...key.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort(),key);
  }
  for(const pattern of [/\belem\('[a-z0-9]+',\s*'[A-Za-z][^']*'/,/\.(?:textContent|title)\s*=\s*'[A-Za-z][^']*'/,/setAttribute\('aria-label',\s*'[A-Za-z][^']*'/,/\bitem\('[A-Za-z][^']*'/])assert.doesNotMatch(dashboard,pattern);
  assert.match(dashboard,/inset-inline-end:0;inset-block-start:100%/);
  const widget=readFileSync(new URL('../lib/Dashboard/DownloadsWidget.php', import.meta.url),'utf8');
  const provider=readFileSync(new URL('../lib/Search/DownloadsProvider.php', import.meta.url),'utf8');
  assert.match(widget,/return \$this->l10n->t\('My downloads'\)/);
  assert.ok(widget.indexOf('Util::addTranslations')<widget.indexOf('Util::addScript'));
  assert.match(provider,/return \$this->l10n->t\('Downloads'\)/);
  assert.doesNotMatch(provider,/SearchResult::complete\('Downloads'/);
  for(const php of [widget,provider])for(const match of php.matchAll(/->t\('([^']+)'/g))assert.equal(typeof catalog.translations[match[1]],'string',match[1]);
});
