// Kot sesh: the guest page. Guests open it by scanning the QR code on the TV;
// the link carries the sesh's own token (after the #), never the household code.
// It stops working when the sesh ends.
(function () {
  'use strict';

  const cfg = window.KOT_CONFIG || {};
  const token = decodeURIComponent(location.hash.slice(1)).trim();
  const PHOTO_MAX_SIDE = 800;
  const PHOTO_TARGET_BYTES = 250000;
  const MESSAGE_MAX = 120;
  const REFRESH_MS = 15000;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  let who = store.get('kotlive.guest.name');
  let state = null;
  let timer = null;
  let pendingPhoto = null;

  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }
  const FRIENDLY = {
    'one beer at a time': 'Easy! One beer at a time.',
    'one message at a time': 'Wait a few seconds before posting again.',
    'one photo at a time': 'Wait a few seconds before sending another photo.',
    'you have no beers to correct tonight': 'You have no beers to correct tonight.',
  };
  async function rpc(fn, args) {
    let res;
    try {
      res = await fetch(String(cfg.url).replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', apikey: cfg.key },
        body: JSON.stringify(Object.assign({ p_token: token }, args)),
      });
    } catch (e) {
      throw new ApiError('No connection. Check your internet and try again.', 0);
    }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
    if (!res.ok) {
      const raw = body && body.message ? body.message : 'Something went wrong (' + res.status + ').';
      throw new ApiError(FRIENDLY[raw] || raw, res.status);
    }
    return body;
  }

  let toastTimer;
  function toast(text, bad) {
    const el = $('toast');
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
    el.classList.add('shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('shown'), 2400);
  }
  function cleanText(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function chars(s) { return Array.from(s).length; }
  function clock(iso) { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }
  function kb(bytes) { return Math.max(1, Math.round(bytes / 1024)) + ' KB'; }

  function showOnly(id) {
    ['ended', 'join', 'main'].forEach((s) => { $(s).hidden = s !== id; });
  }
  function ended(title, text) {
    clearInterval(timer);
    $('endedTitle').textContent = title;
    $('endedText').textContent = text;
    showOnly('ended');
  }
  function handleError(e) {
    if (e && e.status === 403) {
      if (/has ended/.test(e.message)) ended('This sesh has ended', 'Thanks for coming! 🍻');
      else ended('This link does not work', 'Scan the QR code on the TV again.');
      return;
    }
    toast(e && e.message ? e.message : 'Something went wrong.', true);
  }

  function render(s) {
    if (!s) return;
    state = s;
    $('tonight').textContent = s.beers;
    $('tonightUnit').textContent = s.beers === 1 ? 'beer tonight' : 'beers tonight';
    $('mine').textContent = s.mine;
    $('correctBeer').disabled = !(s.mine > 0);
    $('until').textContent = 'Sesh until ' + clock(s.ends_at);
    const ol = $('people');
    ol.textContent = '';
    const people = s.people || [];
    const top = people.reduce((m, p) => Math.max(m, p.n), 0);
    if (!people.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'No beers yet tonight';
      ol.append(li);
    }
    people.forEach((p) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = (top > 0 && p.n === top ? '👑 ' : '') + p.who;
      if (p.guest) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'guest';
        name.append(tag);
      }
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = p.n;
      li.append(name, n);
      ol.append(li);
    });
  }
  async function refresh() {
    try {
      render(await rpc('kot_sesh_guest_state', { p_who: who }));
    } catch (e) {
      if (e.status === 403) handleError(e);
    }
  }
  function start() {
    $('nameButton').textContent = who + ' ▾';
    showOnly('main');
    refresh();
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && who && state) refresh(); });

  $('joinForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const name = cleanText($('joinName').value).slice(0, 20);
    if (!name) return;
    who = name;
    store.set('kotlive.guest.name', who);
    start();
  });
  $('nameButton').addEventListener('click', () => {
    const next = window.prompt('Your name:', who || '');
    const name = cleanText(next).slice(0, 20);
    if (!name) return;
    who = name;
    store.set('kotlive.guest.name', who);
    $('nameButton').textContent = who + ' ▾';
    refresh();
  });

  // ---------------------------------------------------------------- beers
  async function beer(delta) {
    $('addBeer').disabled = $('correctBeer').disabled = true;
    try {
      render(await rpc('kot_sesh_guest_beer', { p_who: who, p_delta: delta }));
      toast(delta > 0 ? 'Cheers! 🍺' : 'Corrected');
      if (delta > 0 && navigator.vibrate) navigator.vibrate(20);
    } catch (e) {
      handleError(e);
    } finally {
      setTimeout(() => {
        $('addBeer').disabled = false;
        $('correctBeer').disabled = !(state && state.mine > 0);
      }, 600);
    }
  }
  $('addBeer').addEventListener('click', () => beer(1));
  $('correctBeer').addEventListener('click', () => {
    if (window.confirm('Remove one of your beers from tonight?')) beer(-1);
  });

  // -------------------------------------------------------------- message
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
      render(await rpc('kot_sesh_guest_message', { p_who: who, p_body: body }));
      $('messageInput').value = '';
      $('messageInput').blur();
      toast('Posted to the TV');
    } catch (e) {
      handleError(e);
    } finally {
      updateCount();
    }
  });

  // ---------------------------------------------------------------- photo
  // Shrunk to 800 px and re-encoded as JPEG, which also drops the photo's
  // metadata (such as its GPS location).
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
  async function preparePhoto(file) {
    const source = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = source;
      try { await img.decode(); } catch (e) { throw new Error('This photo could not be read. Try another one.'); }
      const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
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
    $('photoSend').disabled = true;
    try {
      render(await rpc('kot_sesh_guest_photo', {
        p_who: who, p_jpeg_base64: pendingPhoto.base64, p_width: pendingPhoto.w, p_height: pendingPhoto.h,
      }));
      clearPending();
      toast('Photo sent to the TV');
    } catch (e) {
      handleError(e);
    } finally {
      $('photoSend').disabled = false;
    }
  });

  // ---------------------------------------------------------------- start
  if (!token) {
    ended('This link is not complete', 'Scan the QR code on the TV again.');
  } else {
    // Check the link first, so an old QR code says so straight away.
    rpc('kot_sesh_guest_state', { p_who: who || '' }).then((s) => {
      state = s;
      if (who) { start(); render(s); } else showOnly('join');
    }, (e) => {
      if (e.status === 403) handleError(e);
      else { showOnly(who ? 'main' : 'join'); toast(e.message, true); }
    });
  }
}());
