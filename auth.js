// =============================================================
// Shared Supabase client + auth gate for LifeOS.
// Load this on EVERY page, right after the supabase-js CDN tag
// and BEFORE sync.js / topbar.js / any inline sync:
//     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//     <script src="auth.js"></script>
//
// Responsibilities:
//   * Create the single shared client (window.LifeOS.supa) used by
//     sync.js, topbar.js, and gym.html — so every query carries the
//     logged-in user's JWT and Row Level Security applies.
//   * Gate the page: unauthenticated -> login.html; signed in but not
//     approved -> login.html?pending=1; approved -> reveal page.
//   * Keep the session alive indefinitely (persisted + auto-refresh).
//   * Expose window.LifeOS.user, window.LifeOS.ready (Promise), and
//     window.LifeOS.signOut().
// =============================================================
(function () {
  'use strict';

  const SUPABASE_URL = 'https://zwpfcdtplemvrmegkvco.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_r2ner9o8MWgFZbjmgd_oDg_-Qo9h0_q';

  // -----------------------------------------------------------------
  // Multi-account safety. The app caches data in localStorage; on a
  // SHARED browser one account must never see another's cached data.
  // We tag localStorage with the user id it belongs to and wipe all
  // app data the moment the signed-in user no longer matches it.
  // This runs synchronously, before any page render or sync reads
  // localStorage, and uses only localStorage (no Supabase needed).
  // -----------------------------------------------------------------
  function lifeosReadSessionUserId() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf('sb-') !== 0 || k.indexOf('-auth-token') === -1) continue;
        let obj = null;
        try { obj = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { continue; }
        if (!obj) continue;
        const id =
          (obj.user && obj.user.id) ||
          (obj.currentSession && obj.currentSession.user && obj.currentSession.user.id) ||
          (obj.session && obj.session.user && obj.session.user.id);
        if (id) return id;
      }
    } catch (e) {}
    return null;
  }
  function lifeosPurgeAppData() {
    try {
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        if (k.indexOf('sb-') === 0) continue;   // keep Supabase auth session
        if (k === 'lifeos_uid') continue;        // keep our ownership tag
        drop.push(k);
      }
      drop.forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
    } catch (e) {}
  }
  // Only purge when we POSITIVELY identify a different signed-in user.
  // We never purge just because the token couldn't be read — that could
  // wipe unsynced local edits. Genuine sign-out is handled by signOut()
  // and the SIGNED_OUT auth event below.
  (function lifeosGuardLocalData() {
    const sessUid = lifeosReadSessionUserId();
    const lastUid = localStorage.getItem('lifeos_uid');
    if (sessUid && sessUid !== lastUid) {
      lifeosPurgeAppData();
      try { localStorage.setItem('lifeos_uid', sessUid); } catch (e) {}
    }
  })();

  function isLoginPage() {
    const p = (window.location.pathname || '').toLowerCase();
    return p.endsWith('/login.html') || p.endsWith('login.html');
  }
  function isEmbedded() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }

  // Hide the page until auth resolves (avoids a flash of private data
  // before a redirect). Skipped on the login page and inside iframes.
  function installVeil() {
    if (isLoginPage() || isEmbedded()) return;
    const style = document.createElement('style');
    style.id = 'lifeos-auth-veil';
    style.textContent =
      'html.lifeos-gating body{visibility:hidden!important}' +
      'html.lifeos-gating{background:#0a0a0b!important}';
    (document.head || document.documentElement).appendChild(style);
    document.documentElement.classList.add('lifeos-gating');
  }
  function revealPage() {
    document.documentElement.classList.remove('lifeos-gating');
  }
  function redirectToLogin(extra) {
    const here = window.location.pathname + window.location.search + window.location.hash;
    const q = 'next=' + encodeURIComponent(here) + (extra ? '&' + extra : '');
    window.location.replace('login.html?' + q);
  }

  installVeil();

  let resolveReady;
  const ready = new Promise((res) => { resolveReady = res; });

  const supa = (window.supabase && SUPABASE_URL && SUPABASE_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    : null;

  window.LifeOS = {
    SUPABASE_URL: SUPABASE_URL,
    SUPABASE_KEY: SUPABASE_KEY,
    supa: supa,
    user: null,
    session: null,
    // When true, sync.js / gym.html must not push to the cloud. Set during
    // signOut() so tearing down the session can't upload an emptied state.
    syncSuspended: false,
    ready: ready,           // resolves with the user once authed + approved
    async accessToken() {
      try {
        const { data } = await supa.auth.getSession();
        return data && data.session ? data.session.access_token : null;
      } catch (e) { return null; }
    },
    async signOut() {
      // Suspend cloud sync FIRST. Signing out + purging below empties the
      // app data in localStorage, and the navigation that follows fires the
      // unload flush. Without this flag those paths would push an empty
      // snapshot to the OUTGOING user's cloud row (their access token is
      // still in memory) and wipe it. Read by sync.js / gym.html before
      // every push. Naturally resets on the next page load.
      window.LifeOS.syncSuspended = true;
      try { if (supa) await supa.auth.signOut(); } catch (e) {}
      lifeosPurgeAppData();
      try { localStorage.removeItem('lifeos_uid'); } catch (e) {}
      window.location.replace('login.html');
    },
  };

  async function isApproved() {
    try {
      const { data, error } = await supa
        .from('profiles').select('approved').eq('id', window.LifeOS.user.id).maybeSingle();
      if (error) return false;
      return !!(data && data.approved);
    } catch (e) { return false; }
  }

  (async function gate() {
    // The login page manages its own state; just expose the client.
    if (isLoginPage()) { revealPage(); return; }

    if (!supa) { revealPage(); return; } // supabase-js missing: fail open, do nothing

    let session = null;
    try {
      const { data } = await supa.auth.getSession();
      session = data ? data.session : null;
    } catch (e) {}

    // Inside an iframe (e.g. the water tracker embedded in health.html) the
    // parent page already enforced auth — never redirect here, just wire up
    // the client/ready if a session exists.
    const embedded = isEmbedded();

    if (!session) { if (!embedded) redirectToLogin(); return; }

    window.LifeOS.session = session;
    window.LifeOS.user = session.user;

    if (!(await isApproved())) { if (!embedded) redirectToLogin('pending=1'); return; }

    // Authoritative backstop (real session, not the sync parse): if cached
    // data belongs to a different user, purge it before sync reads it. If no
    // tag exists yet, just adopt it without purging (preserve unsynced data).
    try {
      const stored = localStorage.getItem('lifeos_uid');
      if (stored && stored !== window.LifeOS.user.id) lifeosPurgeAppData();
      localStorage.setItem('lifeos_uid', window.LifeOS.user.id);
    } catch (e) {}

    revealPage();
    resolveReady(window.LifeOS.user);
  })();

  // React to sign-out / token changes (e.g. another tab logs out).
  if (supa) {
    supa.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' && !isLoginPage()) {
        window.location.replace('login.html');
      } else if (session) {
        window.LifeOS.session = session;
        window.LifeOS.user = session.user;
      }
    });
  }
})();
