(function () {
    'use strict';

    if (typeof SUPABASE_CONFIG === 'undefined' || !window.supabase) {
        console.error('Supabase ist nicht geladen oder nicht konfiguriert.');
        return;
    }

    const client = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    const state = {
        user: null,
        profile: null,
        loadedUpdatedAt: null,
        readyResolved: false
    };

    function injectStyles() {
        const css = `
        .auth-overlay{position:fixed;inset:0;z-index:9000;display:none;align-items:center;justify-content:center;
            background:linear-gradient(135deg,#3e0d81,#4d49bc);font-family:'Montserrat',sans-serif;padding:20px;}
        .auth-overlay.active{display:flex;}
        .auth-card{background:#fff;border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.35);width:100%;max-width:400px;padding:28px;}
        .auth-card h2{margin:0 0 4px;color:#3e0d81;font-size:1.4rem;}
        .auth-card p.sub{margin:0 0 18px;color:#666;font-size:.9rem;}
        .auth-tabs{display:flex;gap:6px;margin-bottom:18px;}
        .auth-tabs button{flex:1;padding:9px;border:none;border-radius:8px;background:#eee;color:#555;font-weight:600;cursor:pointer;}
        .auth-tabs button.active{background:#4d49bc;color:#fff;}
        .auth-form label{display:block;font-size:.82rem;color:#444;margin:10px 0 4px;font-weight:600;}
        .auth-form input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #ccc;border-radius:8px;font-size:.95rem;}
        .auth-form input:focus{outline:none;border-color:#4d49bc;}
        .auth-btn{width:100%;margin-top:18px;padding:11px;border:none;border-radius:8px;background:#4d49bc;color:#fff;
            font-weight:700;font-size:.98rem;cursor:pointer;}
        .auth-btn:disabled{opacity:.6;cursor:default;}
        .auth-link{background:none;border:none;color:#4d49bc;cursor:pointer;font-size:.82rem;margin-top:12px;padding:0;text-decoration:underline;}
        .auth-msg{margin-top:14px;padding:10px 12px;border-radius:8px;font-size:.85rem;display:none;}
        .auth-msg.show{display:block;}
        .auth-msg.error{background:#fdecea;color:#b3261e;}
        .auth-msg.info{background:#e8f0fe;color:#1a56b3;}
        .auth-msg.success{background:#e6f4ea;color:#1e7e34;}

        .account-widget{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.35);
            border-radius:20px;padding:4px 6px 4px 12px;font-size:.8rem;color:#fff;white-space:nowrap;}
        .account-widget .acc-email{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;}
        .acc-badge{background:#f9d057;color:#3e0d81;border-radius:10px;padding:1px 8px;font-weight:700;font-size:.72rem;white-space:nowrap;}
        .acc-badge.warn{background:#ff997f;color:#3e0d81;}
        .acc-badge.admin{background:#2ecc71;color:#08341c;}
        .account-widget button{background:none;border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:12px;
            padding:3px 10px;font-size:.75rem;font-weight:600;cursor:pointer;}
        .account-widget button:hover{background:rgba(255,255,255,.25);}
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function buildDom() {
        const overlay = document.createElement('div');
        overlay.className = 'auth-overlay';
        overlay.id = 'authOverlay';
        overlay.innerHTML = `
            <div class="auth-card">
                <h2>Referenzeditor | ICT</h2>
                <p class="sub" id="authSub">Bitte anmelden, um auf die gemeinsame Referenzliste in der Datenbank zuzugreifen.</p>
                <div class="auth-tabs">
                    <button type="button" id="tabLogin" class="active">Anmelden</button>
                    <button type="button" id="tabRegister">Kostenlos registrieren</button>
                </div>
                <form class="auth-form" id="authForm">
                    <label for="authEmail">E-Mail</label>
                    <input type="email" id="authEmail" autocomplete="email" required>
                    <label for="authPassword">Passwort</label>
                    <input type="password" id="authPassword" autocomplete="current-password" minlength="6" required>
                    <button type="submit" class="auth-btn" id="authSubmit">Anmelden</button>
                </form>
                <button type="button" class="auth-link" id="authForgot">Passwort vergessen?</button>
                <div class="auth-msg" id="authMsg"></div>
            </div>`;
        document.body.appendChild(overlay);

        const host = document.getElementById('accountWidget') || document.querySelector('header.bar');
        if (host) {
            host.innerHTML = '<span class="acc-email" id="accEmail"></span><span class="acc-badge" id="accBadge"></span><button type="button" id="accLogout">Abmelden</button>';
        }
    }

    const $ = (id) => document.getElementById(id);

    function showMsg(kind, text) {
        const el = $('authMsg');
        el.className = 'auth-msg show ' + kind;
        el.textContent = text;
    }
    function clearMsg() {
        const el = $('authMsg');
        el.className = 'auth-msg';
        el.textContent = '';
    }

    let authMode = 'login';
    function setMode(mode) {
        authMode = mode;
        $('tabLogin').classList.toggle('active', mode === 'login');
        $('tabRegister').classList.toggle('active', mode === 'register');
        $('authSubmit').textContent = mode === 'login' ? 'Anmelden' : 'Kostenlos registrieren';
        $('authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
        clearMsg();
    }

    function daysLeft(profile) {
        if (!profile || !profile.access_expires_at) return null;
        const ms = new Date(profile.access_expires_at).getTime() - Date.now();
        return Math.ceil(ms / (1000 * 60 * 60 * 24));
    }

    function isActive(profile) {
        if (!profile) return false;
        if (profile.blocked) return false;
        if (profile.role === 'admin') return true;
        return new Date(profile.access_expires_at).getTime() > Date.now();
    }

    function isIctEmail(s) {
        return /^[^\s@]+@ict\.de$/i.test(String(s || '').trim());
    }

    function isValidEmail(s) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
    }

    function dbErr(error) {
        const m = (error && error.message) || String(error);
        if (/relation .* does not exist|does not exist/i.test(m)) {
            return m + '\n\nDatenbank nicht eingerichtet: supabase/referenz_setup.sql im Supabase SQL Editor ausführen.';
        }
        return m;
    }

    async function loadProfile() {
        if (!state.user) return null;
        const { data, error } = await client
            .from('profiles')
            .select('id,email,role,blocked,access_expires_at')
            .eq('id', state.user.id)
            .maybeSingle();
        if (error) { console.warn('Profil konnte nicht geladen werden:', error.message); return null; }
        state.profile = data;
        return data;
    }

    function showOverlay(subText) {
        const w = $('accountWidget');
        if (w) w.style.display = 'none';
        const ov = $('authOverlay');
        ov.classList.add('active');
        if (subText) $('authSub').textContent = subText;
    }
    function hideOverlay() {
        $('authOverlay').classList.remove('active');
        const w = $('accountWidget');
        if (w) w.style.display = 'flex';
    }

    async function refreshGate() {
        const { data: { session } } = await client.auth.getSession();
        state.user = session ? session.user : null;

        if (!state.user) {
            state.profile = null;
            showOverlay('Bitte anmelden, um auf die gemeinsame Referenzliste in der Datenbank zuzugreifen.');
            finishReady(false);
            return;
        }
        await loadProfile();

        const admin = state.profile && state.profile.role === 'admin';
        if (!admin && !isIctEmail(state.user.email)) {
            state.profile = null;
        }
        if (!isActive(state.profile)) {
            let reason = 'Dein Zugang ist nicht aktiv.';
            if (!admin && !isIctEmail(state.user.email)) reason = 'Der Referenzgenerator ist nur für E-Mail-Adressen @ict.de freigegeben.';
            else if (state.profile && state.profile.blocked) reason = 'Dein Konto wurde gesperrt. Bitte wende dich an den Administrator.';
            else if (state.profile) reason = 'Dein Zugang ist abgelaufen. Bitte wende dich an den Administrator, um ihn zu verlängern.';
            showOverlay(reason);
            showMsg('error', reason);
            $('authForm').style.display = 'none';
            $('authForgot').style.display = 'none';
            document.querySelector('.auth-tabs').style.display = 'none';
            const card = $('authOverlay').querySelector('.auth-card');
            if (!$('gateLogout')) {
                const b = document.createElement('button');
                b.id = 'gateLogout'; b.className = 'auth-btn'; b.textContent = 'Abmelden';
                b.onclick = () => client.auth.signOut();
                card.appendChild(b);
            }
            finishReady(false);
            return;
        }

        hideOverlay();
        renderAccount();
        window.dispatchEvent(new CustomEvent('cloud-auth-ready', { detail: { admin: state.profile && state.profile.role === 'admin' } }));
        finishReady(true);
    }

    function finishReady(active) {
        if (state.readyResolved) return;
        state.readyResolved = true;
        readyResolve(active);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        clearMsg();
        const email = $('authEmail').value.trim();
        const password = $('authPassword').value;
        if (!isValidEmail(email)) { showMsg('error', 'Bitte eine gültige E-Mail-Adresse eingeben.'); return; }
        if (authMode === 'register' && !isIctEmail(email)) { showMsg('error', 'Die Registrierung ist nur mit einer E-Mail-Adresse @ict.de möglich.'); return; }
        $('authSubmit').disabled = true;
        try {
            if (authMode === 'register') {
                const { error } = await client.auth.signUp({
                    email, password,
                    options: { emailRedirectTo: window.location.origin + window.location.pathname }
                });
                if (error) throw error;
                showMsg('success', 'Fast geschafft! Wir haben dir eine Bestätigungs-Mail geschickt. Bitte bestätige deine E-Mail-Adresse und melde dich anschließend an.');
                setMode('login');
            } else {
                const { error } = await client.auth.signInWithPassword({ email, password });
                if (error) throw error;
            }
        } catch (err) {
            let m = err.message || String(err);
            if (/email not confirmed/i.test(m)) m = 'Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Bestätigungs-Mail).';
            else if (/invalid login credentials/i.test(m)) m = 'E-Mail oder Passwort ist falsch.';
            else if (/already registered/i.test(m)) m = 'Diese E-Mail ist bereits registriert. Bitte melde dich an.';
            showMsg('error', m);
        } finally {
            $('authSubmit').disabled = false;
        }
    }

    async function handleForgot() {
        const email = $('authEmail').value.trim();
        if (!email) { showMsg('info', 'Bitte zuerst deine E-Mail-Adresse eingeben, dann auf „Passwort vergessen?" klicken.'); return; }
        const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + window.location.pathname
        });
        if (error) showMsg('error', error.message);
        else showMsg('success', 'Falls die Adresse existiert, wurde eine E-Mail zum Zurücksetzen des Passworts verschickt.');
    }

    function renderAccount() {
        const w = $('accountWidget');
        if (!w) return;
        w.style.display = 'flex';
        $('accEmail').textContent = state.profile ? state.profile.email : state.user.email;
        const badge = $('accBadge');
        const admin = state.profile && state.profile.role === 'admin';
        if (admin) {
            badge.textContent = 'Admin'; badge.className = 'acc-badge admin';
        } else {
            const d = daysLeft(state.profile);
            badge.textContent = d != null ? d + ' Tage' : '';
            badge.className = 'acc-badge' + (d != null && d <= 5 && d >= 0 ? ' warn' : '');
        }
        $('accLogout').onclick = () => client.auth.signOut();
    }

    async function requireActive() {
        if (!state.user || !isActive(state.profile)) {
            return { error: 'Bitte zuerst anmelden, um auf die Datenbank zuzugreifen.' };
        }
        return null;
    }

    async function list() {
        const gate = await requireActive();
        if (gate) return gate;
        try {
            const { data, error } = await client
                .from('reference_projects')
                .select('id,nr,kunde,veranstaltung,art,title,created_by,created_by_email,updated_by_email,created_at,updated_at')
                .is('deleted_at', null)
                .order('updated_at', { ascending: false });
            if (error) throw error;
            const uid = state.user && state.user.id;
            return { data: (data || []).map(r => Object.assign({}, r, { owner: r.created_by === uid })) };
        } catch (err) {
            return { error: dbErr(err) };
        }
    }

    async function load(id) {
        const gate = await requireActive();
        if (gate) return gate;
        try {
            const { data, error } = await client
                .from('reference_projects')
                .select('data,updated_at')
                .eq('id', id)
                .single();
            if (error) throw error;
            state.loadedUpdatedAt = data.updated_at || null;
            return { data: data.data, updated_at: data.updated_at };
        } catch (err) {
            return { error: dbErr(err) };
        }
    }

    function projectTitle() {
        if (typeof window.baseName === 'function') {
            try { return window.baseName(); } catch (e) { }
        }
        return '';
    }

    async function save(D, opts) {
        opts = opts || {};
        const gate = await requireActive();
        if (gate) return gate;
        const base = {
            nr: String(D.nr || '').trim(),
            kunde: String(D.kunde || '').trim(),
            veranstaltung: String(D.veranstaltung || '').trim(),
            art: String(D.art || '').trim(),
            title: projectTitle(),
            data: D
        };
        try {
            if (opts.id) {
                if (state.loadedUpdatedAt) {
                    const { data: cur } = await client
                        .from('reference_projects')
                        .select('updated_at')
                        .eq('id', opts.id)
                        .maybeSingle();
                    if (cur && cur.updated_at && cur.updated_at !== state.loadedUpdatedAt) {
                        const when = new Date(cur.updated_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                        const ok = confirm('Ein anderer Nutzer hat diese Referenz um ' + when + ' Uhr gespeichert, nachdem du sie geladen hast.\n\nDer alte Stand bleibt als Sicherung erhalten.\n\nTrotzdem überschreiben?');
                        if (!ok) return { cancelled: true };
                    }
                }
                const { data, error } = await client
                    .from('reference_projects')
                    .update(base)
                    .eq('id', opts.id)
                    .select('id,updated_at')
                    .maybeSingle();
                if (error) throw error;
                if (!data) {
                    return { error: 'Diese Referenz gehört einem anderen Nutzer und kann nur von ihm geändert werden. Es wurde nichts gespeichert.' };
                }
                state.loadedUpdatedAt = data.updated_at;
                return { id: data.id, updated_at: data.updated_at };
            }
            const { data, error } = await client
                .from('reference_projects')
                .insert(Object.assign({}, base, { created_by_email: state.user.email }))
                .select('id,updated_at')
                .single();
            if (error) throw error;
            state.loadedUpdatedAt = data.updated_at;
            return { id: data.id, updated_at: data.updated_at };
        } catch (err) {
            console.warn('Cloud-Speichern fehlgeschlagen:', err);
            return { error: dbErr(err) };
        }
    }

    async function remove(id) {
        const gate = await requireActive();
        if (gate) return gate;
        try {
            const { error } = await client
                .from('reference_projects')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', id);
            if (error) throw error;
            return { ok: true };
        } catch (err) {
            return { error: dbErr(err) };
        }
    }

    function bindAuthEvents() {
        $('tabLogin').onclick = () => setMode('login');
        $('tabRegister').onclick = () => setMode('register');
        $('authForm').onsubmit = handleSubmit;
        $('authForgot').onclick = handleForgot;
        client.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_OUT') {
                state.profile = null;
                state.loadedUpdatedAt = null;
                refreshGate();
            } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                refreshGate();
            }
        });
    }

    let readyResolve;
    const ready = new Promise((res) => { readyResolve = res; });

    injectStyles();
    buildDom();
    bindAuthEvents();
    refreshGate();

    window.Cloud = {
        ready,
        get user() { return state.user; },
        get profile() { return state.profile; },
        active: () => !!state.user && isActive(state.profile),
        sb: client,
        list,
        load,
        save,
        remove
    };
})();
