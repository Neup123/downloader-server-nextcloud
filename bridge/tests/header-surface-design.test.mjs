import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const bridge=readFileSync(new URL('../src/bridge.ts',import.meta.url),'utf8');
const dashboard=readFileSync(new URL('../src/dashboard.ts',import.meta.url),'utf8');
const library=readFileSync(new URL('../src/library.ts',import.meta.url),'utf8');

test('header is a ghost arrow with an aggregate border-only frame and count badge',()=>{
  for(const token of ['dl-indicator-svg','dl-arrow','dl-frame-progress',
    'dl-count','strokeDashoffset','jobProgress','running.reduce','header_indicator_visibility',
    "button.hidden=!show","panel.hidden=true"]) assert.ok(bridge.includes(token),token);
  assert.doesNotMatch(bridge,/button\.textContent\s*=\s*running\.length/);
  assert.doesNotMatch(bridge,/bubble\.value\s*=/);
  assert.match(bridge,/flex:0 0 44px/);
  assert.doesNotMatch(bridge,/dl-frame-track/);
  assert.match(bridge,/bellSlot\.parentElement\.insertBefore\(container,bellSlot\)/);
  assert.match(bridge,/color:var\(--color-primary-text,#fff\)!important/);
  assert.match(bridge,/downloadBubbleStatus\(job\)/);

  // The download arrow and tray must be one SVG path.
  const glyph=bridge.match(/arrow\.setAttribute\('d', '([^']+)'\)/)?.[1];
  assert.ok(glyph,'download glyph path exists');
  const tray=glyph.match(/M14 ([\d.]+)v([\d.]+)h16v-\2$/);
  assert.ok(tray,'tray is part of the arrow path');
  const arrowTop=glyph.match(/^M22 ([\d.]+)v12/);
  assert.ok(arrowTop,'download arrow is present');

  // The complete glyph must be centred vertically in the 44px viewBox.
  assert.match(bridge,/svg\.setAttribute\('viewBox', '0 0 44 44'\)/);
  assert.equal(
    (Number(arrowTop[1])+Number(tray[1])+Number(tray[2]))/2,
    22,
    'download glyph is vertically centred'
  );
  assert.match(bridge,/\.dl-arrow\{stroke-width:3\}/);
});
test('header bubble opens normal Files dialog and follows active/all user settings',()=>{
  assert.match(bridge,/void openDialog\(null\)/);
  assert.match(bridge,/dl-popover-head/);
  assert.match(bridge,/dl-popover-add/);
  assert.match(bridge,/dropdown_content==='all'/);
  assert.match(bridge,/state=active/);
  assert.match(bridge,/finishTimestamp\(b\)-finishTimestamp\(a\)/);
  assert.match(bridge,/dl-job-pct/);
  assert.match(bridge,/--dl-row-fill/);
  assert.match(bridge,/downloadSymbol\(job\)/);
  assert.match(bridge,/\/core\/preview/);
  assert.match(bridge,/for\(const job of jobs\)/);
});
test('bubble pause and resume use each Core job capability and an accurate reason',()=>{
  assert.match(bridge,/pause_capability\?: \{can_pause\?:boolean;can_resume\?:boolean;reason\?:string\|null\}/);
  assert.match(bridge,/job\.status==='paused'\?'▶':'Ⅱ'/);
  assert.match(bridge,/job\.pause_capability\?\.can_resume/);
  assert.match(bridge,/job\.pause_capability\?\.can_pause/);
  assert.match(bridge,/job\.pause_capability\?\.reason/);
  assert.match(bridge,/operation,'POST'/);
  assert.match(bridge,/void refresh\(\)/);
  assert.doesNotMatch(bridge,/download service does not support suspension/);
});
test('Dashboard and Library have compact default rows and edge-only vertical menus',()=>{
  assert.match(dashboard,/padding:2px 0/);
  assert.match(dashboard,/font-weight:800/);
  assert.match(dashboard,/summary', '⋮'/);
  assert.match(library,/padding:2px 0/);
  assert.match(library,/font-weight:800/);
  assert.match(library,/library-overflow-list/);
  assert.match(library,/el\('summary','⋮'\)/);
  assert.doesNotMatch(library,/control\('⋯'/);
});


test('header bubble and Library overflow respect inherited Hebrew/RTL layout',()=>{
  assert.doesNotMatch(bridge,/\.dl-job\{position:relative;direction:ltr/);
  assert.match(bridge,/\.dl-popover\{position:absolute;top:100%;inset-inline-end:0/);
  assert.match(library,/library-overflow-list\{position:absolute;inset-inline-end:0/);
});


test('header uses signed user preferences and does not use browser-global storage',()=>{
  assert.match(bridge,/api<DisplayPrefs>\('\/settings'\)/);
  assert.match(bridge,/saved\.header_indicator_visibility==='always'/);
  assert.match(bridge,/saved\.dropdown_content==='all'/);
  assert.doesNotMatch(bridge,/localStorage|sessionStorage/);
  assert.match(bridge,/\.dl-job\{position:relative;display:grid;grid-template-columns:24px/);
  assert.match(library,/\.library-title\{width:100%;min-width:0;min-height:0/);
});
