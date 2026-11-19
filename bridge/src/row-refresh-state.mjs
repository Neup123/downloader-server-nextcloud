/** Preserve row-local keyboard interaction across live list refreshes. */
export function captureRowState(list, rowSelector, menuSelector) {
  const rows=[...list.querySelectorAll(rowSelector)];
  const openIds=new Set(menuSelector
    ? rows.filter(row=>row.querySelector(menuSelector)?.open)
      .map(row=>row.dataset.jobId)
    : []);
  const active=document.activeElement;
  const focused=active?.closest?.(rowSelector);
  return {
    scroll:list.scrollTop,
    openIds,
    focusId:focused && list.contains(focused) ? focused.dataset.jobId : null,
    focusTag:active?.tagName || null,
    focusLabel:active?.getAttribute?.('aria-label') || active?.textContent?.trim() || '',
  };
}

export function restoreRowState(list, state, rowSelector, menuSelector, fallback) {
  const rows=[...list.querySelectorAll(rowSelector)];
  if(menuSelector){
    for(const row of rows){
      if(!state.openIds.has(row.dataset.jobId))continue;
      const menu=row.querySelector(menuSelector);
      if(menu)menu.open=true;
    }
  }
  list.scrollTop=state.scroll;
  if(!state.focusId)return;
  const row=rows.find(item=>item.dataset.jobId===state.focusId);
  if(!row){
    // The focused job disappeared: give focus to a stable control instead
    // of leaving keyboard navigation stranded on the document body.
    fallback?.focus({preventScroll:true});
    return;
  }
  const actions=[...row.querySelectorAll('button,a,summary')];
  const exact=actions.find(action=>action.tagName===state.focusTag &&
    (action.getAttribute('aria-label')||action.textContent?.trim()||'')===state.focusLabel);
  const candidate=exact||actions.find(action=>action.tagName===state.focusTag)||
    actions[0];
  candidate?.focus({preventScroll:true});
}
