// Kot Live widget for Scriptable (free app: https://scriptable.app).
//
// 1. In Scriptable tap +, paste this script and name it "Kot Live".
// 2. Tap ▶ once: enter your name and the household code (kept in this iPhone's Keychain).
// 3. Home Screen: long-press → Edit → Add Widget → Scriptable → pick a size → tap the
//    widget → Script: Kot Live. Lock Screen widgets work the same way.
//
// Tap "+1 🍺" on the medium/large widget to log a beer (with Undo). Tap anywhere else
// for a menu. iOS decides how often widgets refresh (usually every 10-20 minutes).

const KOT = {
  url: 'https://qjpyvokvaoqjtleopfyk.supabase.co',
  key: 'sb_publishable_IiLxC_0X02QZl4XyVEY4Mw_5MSK-4ui',
  site: 'https://sebastiansteyaert-afk.github.io/kot-live/',
};
const KEY_NAME = 'kotlive.widget.name';
const KEY_CODE = 'kotlive.widget.code';
const REFRESH_MINUTES = 10;

const AMBER = new Color('#f5b83d');
const BG = new Color('#16171c');
const TEXT = new Color('#ffffff');
const MUTED = new Color('#ffffff', 0.55);
const LINE = new Color('#ffffff', 0.12);
const WARN = new Color('#ff9a7a');
const ON_AMBER = new Color('#1d1606');

const files = FileManager.local();
const DIR = files.documentsDirectory();
const CACHE = files.joinPath(DIR, 'kotlive-widget.json');
const RUN = 'scriptable:///run/' + encodeURIComponent(Script.name());

// ------------------------------------------------------------------ data
function credentials() {
  if (!Keychain.contains(KEY_NAME) || !Keychain.contains(KEY_CODE)) return null;
  return { who: Keychain.get(KEY_NAME), code: Keychain.get(KEY_CODE) };
}

async function rpc(fn, body) {
  const req = new Request(KOT.url + '/rest/v1/rpc/' + fn);
  req.method = 'POST';
  req.headers = { 'Content-Type': 'application/json', apikey: KOT.key };
  req.body = JSON.stringify(body);
  req.timeoutInterval = 15;
  let text;
  try {
    text = await req.loadString();
  } catch (e) {
    throw Object.assign(new Error('No connection'), { status: 0 });
  }
  const status = req.response ? req.response.statusCode : 0;
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (status !== 200 || !data) {
    throw Object.assign(new Error((data && data.message) || 'HTTP ' + status), { status });
  }
  return data;
}

function friendly(e) {
  const m = (e && e.message) || '';
  if (/wrong household code/.test(m)) return 'Wrong household code.';
  if (/no beers to correct/.test(m)) return 'You have no beers to correct this week.';
  if (/No connection/.test(m)) return 'No connection. Try again in a moment.';
  return m || 'Something went wrong.';
}

function readCache() {
  try { return files.fileExists(CACHE) ? JSON.parse(files.readString(CACHE)) : null; } catch (e) { return null; }
}
function writeCache(state) {
  try { files.writeString(CACHE, JSON.stringify({ savedAt: Date.now(), state })); } catch (e) { /* ignore */ }
}

// Latest photo, downloaded only when it changes (large widget only).
async function latestPhoto(state, code) {
  const p = state.photo;
  if (!p) return null;
  const name = 'kotlive-photo-' + p.id + '.jpg';
  const path = files.joinPath(DIR, name);
  try {
    if (!files.fileExists(path)) {
      const r = await rpc('kot_photo', { p_code: code, p_id: p.id });
      files.write(path, Data.fromBase64String(r.data));
      for (const f of files.listContents(DIR)) {
        if (/^kotlive-photo-\d+\.jpg$/.test(f) && f !== name) files.remove(files.joinPath(DIR, f));
      }
    }
    return files.readImage(path);
  } catch (e) {
    return null;
  }
}

