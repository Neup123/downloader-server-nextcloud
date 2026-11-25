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
