// Kot Live — phone app. Talks to the Supabase functions in kot-live.sql.
(function () {
  'use strict';

  const cfg = window.KOT_CONFIG || {};
  const PHOTO_MAX_SIDE = 800;      // longest side sent to the TV, in pixels
  const PHOTO_TARGET_BYTES = 250000;
  const MESSAGE_MAX = 120;
  const REFRESH_MS = 15000;

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  let who = store.get('kotlive.who');
  let code = store.get('kotlive.code');
  let state = null;
  let shownPhotoId = null;
  let pendingPhoto = null;
  let refreshTimer = null;
  let lastOk = 0;

  // ------------------------------------------------------------------ API
  class ApiError extends Error {
    constructor(message, status, code) { super(message); this.status = status; this.code = code; }
  }
  const FRIENDLY = {
    'wrong household code': 'Wrong household code.',
    'household code not set': 'The household code has not been set up in Supabase yet.',
    'nothing to correct this week': 'Nothing to correct this week.',
    'you have no beers to correct this week': 'You have no beers to correct this week.',
    'Invalid API key': 'The app is not connected to Supabase correctly (API key).',
  };
  async function rpc(fn, args) {
    if (!cfg.url || !cfg.key) throw new ApiError('This app has not been configured yet (config.js).', 0);
    const headers = { 'Content-Type': 'application/json', apikey: cfg.key };
    if (/^eyJ/.test(cfg.key)) headers.Authorization = 'Bearer ' + cfg.key; // legacy anon key
    let res;
    try {
      res = await fetch(String(cfg.url).replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
        method: 'POST', headers, body: JSON.stringify(args), cache: 'no-store',
      });
    } catch (e) {
      throw new ApiError('No connection. Check your internet and try again.', 0);
    }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
    if (!res.ok) {
      const raw = body && body.message ? body.message : 'Something went wrong (' + res.status + ').';
      throw new ApiError(FRIENDLY[raw] || raw, res.status, body && body.code);
    }
    return body;
  }

  // -------------------------------------------------------------- helpers
  let toastTimer;
  function toast(text, bad) {
    const el = $('toast');
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
    el.classList.add('shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('shown'), 2400);
  }
  function chars(s) { return Array.from(s).length; }
  function cleanText(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function when(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff === 0) return time;
    if (diff === 1) return 'yesterday ' + time;
    if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + time;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  function kb(bytes) { return Math.max(1, Math.round(bytes / 1024)) + ' KB'; }
  function handleError(e) {
    if (e && e.status === 403 && /household code/i.test(e.message)) {
      store.del('kotlive.code');
      code = null;
      showSetup(e.message);
      return;
    }
    toast(e && e.message ? e.message : 'Something went wrong.', true);
  }

  // ------------------------------------------------------------ screens
  function showSetup(error) {
    $('main').hidden = true;
    $('setup').hidden = false;
    $('setupName').value = who || '';
    $('setupError').hidden = !error;
    $('setupError').textContent = error || '';
    stopRefresh();
  }
  function showMain() {
    $('setup').hidden = true;
    $('main').hidden = false;
    $('whoButton').textContent = who + ' ▾';
    startRefresh();
  }

  $('setupForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = cleanText($('setupName').value);
    const entered = $('setupCode').value.trim();
    if (!name || !entered) return;
    const button = ev.submitter || $('setupForm').querySelector('button');
    button.disabled = true;
    try {
      const s = await rpc('kot_state', { p_code: entered, p_recent: 8 });
      who = name; code = entered;
      store.set('kotlive.who', who);
      store.set('kotlive.code', code);
      $('setupCode').value = '';
      showMain();
      render(s);
    } catch (e) {
      $('setupError').hidden = false;
      $('setupError').textContent = e.message;
    } finally {
      button.disabled = false;
    }
  });

  $('whoButton').addEventListener('click', () => {
    const next = window.prompt('Your name (leave empty to sign out of this phone):', who || '');
    if (next === null) return;
    const name = cleanText(next).slice(0, 20);
    if (!name) {
      if (window.confirm('Sign out of Kot Live on this phone?')) {
        store.del('kotlive.code');
        code = null;
        showSetup();
      }
      return;
    }
    who = name;
    store.set('kotlive.who', who);
    $('whoButton').textContent = who + ' ▾';
    if (state) render(state);
  });

  // ------------------------------------------------------------- render
  function render(s) {
    if (!s) return;
    state = s;
    lastOk = Date.now();
    $('weekCount').textContent = s.week;
    $('totalCount').textContent = s.total;
    $('correctBeer').disabled = myWeek(s) <= 0;
    renderStats(s.stats);
    const list = $('recent');
    list.textContent = '';
    (s.recent || []).slice(0, 6).forEach((r) => {
      const li = document.createElement('li');
      if (r.delta < 0) li.className = 'minus';
      const left = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = r.delta > 0 ? '+1' : '−1';
      left.append(r.who + ' ', b, r.delta < 0 ? ' correction' : '');
      const right = document.createElement('span');
      right.textContent = when(r.at);
      li.append(left, right);
      list.append(li);
    });
    const m = s.message;
    const box = $('currentMessage');
    box.textContent = '';
    box.classList.toggle('muted', !m);
    if (m) {
      box.append(m.body);
      const small = document.createElement('small');
      small.textContent = m.who + ' · ' + when(m.at);
      box.append(small);
    } else {
      box.textContent = 'No message yet';
    }
    const p = s.photo;
    $('currentPhotoInfo').textContent = p ? p.who + ' · ' + when(p.at) : '';
    if (!p) {
      shownPhotoId = null;
      $('currentPhotoBox').innerHTML = '<span class="muted">No photo yet</span>';
    } else if (p.id !== shownPhotoId) {
      loadPhoto(p.id);
    }
    $('status').textContent = 'Updated ' + when(new Date().toISOString());
  }

  // Your own beers this week. Without stats (older database) fall back to the house count.
  function myWeek(s) {
    if (!s || !s.stats) return s ? s.week : 0;
    const me = (s.stats.people || []).find((p) => p.who.toLowerCase() === String(who || '').toLowerCase());
    return me ? me.week : 0;
  }
  function joinNames(names) {
    return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
  }
  function weekOf(iso) {
    return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  function renderStats(stats) {
    const body = $('boardRows');
    body.textContent = '';
    const people = (stats && stats.people) || [];
    if (!people.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.className = 'muted';
      td.textContent = stats ? 'No beers yet' : 'Stats need the database update.';
      tr.append(td);
      body.append(tr);
    }
    const top = people.reduce((m, p) => Math.max(m, p.week), 0);
    people.forEach((p) => {
      const tr = document.createElement('tr');
      if (p.who.toLowerCase() === String(who || '').toLowerCase()) tr.className = 'me';
      const name = document.createElement('td');
      name.className = 'name';
      name.textContent = (top > 0 && p.week === top ? '👑 ' : '') + p.who;
      tr.append(name);
      [p.week, p.total, p.best].forEach((n, i) => {
        const td = document.createElement('td');
        td.className = 'num' + (i === 0 ? ' week' : '');
        td.textContent = n;
        tr.append(td);
      });
      body.append(tr);
    });
    const lw = stats && stats.last_week;
    $('lastWeek').textContent = lw && lw.top > 0
      ? joinNames(lw.leaders) + ' · ' + lw.top + (lw.total !== lw.top ? ' (house ' + lw.total + ')' : '')
      : '–';
    const rec = stats && stats.record;
    $('bestWeek').textContent = rec && rec.n > 0
      ? rec.n + ' · ' + (rec.current ? 'this week 🔥' : 'week of ' + weekOf(rec.week_start))
      : '–';
  }

  async function loadPhoto(id) {
    shownPhotoId = id;
    try {
      const p = await rpc('kot_photo', { p_code: code, p_id: id });
      if (shownPhotoId !== id) return;
      const img = new Image();
      img.alt = 'Photo on the TV';
      img.src = 'data:image/jpeg;base64,' + p.data;
      const box = $('currentPhotoBox');
      box.textContent = '';
      box.append(img);
    } catch (e) {
      shownPhotoId = null; // try again on the next refresh
    }
  }

  async function refresh() {
    if (!code) return;
    try {
      render(await rpc('kot_state', { p_code: code, p_recent: 8 }));
    } catch (e) {
      if (e.status === 403) { handleError(e); return; }
      $('status').textContent = lastOk ? 'Offline · last update ' + when(new Date(lastOk).toISOString()) : 'Offline';
    }
  }
  function startRefresh() {
    stopRefresh();
    refresh();
    refreshTimer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  }
  function stopRefresh() { clearInterval(refreshTimer); refreshTimer = null; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && code) refresh(); });

  // --------------------------------------------------------------- beers
  async function beer(delta) {
    const plus = $('addBeer');
    const minus = $('correctBeer');
    plus.disabled = minus.disabled = true;
    if (state) $('weekCount').textContent = Math.max(0, state.week + delta); // instant feedback
    try {
      render(await rpc('kot_add_beer', { p_code: code, p_who: who, p_delta: delta }));
      toast(delta > 0 ? 'Cheers! 🍺' : 'Corrected');
      if (delta > 0 && navigator.vibrate) navigator.vibrate(20);
    } catch (e) {
      if (state) render(state);
      handleError(e);
    } finally {
      setTimeout(() => { plus.disabled = false; minus.disabled = myWeek(state) <= 0; }, 600);
    }
  }
  $('addBeer').addEventListener('click', () => beer(1));
  $('correctBeer').addEventListener('click', () => {
    if (window.confirm('Remove one of your beers from this week?')) beer(-1);
  });

  // ------------------------------------------------------------- message
  function updateCount() {
    const n = chars(cleanText($('messageInput').value));
    $('messageCount').textContent = n + ' / ' + MESSAGE_MAX;
    $('messageCount').classList.toggle('error', n > MESSAGE_MAX);
    $('messageSend').disabled = n < 1 || n > MESSAGE_MAX;
  }
  $('messageInput').addEventListener('input', updateCount);
  $('messageInput').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); $('messageForm').requestSubmit(); }
  });
  $('messageForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = cleanText($('messageInput').value);
    if (chars(body) < 1 || chars(body) > MESSAGE_MAX) return;
    $('messageSend').disabled = true;
    try {
      render(await rpc('kot_post_message', { p_code: code, p_who: who, p_body: body }));
      $('messageInput').value = '';
      $('messageInput').blur();
      toast('Posted to the TV');
    } catch (e) {
      handleError(e);
    } finally {
      updateCount();
    }
  });

  // --------------------------------------------------------------- photo
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  function canvasJpeg(canvas, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  }
  // Shrinks the photo (aspect ratio kept) and re-encodes it as JPEG. Re-encoding
  // also drops the photo's metadata, such as its GPS location.
  async function preparePhoto(file) {
    const source = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = source;
      try { await img.decode(); } catch (e) { throw new Error('This photo could not be read. Try another one.'); }
      const sw = img.naturalWidth;
      const sh = img.naturalHeight;
      const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(sw, sh));
      const w = Math.max(1, Math.round(sw * scale));
      const h = Math.max(1, Math.round(sh * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      let quality = 0.8;
      let blob = await canvasJpeg(canvas, quality);
      while (blob && blob.size > PHOTO_TARGET_BYTES && quality > 0.5) {
        quality -= 0.1;
        blob = await canvasJpeg(canvas, quality);
      }
      if (!blob) throw new Error('This photo could not be converted.');
      return { w, h, blob, base64: await blobToBase64(blob), preview: URL.createObjectURL(blob) };
    } finally {
      URL.revokeObjectURL(source);
    }
  }
  function clearPending() {
    if (pendingPhoto) URL.revokeObjectURL(pendingPhoto.preview);
    pendingPhoto = null;
    $('newPhoto').hidden = true;
    $('photoPick').hidden = false;
    $('photoInput').value = '';
  }
  $('photoInput').addEventListener('change', async () => {
    const file = $('photoInput').files && $('photoInput').files[0];
    if (!file) return;
    try {
      clearPending();
      $('photoPick').hidden = true;
      pendingPhoto = await preparePhoto(file);
      $('newPhotoPreview').src = pendingPhoto.preview;
      $('newPhotoInfo').textContent = pendingPhoto.w + ' × ' + pendingPhoto.h + ' · ' + kb(pendingPhoto.blob.size);
      $('newPhoto').hidden = false;
    } catch (e) {
      clearPending();
      toast(e.message, true);
    }
  });
  $('photoCancel').addEventListener('click', clearPending);
  $('photoSend').addEventListener('click', async () => {
    if (!pendingPhoto) return;
    const button = $('photoSend');
    button.disabled = true;
    try {
      render(await rpc('kot_post_photo', {
        p_code: code, p_who: who, p_jpeg_base64: pendingPhoto.base64,
        p_width: pendingPhoto.w, p_height: pendingPhoto.h,
      }));
      clearPending();
      toast('Photo sent to the TV');
    } catch (e) {
      handleError(e);
    } finally {
      button.disabled = false;
    }
  });

  // --------------------------------------------------------------- start
  if (who && code) showMain(); else showSetup();
}());
