/** Reconcile a failed settings save against a fresh server GET, never a guess. */
const OWN = Object.prototype.hasOwnProperty;
import {CONTENT_ROUTES} from './content-routes.mjs';
const SUBFOLDERS = Object.fromEntries(CONTENT_ROUTES.map(route=>[route.id,route.subfolder]));
const canonical = value => {
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value === 'object')
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
};
const same = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Returns per-field actual outcomes and only the part still unapplied. */
export function reconcileSettingsPatch(patch,saved){
  const applied=[], pending=[], unverified=[], remaining={};
  for(const [key,wanted] of Object.entries(patch)){
    if(key==='destination_routes' && wanted && typeof wanted==='object' && !Array.isArray(wanted)){
      const missingRoutes={};
      const overrides=saved.destination_route_overrides||{};
      for(const [kind,path] of Object.entries(wanted)){
        const actual=OWN.call(overrides,kind)?overrides[kind]:null;
        if(actual===path)applied.push('destination_routes.'+kind);
        else{pending.push('destination_routes.'+kind);missingRoutes[kind]=path;}
      }
      if(Object.keys(missingRoutes).length)remaining[key]=missingRoutes;
    }else if(key==='app_password'){
      // The API never returns a password. A configured=true response is not
      // evidence that the *new* password (rather than an old one) was saved.
      if(!wanted && !saved.app_password_configured)applied.push(key);
      else if(wanted && saved.app_password_configured)unverified.push(key);
      else{pending.push(key);remaining[key]=wanted;}
    }else if(same(saved[key],wanted)){
      applied.push(key);
    }else{
      pending.push(key);remaining[key]=wanted;
    }
  }
  return {applied,pending,unverified,remaining};
}

/** Preserve edits made during an in-flight save; merge route changes by kind. */
export function mergePendingPatches(earlier,later){
  const merged={...earlier,...later};
  if(earlier.destination_routes && later.destination_routes){
    merged.destination_routes={...earlier.destination_routes,...later.destination_routes};
  }
  return merged;
}

/** Rebuild the form from verified server state, with still-unsaved edits visible. */
export function overlayPendingSettings(saved,pending){
  const result={...saved,...pending};
  const overrides={...(saved.destination_route_overrides||{})};
  for(const [kind,path] of Object.entries(pending.destination_routes||{})){
    if(path===null)delete overrides[kind];
    else overrides[kind]=path;
  }
  const routes={...saved.destination_routes};
  for(const [kind,suffix] of Object.entries(SUBFOLDERS)){
    routes[kind]=OWN.call(overrides,kind)
      ? overrides[kind] : [result.destination_folder,suffix].filter(Boolean).join('/');
  }
  result.destination_route_overrides=overrides;
  result.destination_routes=routes;
  return result;
}
