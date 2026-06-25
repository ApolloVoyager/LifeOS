// =============================================================
// Shared cloud-sync helper. Each page calls initCloudSync({...}).
// Uses the shared authenticated client created by auth.js
// (window.LifeOS.supa) so every read/write carries the logged-in
// user's JWT and is scoped to their rows via Row Level Security.
// Load order on each page:
//   supabase-js CDN -> auth.js -> sync.js
// =============================================================
(function () {
  'use strict';

  window.initCloudSync = function (config) {
    const appKey = config && config.appKey;
    const syncedKeys = (config && config.syncedKeys) || [];
    const syncedPrefixes = (config && config.syncedPrefixes) || [];
    const onApplied = config && config.onApplied;
    if (!appKey || !window.LifeOS || !window.LifeOS.supa) return;

    const supa = window.LifeOS.supa;
    const SUPABASE_URL = window.LifeOS.SUPABASE_URL;
    const SUPABASE_KEY = window.LifeOS.SUPABASE_KEY;

    let uid = null, pushTimer = null, suppressSync = false, lastSyncedJson = null;

    // True while auth.js is tearing down the session (sign-out / account
    // switch). Pushing during that window would upload an emptied state.
    function syncSuspended() { return !!(window.LifeOS && window.LifeOS.syncSuspended); }

    function matches(k) {
      if (!k) return false;
      if (syncedKeys.indexOf(k) !== -1) return true;
      for (let i = 0; i < syncedPrefixes.length; i++) {
        if (k.indexOf(syncedPrefixes[i]) === 0) return true;
      }
      return false;
    }
    function listAllKeys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (matches(k)) out.push(k);
      }
      return out;
    }
    function collect() {
      const out = {};
      for (const k of listAllKeys()) {
        const v = localStorage.getItem(k);
        if (v == null) continue;
        try { out[k] = JSON.parse(v); } catch (e) { out[k] = v; }
      }
      return out;
    }
    const origSet = localStorage.setItem.bind(localStorage);
    const origRemove = localStorage.removeItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      origSet(k, v);
      try { if (!suppressSync && matches(k)) schedulePush(); } catch (e) {}
    };
    localStorage.removeItem = function (k) {
      origRemove(k);
      try { if (!suppressSync && matches(k)) schedulePush(); } catch (e) {}
    };
    function applyRemote(remote) {
      if (!remote || typeof remote !== 'object') return false;
      suppressSync = true;
      let changed = false;
      try {
        for (const k of Object.keys(remote)) {
          if (!matches(k)) continue;
          const incoming = JSON.stringify(remote[k]);
          const local = localStorage.getItem(k);
          if (local !== incoming) { try { origSet(k, incoming); changed = true; } catch (e) {} }
        }
        for (const k of listAllKeys()) {
          if (!(k in remote)) { try { origRemove(k); changed = true; } catch (e) {} }
        }
      } finally { suppressSync = false; }
      if (changed && typeof onApplied === 'function') { try { onApplied(); } catch (e) {} }
      return changed;
    }
    async function pushNow() {
      if (!uid || syncSuspended()) return;
      const state = collect();
      // Never overwrite the cloud with an empty snapshot. An empty collect()
      // means our app data was purged (sign-out / account switch) or never
      // loaded — uploading it would wipe this user's cloud copy. A real user
      // with data always has at least one matching key.
      if (Object.keys(state).length === 0) return;
      const json = JSON.stringify(state);
      if (json === lastSyncedJson) return;
      try {
        const { error } = await supa.from('app_state').upsert(
          { user_id: uid, key: appKey, data: state, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,key' }
        );
        if (!error) lastSyncedJson = json;
      } catch (e) {}
    }
    function schedulePush() { if (syncSuspended()) return; clearTimeout(pushTimer); pushTimer = setTimeout(pushNow, 250); }
    function flushOnUnload() {
      if (!uid || syncSuspended()) return;
      const state = collect();
      if (Object.keys(state).length === 0) return;   // never beacon an empty wipe
      const json = JSON.stringify(state);
      if (json === lastSyncedJson) return;
      // Best-effort beacon using the current access token so RLS allows it.
      const token = (window.LifeOS.session && window.LifeOS.session.access_token) || SUPABASE_KEY;
      try {
        fetch(SUPABASE_URL + '/rest/v1/app_state?on_conflict=user_id,key', {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify({ user_id: uid, key: appKey, data: state, updated_at: new Date().toISOString() }),
          keepalive: true,
        }).catch(() => {});
        lastSyncedJson = json;
      } catch (e) {}
    }
    async function pullNow() {
      if (!uid) return;
      try {
        const { data, error } = await supa
          .from('app_state').select('data').eq('user_id', uid).eq('key', appKey).maybeSingle();
        if (!error && data && data.data && Object.keys(data.data).length > 0) {
          const incoming = JSON.stringify(data.data);
          if (incoming !== lastSyncedJson) { lastSyncedJson = incoming; applyRemote(data.data); }
        }
      } catch (e) {}
    }
    (async function init() {
      const user = await window.LifeOS.ready;   // waits until authed + approved
      uid = user.id;
      await pullNow();
      // Cloud had nothing yet but we have local data -> seed it up.
      if (lastSyncedJson == null && Object.keys(collect()).length > 0) schedulePush();
      supa.channel('app_state_' + appKey)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'app_state', filter: 'key=eq.' + appKey,
        }, (payload) => {
          if (!payload.new || !payload.new.data) return;
          if (payload.new.user_id && payload.new.user_id !== uid) return;
          const incoming = JSON.stringify(payload.new.data);
          if (incoming === lastSyncedJson) return;
          lastSyncedJson = incoming;
          applyRemote(payload.new.data);
        })
        .subscribe();
      // Safety net: the localStorage.setItem patch above does NOT take effect
      // in Firefox (Storage rejects method overrides), so change-driven pushes
      // never fire there. Poll instead — pushNow() self-dedupes via
      // lastSyncedJson and the empty-state guard, so it only writes on change.
      setInterval(pushNow, 1500);
    })();
    window.addEventListener('beforeunload', flushOnUnload);
    window.addEventListener('pagehide', flushOnUnload);
    window.addEventListener('storage', (e) => { if (e.key && matches(e.key)) schedulePush(); });
    // Pull the latest when the tab regains focus so a device shows changes made
    // elsewhere without a manual refresh (works even if realtime is disabled).
    window.addEventListener('focus', pullNow);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pullNow(); });
  };
})();