function people(state) { return (state.stats && state.stats.people) || []; }
function sameName(a, b) { return String(a || '').toLowerCase() === String(b || '').toLowerCase(); }
function myWeek(state, who) {
  const me = people(state).find((p) => sameName(p.who, who));
  return me ? me.week : 0;
}
function joinNames(names) {
  return names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
}
function leaders(state) {
  const list = people(state);
  const top = list.reduce((m, p) => Math.max(m, p.week), 0);
  if (top <= 0) return null;
  return { top, names: list.filter((p) => p.week === top).map((p) => p.who) };
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function clock(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function when(iso) {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return clock(d);
  return d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + clock(d);
}
function dayMonth(iso) { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }

// --------------------------------------------------------------- drawing
function text(stack, value, font, color, lines) {
  const t = stack.addText(String(value));
  t.font = font;
  if (color) t.textColor = color;
  if (lines) t.lineLimit = lines;
  return t;
}
function crown(stack, size, visible) {
  if (!visible) { stack.addSpacer(size); return; }
  const symbol = SFSymbol.named('crown.fill');
  const image = stack.addImage(symbol.image);
  image.imageSize = new Size(size, size);
  image.tintColor = AMBER;
}
function divider(widget) {
  const line = widget.addStack();
  line.size = new Size(0, 1);
  line.backgroundColor = LINE;
  line.addSpacer();
}
function beerButton(stack) {
  const b = stack.addStack();
  b.backgroundColor = AMBER;
  b.cornerRadius = 12;
  b.setPadding(6, 14, 6, 14);
  b.url = RUN + '?action=beer';
  text(b, '+1 🍺', Font.boldSystemFont(15), ON_AMBER, 1);
}
function title(stack, label, staleAt) {
  const row = stack.addStack();
  row.centerAlignContent();
  text(row, label, Font.semiboldSystemFont(11), MUTED, 1);
  if (staleAt) {
    row.addSpacer(6);
    text(row, '⚠︎ ' + clock(new Date(staleAt)), Font.mediumSystemFont(10), WARN, 1);
  }
  return row;
}
function cell(row, width, value, font, color) {
  const c = row.addStack();
  c.size = new Size(width, 0);
  c.addSpacer();
  const t = text(c, value, font, color, 1);
  t.minimumScaleFactor = 0.6;
  return t;
}
function isAccessory(family) { return String(family).indexOf('accessory') === 0; }
function newWidget(family) {
  const w = new ListWidget();
  if (!isAccessory(family)) w.backgroundColor = BG;   // Lock Screen widgets stay transparent
  w.url = RUN + '?action=menu';
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);
  return w;
}
function noteWidget(family, message) {
  const w = newWidget(family);
  if (isAccessory(family)) {
    text(w, '🍺 ' + message, Font.mediumSystemFont(12), null, 3);
    return w;
  }
  w.setPadding(14, 14, 14, 14);
  title(w, 'KOT LIVE');
  w.addSpacer(6);
  const t = text(w, message, Font.mediumSystemFont(13), TEXT, 5);
  t.minimumScaleFactor = 0.7;
  return w;
}

function smallWidget(w, s, me, staleAt) {
  w.setPadding(14, 14, 14, 14);
  title(w, 'KOT LIVE', staleAt);
  w.addSpacer(2);
  const n = text(w, s.week, Font.boldRoundedSystemFont(46), AMBER, 1);
  n.minimumScaleFactor = 0.5;
  text(w, 'this week', Font.mediumSystemFont(13), MUTED, 1);
  w.addSpacer();
  const lead = leaders(s);
  if (lead) {
    const r = w.addStack();
    r.centerAlignContent();
    crown(r, 11, true);
    r.addSpacer(4);
    const t = text(r, joinNames(lead.names) + ' · ' + lead.top, Font.semiboldSystemFont(13), TEXT, 1);
    t.minimumScaleFactor = 0.7;
  }
  text(w, s.total + ' all-time', Font.systemFont(12), MUTED, 1);
}

function mediumWidget(w, s, me, staleAt) {
  w.setPadding(14, 16, 14, 16);
  const row = w.addStack();
  const left = row.addStack();
  left.layoutVertically();
  left.size = new Size(112, 0);
  title(left, 'KOT LIVE', staleAt);
  left.addSpacer(2);
  const n = text(left, s.week, Font.boldRoundedSystemFont(40), AMBER, 1);
  n.minimumScaleFactor = 0.5;
  text(left, 'this week', Font.mediumSystemFont(12), MUTED, 1);
  left.addSpacer();
  beerButton(left);
  row.addSpacer(16);

  const right = row.addStack();
  right.layoutVertically();
  const head = right.addStack();
  title(head, 'LEADERBOARD');
  head.addSpacer();
  text(head, s.total + ' all-time', Font.systemFont(11), MUTED, 1);
  right.addSpacer(6);
  const list = people(s);
  const lead = leaders(s);
  if (!list.length) text(right, 'No beers yet', Font.systemFont(13), MUTED, 1);
  for (const p of list.slice(0, 4)) {
    const r = right.addStack();
    r.centerAlignContent();
    crown(r, 11, lead && p.week === lead.top);
    r.addSpacer(5);
    const name = text(r, p.who, sameName(p.who, me) ? Font.boldSystemFont(14) : Font.mediumSystemFont(14), TEXT, 1);
    name.minimumScaleFactor = 0.7;
    r.addSpacer();
    text(r, p.week, Font.boldRoundedSystemFont(16), p.week > 0 ? AMBER : MUTED, 1);
    right.addSpacer(3);
  }
  right.addSpacer();
}

function largeWidget(w, s, me, staleAt, photo) {
  w.setPadding(16, 16, 16, 16);
  const top = w.addStack();
  top.centerAlignContent();
  const tl = top.addStack();
  tl.layoutVertically();
  title(tl, 'KOT LIVE', staleAt);
  const nums = tl.addStack();
  nums.bottomAlignContent();
  text(nums, s.week, Font.boldRoundedSystemFont(38), AMBER, 1);
  nums.addSpacer(6);
  const label = nums.addStack();
  label.layoutVertically();
  text(label, 'this week', Font.mediumSystemFont(13), MUTED, 1);
  text(label, s.total + ' all-time', Font.systemFont(12), MUTED, 1);
  label.addSpacer(5);
  top.addSpacer();
  beerButton(top);

  w.addSpacer(10);
  divider(w);
  w.addSpacer(8);

  const head = w.addStack();
  head.centerAlignContent();
  title(head, 'LEADERBOARD');
  head.addSpacer();
  cell(head, 46, 'week', Font.systemFont(11), MUTED);
  cell(head, 46, 'total', Font.systemFont(11), MUTED);
  w.addSpacer(4);
  const list = people(s);
  const lead = leaders(s);
  if (!list.length) text(w, 'No beers yet', Font.systemFont(13), MUTED, 1);
  for (const p of list.slice(0, 5)) {
    const r = w.addStack();
    r.centerAlignContent();
    crown(r, 12, lead && p.week === lead.top);
    r.addSpacer(6);
    const name = text(r, p.who, sameName(p.who, me) ? Font.boldSystemFont(15) : Font.mediumSystemFont(15), TEXT, 1);
    name.minimumScaleFactor = 0.7;
    r.addSpacer();
    cell(r, 46, p.week, Font.boldRoundedSystemFont(17), p.week > 0 ? AMBER : MUTED);
    cell(r, 46, p.total, Font.mediumSystemFont(14), MUTED);
    w.addSpacer(3);
  }

  w.addSpacer(6);
  const st = s.stats || {};
  const lw = st.last_week;
  const rec = st.record;
  const records = [
    ['Last week', lw && lw.top > 0 ? joinNames(lw.leaders) + ' · ' + lw.top : '–'],
    ['Best week', rec && rec.n > 0 ? rec.n + ' · ' + (rec.current ? 'this week 🔥' : dayMonth(rec.week_start)) : '–'],
  ];
  for (const [k, v] of records) {
    const r = w.addStack();
    const kt = r.addStack();
    kt.size = new Size(78, 0);
    text(kt, k, Font.systemFont(12), MUTED, 1);
    const vt = text(r, v, Font.mediumSystemFont(12), TEXT, 1);
    vt.minimumScaleFactor = 0.7;
    r.addSpacer();
  }

  w.addSpacer();
  divider(w);
  w.addSpacer(8);
  const msg = w.addStack();
  msg.centerAlignContent();
  if (photo) {
    const img = msg.addImage(photo);
    img.imageSize = new Size(56, 56);
    img.cornerRadius = 10;
    img.applyFillingContentMode();
    msg.addSpacer(10);
  }
  const mt = msg.addStack();
  mt.layoutVertically();
  const m = s.message;
  if (m) {
    text(mt, '💬 ' + m.body, Font.mediumSystemFont(13), TEXT, 2);
    text(mt, m.who + ' · ' + when(m.at), Font.systemFont(11), MUTED, 1);
  } else {
    text(mt, '💬 No message yet', Font.systemFont(13), MUTED, 1);
  }
  msg.addSpacer();
}

function accessoryWidget(w, s, family) {
  const lead = leaders(s);
  if (family === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const row = w.addStack();
    row.addSpacer();
    const col = row.addStack();
    col.layoutVertically();
    col.centerAlignContent();
    const a = text(col, '🍺', Font.systemFont(12), null, 1);
    a.centerAlignText();
    const b = text(col, s.week, Font.boldRoundedSystemFont(22), null, 1);
    b.minimumScaleFactor = 0.5;
    b.centerAlignText();
    row.addSpacer();
  } else if (family === 'accessoryInline') {
    text(w, '🍺 ' + s.week + ' this week' + (lead ? ' · 👑 ' + joinNames(lead.names) : ''), Font.systemFont(12), null, 1);
  } else {
    text(w, '🍺 ' + s.week + ' this week', Font.semiboldSystemFont(15), null, 1);
    text(w, lead ? '👑 ' + joinNames(lead.names) + ' · ' + lead.top : 'No beers yet', Font.systemFont(13), null, 1);
    text(w, s.total + ' all-time', Font.systemFont(12), null, 1);
  }
}

async function makeWidget(family) {
  family = family || 'medium';
  const c = credentials();
  if (!c) return noteWidget(family, 'Open Scriptable and run "' + Script.name() + '" once to set it up.');
  let state = null;
  let staleAt = null;
  try {
    state = await rpc('kot_state', { p_code: c.code });
    writeCache(state);
  } catch (e) {
    if (e.status === 403) return noteWidget(family, 'Household code is wrong. Run "' + Script.name() + '" in Scriptable to fix it.');
    const cached = readCache();
    if (cached && cached.state) { state = cached.state; staleAt = cached.savedAt; }
  }
  if (!state) return noteWidget(family, 'Offline. Kot Live will update when the internet is back.');
  const w = newWidget(family);
  if (isAccessory(family)) accessoryWidget(w, state, family);
  else if (family === 'small') smallWidget(w, state, c.who, staleAt);
  else if (family === 'large' || family === 'extraLarge') largeWidget(w, state, c.who, staleAt, await latestPhoto(state, c.code));
  else mediumWidget(w, state, c.who, staleAt);
  return w;
}

// ------------------------------------------------------------- in the app
async function info(heading, message) {
  const a = new Alert();
  a.title = heading;
  a.message = message;
  a.addAction('OK');
  await a.presentAlert();
}

async function setUp() {
  const old = credentials();
  const a = new Alert();
  a.title = 'Kot Live widget';
  a.message = 'Your name and the household code. They stay on this iPhone, in the Keychain.';
  a.addTextField('Your name', old ? old.who : '');
  a.addSecureTextField(old ? 'Household code (empty: keep)' : 'Household code', '');
  a.addAction('Save');
  a.addCancelAction('Cancel');
  if (await a.presentAlert() === -1) return null;
  const who = a.textFieldValue(0).replace(/\s+/g, ' ').trim().slice(0, 20);
  const code = a.textFieldValue(1).trim() || (old ? old.code : '');
  if (!who || !code) {
    await info('Not saved', 'Fill in your name and the household code.');
    return null;
  }
  try {
    writeCache(await rpc('kot_state', { p_code: code }));
  } catch (e) {
    await info('Not saved', friendly(e));
    return null;
  }
  Keychain.set(KEY_NAME, who);
  Keychain.set(KEY_CODE, code);
  await info('Saved', 'Now add the widget: long-press the Home Screen → Edit → Add Widget → Scriptable. Pick a size, tap the new widget and choose "' + Script.name() + '" as Script.');
  return { who, code };
}

async function addBeer(c) {
  let s;
  try {
    s = await rpc('kot_add_beer', { p_code: c.code, p_who: c.who, p_delta: 1 });
  } catch (e) {
    await info('Not added', friendly(e));
    return;
  }
  writeCache(s);
  const a = new Alert();
  a.title = 'Cheers! 🍺';
  a.message = c.who + ': ' + myWeek(s, c.who) + ' this week · house: ' + s.week;
  a.addAction('OK');
  a.addDestructiveAction('Undo');
  if (await a.presentAlert() === 1) {
    try {
      s = await rpc('kot_add_beer', { p_code: c.code, p_who: c.who, p_delta: -1 });
      writeCache(s);
      await info('Undone', c.who + ': ' + myWeek(s, c.who) + ' this week');
    } catch (e) {
      await info('Not undone', friendly(e));
    }
  }
}

async function preview() {
  const a = new Alert();
  a.title = 'Preview';
  for (const size of ['Small', 'Medium', 'Large', 'Lock Screen']) a.addAction(size);
  a.addCancelAction('Cancel');
  const i = await a.presentSheet();
  if (i === 0) await (await makeWidget('small')).presentSmall();
  if (i === 1) await (await makeWidget('medium')).presentMedium();
  if (i === 2) await (await makeWidget('large')).presentLarge();
  if (i === 3) await (await makeWidget('accessoryRectangular')).presentAccessoryRectangular();
}

async function inApp() {
  const query = args.queryParameters || {};
  let c = credentials();
  if (!c) {
    c = await setUp();
    if (!c) return;
    if (!query.action) return;
  }
  if (query.action === 'beer') {
    await addBeer(c);
    return;
  }
  const a = new Alert();
  a.title = 'Kot Live';
  a.message = 'Signed in as ' + c.who;
  a.addAction('+1 🍺');
  a.addAction('Preview widget');
  a.addAction('Open Kot Live in Safari');
  a.addAction('Change name or code');
  a.addCancelAction('Close');
  const i = await a.presentSheet();
  if (i === 0) await addBeer(c);
  if (i === 1) await preview();
  if (i === 2) Safari.open(KOT.site);
  if (i === 3) await setUp();
}

if (config.runsInWidget) {
  Script.setWidget(await makeWidget(config.widgetFamily));
} else {
  await inApp();
}
Script.complete();
