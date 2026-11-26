/* NO HABAL — Service Worker
 * - توليد reporter_id مرة واحدة عند التثبيت
 * - مزامنة القوائم المعتمدة من Supabase دورياً (مفصولة حسب المنصة)
 * - إرسال البلاغات عبر submit_report
 * - تسجيل المستخدم كنشط يومياً عبر ping_user
 * - عدّاد المنشورات المخفية
 */
'use strict';

// كل الكود داخل دالة حتى نعرّف chrome محلياً (Firefox يستخدم browser)
(() => {
const chrome = globalThis.browser ?? globalThis.chrome;

const SUPABASE_URL = 'https://bohiqxxispuwipmfijgn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PC6jclCqZQiyyNJ_qv4uaA_VirW49YD';

const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'x', 'reddit'];
const SYNC_MINUTES = 30;
const PING_EVERY_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

const store = chrome.storage.local;

// ---------------------------------------------------------------------------
//  Supabase REST
// ---------------------------------------------------------------------------
async function sbFetch(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

const rpc = (fn, args) => sbFetch(`rpc/${fn}`, { method: 'POST', body: args });

// ---------------------------------------------------------------------------
//  الهوية
// ---------------------------------------------------------------------------
async function getReporterId() {
  const { reporter_id } = await store.get('reporter_id');
  if (reporter_id) return reporter_id;
  const id = crypto.randomUUID();
  await store.set({ reporter_id: id });
  return id;
}

async function pingIfDue(force = false) {
  const { last_ping = 0 } = await store.get('last_ping');
  if (!force && Date.now() - last_ping < PING_EVERY_MS) return;
  try {
    const res = await rpc('ping_user', { p_reporter_id: await getReporterId() });
    await store.set({ last_ping: Date.now(), threshold: res?.threshold ?? null });
  } catch (e) {
    console.warn('[NO HABAL] ping failed', e);
  }
}

// ---------------------------------------------------------------------------
//  مزامنة القوائم
// ---------------------------------------------------------------------------
let syncing = null;

function syncLists() {
  if (syncing) return syncing;
  syncing = (async () => {
    const lists = Object.fromEntries(PLATFORMS.map((p) => [p, []]));
    let from = 0;
    // RLS يعيد للزائر الحسابات approved فقط؛ الفلتر هنا للوضوح
    for (;;) {
      const rows = await sbFetch(
        'accounts?select=platform,username&status=eq.approved&order=id',
        { headers: { Range: `${from}-${from + PAGE_SIZE - 1}` } },
      );
      for (const r of rows) {
        if (lists[r.platform]) lists[r.platform].push(r.username);
      }
      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    await store.set({ lists, lists_synced_at: Date.now() });
    return Object.fromEntries(PLATFORMS.map((p) => [p, lists[p].length]));
  })()
    .catch((e) => {
      console.warn('[NO HABAL] sync failed', e);
      throw e;
    })
    .finally(() => { syncing = null; });
  return syncing;
}

// ---------------------------------------------------------------------------
//  البلاغ
// ---------------------------------------------------------------------------
async function addUserHidden(platform, username) {
  const { user_hidden = {} } = await store.get('user_hidden');
  const list = new Set(user_hidden[platform] || []);
  list.add(username);
  user_hidden[platform] = [...list];
  await store.set({ user_hidden });
}

async function report(platform, username) {
  if (!PLATFORMS.includes(platform)) throw new Error('invalid_platform');
  const u = String(username || '').trim().replace(/^@+/, '').toLowerCase();
  if (!u) throw new Error('invalid_username');

  // الإخفاء المحلي أولاً: فوري ولا يعتمد على الشبكة
  await addUserHidden(platform, u);

  const res = await rpc('submit_report', {
    p_platform: platform,
    p_username: u,
    p_reporter_id: await getReporterId(),
  });

  // إن اعتُمد الحساب الآن، أضفه للقائمة المحلية دون انتظار المزامنة
  if (res?.status === 'approved') {
    const { lists = {} } = await store.get('lists');
    const set = new Set(lists[platform] || []);
    set.add(u);
    lists[platform] = [...set];
    await store.set({ lists });
  }
  return res;
}

// ---------------------------------------------------------------------------
//  التراجع عن البلاغ
// ---------------------------------------------------------------------------
async function undoReport(platform, username) {
  const u = String(username || '').trim().replace(/^@+/, '').toLowerCase();

  // أظهره محلياً أولاً
  const { user_hidden = {} } = await store.get('user_hidden');
  user_hidden[platform] = (user_hidden[platform] || []).filter((x) => x !== u);
  await store.set({ user_hidden });

  const res = await rpc('withdraw_report', {
    p_platform: platform,
    p_username: u,
    p_reporter_id: await getReporterId(),
  });

  // إن لم يعد معتمداً (مثلاً كان بلاغك هو الذي أوصله للعتبة) أزله من القائمة المحلية
  if (res?.status !== 'approved') {
    const { lists = {} } = await store.get('lists');
    if (lists[platform]?.includes(u)) {
      lists[platform] = lists[platform].filter((x) => x !== u);
      await store.set({ lists });
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
//  الإحصائيات (طابور حتى لا تتسابق التبويبات على الكتابة)
// ---------------------------------------------------------------------------
let statsQueue = Promise.resolve();

function addHidden(platform, n) {
  statsQueue = statsQueue.then(async () => {
    const { stats = { hidden_total: 0, by_platform: {} } } = await store.get('stats');
    stats.hidden_total += n;
    stats.by_platform[platform] = (stats.by_platform[platform] || 0) + n;
    await store.set({ stats });
  }).catch(() => {});
  return statsQueue;
}

// ---------------------------------------------------------------------------
//  الحظر الفعلي التدريجي (اختياري، مطفأ افتراضياً، إنستغرام فقط)
//  - يعمل فقط حين يرسل تبويب إنستغرام نشط ومرئي "blockTick"
//  - ينفّذ الحظر عبر قائمة إنستغرام نفسها في تبويب خلفي يُغلق بعده
//  - فاصل عشوائي 45–140 ثانية، وسقف 35 حظراً يومياً
// ---------------------------------------------------------------------------
const BLOCK = {
  minGapMs: 45 * 1000,
  maxGapMs: 140 * 1000,
  dailyCap: 35,
  jobTimeoutMs: 60 * 1000,
  maxConsecutiveFails: 3,
  failCooldownMs: 6 * 60 * 60 * 1000,
};

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD بالتوقيت المحلي
const jitter = () => BLOCK.minGapMs + Math.random() * (BLOCK.maxGapMs - BLOCK.minGapMs);

async function getBlockState() {
  const { block_state: s = {} } = await store.get('block_state');
  if (s.date !== today()) { s.date = today(); s.count = 0; }
  return {
    count: 0, next_at: 0, cooldown_until: 0, consecutive_fail: 0,
    total: 0, last_error: null, last_blocked: null, ...s,
  };
}

async function blockQueue() {
  const { lists = {}, already_blocked = {}, block_skipped = {} } =
    await store.get(['lists', 'already_blocked', 'block_skipped']);
  const done = new Set([...(already_blocked.instagram || []), ...(block_skipped.instagram || [])]);
  return (lists.instagram || []).filter((u) => !done.has(u));
}

let blockLock = Promise.resolve();
const withBlockLock = (fn) => (blockLock = blockLock.then(fn, fn));

// يستدعيه تبويب إنستغرام النشط دورياً
function blockTick() {
  return withBlockLock(async () => {
    const { settings = {} } = await store.get('settings');
    if (!settings.autoBlock || settings.enabled === false) return { idle: 'off' };

    const { block_job: job } = await chrome.storage.session.get('block_job');
    if (job) {
      if (Date.now() - job.started < BLOCK.jobTimeoutMs) return { idle: 'busy' };
      await finishJob(job, { result: 'error', error: 'timeout' }); // علِق: أغلقه واحسبه فشلاً
    }

    const s = await getBlockState();
    const now = Date.now();
    if (s.count >= BLOCK.dailyCap) return { idle: 'cap' };
    if (now < s.cooldown_until) return { idle: 'cooldown' };
    if (now < s.next_at) return { idle: 'wait', ms: s.next_at - now };

    const [username] = await blockQueue();
    if (!username) return { idle: 'empty' };

    // احجز الموعد التالي قبل البدء حتى لا تبدأ تبويبات أخرى معاً
    s.next_at = now + jitter();
    await store.set({ block_state: s });

    const tab = await chrome.tabs.create({
      url: `https://www.instagram.com/${encodeURIComponent(username)}/`,
      active: false,
    });
    await chrome.storage.session.set({
      block_job: { tabId: tab.id, username, started: now },
    });
    return { started: username };
  });
}

async function finishJob(job, { result, error }) {
  await chrome.storage.session.remove('block_job');
  chrome.tabs.remove(job.tabId).catch(() => {});

  const s = await getBlockState();
  const lists = await store.get(['already_blocked', 'block_skipped']);
  const add = (key) => {
    const obj = lists[key] || {};
    obj.instagram = [...new Set([...(obj.instagram || []), job.username])];
    return { [key]: obj };
  };

  if (result === 'blocked' || result === 'already') {
    if (result === 'blocked') { s.count += 1; s.total += 1; }
    s.consecutive_fail = 0;
    s.last_blocked = { username: job.username, at: Date.now() };
    s.last_error = null;
    await store.set({ block_state: s, ...add('already_blocked') });
  } else if (result === 'not_found') {
    s.consecutive_fail = 0;
    await store.set({ block_state: s, ...add('block_skipped') });
  } else {
    s.consecutive_fail += 1;
    s.last_error = { username: job.username, error: error || 'unknown', at: Date.now() };
    if (s.consecutive_fail >= BLOCK.maxConsecutiveFails) {
      s.cooldown_until = Date.now() + BLOCK.failCooldownMs;
      s.consecutive_fail = 0;
    }
    await store.set({ block_state: s });
  }
  console.info('[NO HABAL] block @%s → %s', job.username, result, error || '');
}

// تبويب الحظر يسأل: هل أنا تبويب مهمة؟ ولمن؟
async function jobForTab(tabId) {
  const { block_job: job } = await chrome.storage.session.get('block_job');
  return job && job.tabId === tabId ? { username: job.username } : null;
}

async function blockResult(tabId, payload) {
  return withBlockLock(async () => {
    const { block_job: job } = await chrome.storage.session.get('block_job');
    if (!job || job.tabId !== tabId) return false;
    await finishJob(job, payload);
    return true;
  });
}

// إن أغلق المستخدم تبويب المهمة يدوياً
chrome.tabs.onRemoved.addListener((tabId) => {
  withBlockLock(async () => {
    const { block_job: job } = await chrome.storage.session.get('block_job');
    if (job && job.tabId === tabId) await chrome.storage.session.remove('block_job');
  });
});

async function popupStatus() {
  const [s, queue, data] = await Promise.all([
    getBlockState(),
    blockQueue(),
    store.get(['settings', 'stats', 'lists', 'lists_synced_at', 'user_hidden', 'threshold']),
  ]);
  const { block_job: job } = await chrome.storage.session.get('block_job');
  return {
    settings: { enabled: true, autoBlock: false, ...(data.settings || {}) },
    stats: data.stats || { hidden_total: 0, by_platform: {} },
    lists: Object.fromEntries(PLATFORMS.map((p) => [p, (data.lists?.[p] || []).length])),
    mine: Object.fromEntries(PLATFORMS.map((p) => [p, (data.user_hidden?.[p] || []).length])),
    synced_at: data.lists_synced_at || null,
    threshold: data.threshold ?? null,
    block: { ...s, cap: BLOCK.dailyCap, queue: queue.length, running: job?.username || null },
  };
}

async function setSettings(patch) {
  const { settings = {} } = await store.get('settings');
  const next = { enabled: true, autoBlock: false, ...settings, ...patch };
  await store.set({ settings: next });
  return next;
}

// ---------------------------------------------------------------------------
//  الأحداث
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await store.get('settings');
  if (!settings) await store.set({ settings: { enabled: true, autoBlock: false } });
  await getReporterId();
  chrome.alarms.create('sync', { periodInMinutes: SYNC_MINUTES });
  await Promise.allSettled([syncLists(), pingIfDue(true)]);
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create('sync', { periodInMinutes: SYNC_MINUTES });
  await Promise.allSettled([syncLists(), pingIfDue()]);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sync') {
    syncLists().catch(() => {});
    pingIfDue();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const reply = (p) => {
    p.then((data) => sendResponse({ ok: true, data }))
     .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true; // رد غير متزامن
  };

  switch (msg?.type) {
    case 'report':
      return reply(report(msg.platform, msg.username));
    case 'undo':
      return reply(undoReport(msg.platform, msg.username));
    case 'sync':
      return reply(syncLists());
    case 'hidden':
      addHidden(msg.platform, Math.max(0, Number(msg.count) || 0));
      return false;
    case 'blockTick':
      return reply(blockTick());
    case 'blockJob':
      return reply(jobForTab(sender.tab?.id));
    case 'blockResult':
      return reply(blockResult(sender.tab?.id, { result: msg.result, error: msg.error }));
    case 'status':
      return reply(popupStatus());
    case 'setSettings':
      return reply(setSettings({
        ...(typeof msg.enabled === 'boolean' ? { enabled: msg.enabled } : {}),
        ...(typeof msg.autoBlock === 'boolean' ? { autoBlock: msg.autoBlock } : {}),
      }));
    default:
      return false;
  }
});
})();
