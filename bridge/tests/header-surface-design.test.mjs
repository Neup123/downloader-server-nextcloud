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

  // Pin the owner's exact REVISED glyph; its geometry cannot change in a styling round.
  const glyph=bridge.match(/arrow\.setAttribute\('d', '([^']+)'\)/)?.[1];
  assert.equal(glyph,'M22 13.5v12m0 0-5-5m5 5 5-5M14 27.5v3h16v-3');
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
  assert.match(bridge,/stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;opacity:\.76/);
  assert.match(bridge,/\.dl-trigger:is\(:hover,:focus,:focus-visible\)/);
  assert.match(bridge,/\.dl-trigger:is\(:active,\[aria-expanded=true\]\)/);
  assert.match(bridge,/background:color-mix\(in srgb,var\(--color-primary-text,#fff\) 16%,transparent\)!important/);
  assert.doesNotMatch(bridge,/\.dl-trigger\[aria-expanded=true\]\{background:(?:#fff|white)/i);

  // A restrained corner badge, rather than the previous 16px-plus white circle.
  assert.match(bridge,/min-width:13px;height:13px;border-radius:9px/);
  assert.match(bridge,/border:0;font-size:9px;font-weight:700;line-height:13px/);
  assert.doesNotMatch(bridge,/min-width:16px;height:16px/);
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

  // The avatar-menu look is opaque, light and text-dark, never bell-style glass.
  assert.match(bridge,/background:var\(--color-main-background,#fff\)!important/);
  assert.match(bridge,/color:var\(--color-main-text,#222\)!important/);
  assert.match(bridge,/opacity:1!important;backdrop-filter:none!important/);
  assert.match(bridge,/box-shadow:var\(--shadow-header,0 8px 30px #0003\)/);
  assert.match(bridge,/\.dl-job:hover\{background:var\(--color-background-hover,#f1f1f1\)/);
  assert.match(bridge,/\.dl-history-link:hover\{background:var\(--color-background-hover,#f1f1f1\)/);

  // The add control has a fine circular ring with themed hover and active states.
  assert.match(bridge,/\.dl-popover-add\{display:grid;place-items:center/);
  assert.match(bridge,/width:28px;height:28px;min-width:28px/);
  assert.match(bridge,/border:1px solid var\(--color-border,#ddd\)!important/);
  assert.match(bridge,/background:transparent!important;border-radius:50%!important/);
  assert.match(bridge,/\.dl-popover-add:hover/);
  assert.match(bridge,/\.dl-popover-add:active/);
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
