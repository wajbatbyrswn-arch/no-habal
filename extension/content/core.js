/* NO HABAL — Content Core
 * محرك مشترك لكل المنصات:
 * - يقرأ قائمة المنصة الحالية من chrome.storage.local (المعتمدة + ما أبلغ عنه المستخدم)
 * - يراقب الصفحة بـ MutationObserver ويخفي المنشورات (display:none)
 * - يتخطى الريلز المحظورة (ArrowDown)
 * - يحقن زر إبلاغ NO HABAL بجانب اسم الحساب
 *
 * كل منصة (instagram.js / facebook.js) تستدعي NoHabal.register(adapter) حيث:
 *   adapter.platform               'instagram' | 'facebook' | ...
 *   adapter.scanPosts()            → [{ container, username, anchor }]
 *   adapter.currentReel()          → { key, username, anchor } | null
 *   adapter.skipReel()             → يتخطى الريل الحالي
 */
(() => {
  'use strict';
  // Firefox: واجهة browser تعيد Promises؛ Chrome/Edge: chrome
  const chrome = globalThis.browser ?? globalThis.chrome;
  if (window.NoHabal) return;

  const store = chrome.storage.local;
  const alive = () => Boolean(chrome.runtime?.id); // false بعد إعادة تحميل الإضافة

  let adapter = null;
  let blocked = new Set();   // المعتمدة جماعياً + ما أبلغ عنه المستخدم
  let mine = new Set();      // ما أبلغ عنه هذا المستخدم (قابل للتراجع)
  let enabled = true;
  let pendingHidden = 0;
  let lastSkippedReel = null;

  // -------------------------------------------------------------------------
  //  القائمة
  // -------------------------------------------------------------------------
  async function loadState() {
    const { lists = {}, user_hidden = {}, settings = {} } =
      await store.get(['lists', 'user_hidden', 'settings']);
    const p = adapter.platform;
    mine = new Set(user_hidden[p] || []);
    blocked = new Set([...(lists[p] || []), ...mine]);
    enabled = settings.enabled !== false;
  }

  const isBlocked = (u) => enabled && Boolean(u) && blocked.has(u);

  // -------------------------------------------------------------------------
  //  الإخفاء
  // -------------------------------------------------------------------------
  function hide(container, username) {
    if (container.classList.contains('nh-hidden')) return;
    container.classList.add('nh-hidden');
    container.dataset.nhUser = username;
    pendingHidden += 1;
  }

  // إظهار كل ما لم يعد محظوراً (بعد التراجع أو إيقاف الإضافة)
  function revealUnblocked() {
    document.querySelectorAll('.nh-hidden').forEach((el) => {
      if (!isBlocked(el.dataset.nhUser)) el.classList.remove('nh-hidden');
    });
    document.querySelectorAll('.nh-cover').forEach((cover) => {
      if (isBlocked(cover.dataset.nhUser)) return;
      cover.parentElement?.querySelector(':scope > video.nh-covered')?.classList.remove('nh-covered');
      cover.remove();
    });
    document.querySelectorAll('.nh-report-btn.nh-done').forEach((b) => {
      if (!isBlocked(b.dataset.nhUser)) setButtonState(b, false);
    });
    lastSkippedReel = null;
  }

  // نرسل العداد على دفعات بدل رسالة لكل منشور
  setInterval(() => {
    if (!pendingHidden || !alive()) return;
    chrome.runtime.sendMessage({ type: 'hidden', platform: adapter.platform, count: pendingHidden })
      .catch(() => {});
    pendingHidden = 0;
  }, 5000);

  // -------------------------------------------------------------------------
  //  زر الإبلاغ
  // -------------------------------------------------------------------------
  // أيقونات SVG تُبنى بـ createElementNS (فيسبوك يمنع innerHTML عبر Trusted Types)
  const ICONS = {
    // علم: قبل الإبلاغ
    flag: [
      ['path', { d: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z' }],
      ['line', { x1: 4, y1: 22, x2: 4, y2: 15 }],
    ],
    // علامة صح: بعد الإبلاغ
    check: [['polyline', { points: '20 6 9 17 4 12' }]],
  };

  function icon(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('nh-icon', `nh-icon-${name}`);
    for (const [tag, attrs] of ICONS[name]) {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      svg.appendChild(el);
    }
    return svg;
  }

  function setButtonState(btn, done) {
    const username = btn.dataset.nhUser;
    btn.classList.toggle('nh-done', done);
    btn.disabled = done;
    btn.replaceChildren(icon(done ? 'check' : 'flag'));
    btn.title = done
      ? `NO HABAL: تم الإبلاغ عن @${username}`
      : `NO HABAL: الإبلاغ عن @${username} وإخفاؤه`;
    btn.setAttribute('aria-label', btn.title);
  }

  function makeButton(username, container) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nh-report-btn';
    btn.dataset.nhUser = username;
    setButtonState(btn, false);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onReport(username, container, btn);
    }, true);
    return btn;
  }

  // item.btnClass: صنف إضافي لتنسيق خاص بالمنصة (مثل nh-tt لتيك توك)
  // item.btnSlot:  اسم slot في واجهة ويب كومبوننت (ريدت يعرض شريط المعلومات عبر shadow DOM)
  function attachButton(item) {
    const { anchor, username, container, btnClass, btnSlot } = item;
    if (!anchor || anchor.dataset.nhBtn === username) return;
    anchor.dataset.nhBtn = username;
    const old = anchor.parentElement?.querySelector(':scope > .nh-report-btn');
    if (old) old.remove();
    const btn = makeButton(username, container);
    if (btnClass) btn.classList.add(btnClass);
    if (btnSlot) btn.slot = btnSlot;
    anchor.insertAdjacentElement('afterend', btn);
  }

  async function onReport(username, container, btn) {
    if (!alive()) return toast('أعد تحميل الصفحة: تم تحديث الإضافة.', { error: true });
    if (btn.classList.contains('nh-report-btn')) setButtonState(btn, true);
    else btn.disabled = true;

    // إخفاء فوري عند المستخدم
    blocked.add(username);
    mine.add(username);
    console.debug('[NO HABAL] reported @%s', username);
    if (container) hide(container, username);
    scan(); // في الريلز: checkReel يرى الحساب محظوراً فيتخطاه

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'report', platform: adapter.platform, username });
    } catch (e) {
      res = { ok: false, error: String(e) };
    }

    const undo = { label: 'تراجع', onClick: () => onUndo(username) };
    if (!res?.ok || res.data?.ok === false) {
      toast(`أُخفي @${username} عندك، لكن تعذّر إرسال البلاغ.`, { error: true, action: undo });
      return;
    }
    const d = res.data;
    let msg;
    if (d.message === 'whitelisted') {
      msg = `أُخفي @${username} عندك. هذا الحساب محمي من البلاغات الجماعية.`;
    } else if (d.duplicate) {
      msg = `سبق أن أبلغت عن @${username} · ${d.report_count}/${d.threshold}`;
    } else if (d.status === 'approved') {
      msg = `@${username} محظور الآن للجميع ✔ (${d.report_count}/${d.threshold})`;
    } else {
      msg = `تم الإبلاغ عن @${username} · ${d.report_count}/${d.threshold} بلاغ`;
    }
    toast(msg, { action: undo, duration: 8000 });
  }

  async function onUndo(username) {
    if (!alive()) return toast('أعد تحميل الصفحة: تم تحديث الإضافة.', { error: true });
    toast(`جارٍ التراجع عن @${username}…`);

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'undo', platform: adapter.platform, username });
    } catch (e) {
      res = { ok: false, error: String(e) };
    }
    // التخزين تغيّر → onChanged يعيد بناء القائمة ويُظهر المنشورات
    if (!res?.ok) {
      toast(`ظهر @${username} عندك، لكن تعذّر سحب البلاغ من السيرفر.`, { error: true });
    } else if (res.data?.status === 'approved') {
      toast(`سُحب بلاغك، لكن @${username} ما زال محظوراً ببلاغات آخرين.`);
    } else {
      toast(`تم التراجع. سيظهر @${username} من جديد.`);
    }
  }

  // -------------------------------------------------------------------------
  //  Toast (مع زر إجراء اختياري)
  // -------------------------------------------------------------------------
  let toastTimer;
  function toast(msg, { error = false, action = null, duration = 3500 } = {}) {
    let el = document.getElementById('nh-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'nh-toast';
      el.setAttribute('role', 'status');
      el.dir = 'rtl';
      document.documentElement.appendChild(el);
    }
    el.textContent = '';
    el.append(document.createTextNode(msg));
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'nh-toast-action';
      b.textContent = action.label;
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove('nh-show');
        action.onClick();
      });
      el.append(b);
    }
    el.classList.toggle('nh-error', error);
    el.classList.add('nh-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('nh-show'), duration);
  }

  // -------------------------------------------------------------------------
  //  المسح
  // -------------------------------------------------------------------------
  function scan() {
    if (!adapter || !alive()) return;

    let items = [];
    try { items = adapter.scanPosts() || []; } catch (e) { console.debug('[NO HABAL] scan', e); }

    for (const item of items) {
      if (!item?.username) continue;
      // container اختياري: بدونه نضيف الزر فقط (مثل منشور مفتوح في نافذة منبثقة)
      if (isBlocked(item.username)) { if (item.container) hide(item.container, item.username); }
      else attachButton(item);
    }

    checkReel();
    checkProfile();
  }

  // تغطية فيديو محظور: إيقاف + كتم + طبقة فوقه (تبقى حتى لو رجع المستخدم إليه)
  function coverVideo(video, username) {
    if (!video) return;
    video.muted = true; // الكتم أولاً
    if (!video.paused) video.pause();
    if (video.classList.contains('nh-covered')) return;
    video.classList.add('nh-covered');

    const host = video.parentElement;
    if (!host || host.querySelector(':scope > .nh-cover')) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const cover = document.createElement('div');
    cover.className = 'nh-cover';
    cover.dir = 'rtl';
    cover.dataset.nhUser = username;
    cover.textContent = `⛔ @${username} مخفي بواسطة NO HABAL`;
    host.appendChild(cover);
  }

  // إنستغرام قد يعيد تشغيل الفيديو أو الصوت: نُبقي كل فيديو مغطّى موقوفاً ومكتوماً
  function enforceCovered() {
    document.querySelectorAll('video.nh-covered').forEach((v) => {
      if (!v.muted) v.muted = true;
      if (!v.paused) v.pause();
    });
  }

  function checkReel() {
    if (!enabled || !adapter.currentReel) return;
    let reel = null;
    try { reel = adapter.currentReel(); } catch (e) { console.debug('[NO HABAL] reel', e); }
    if (!reel?.username) return;

    if (isBlocked(reel.username)) {
      coverVideo(reel.video, reel.username);
      // نتخطى تلقائياً مرة واحدة لكل ريل؛ إن رجع إليه المستخدم يبقى مغطّى وموقوفاً
      if (lastSkippedReel === reel.key) return;
      lastSkippedReel = reel.key;
      pendingHidden += 1;
      console.debug('[NO HABAL] skipped reel by @%s', reel.username);
      adapter.skipReel();
    } else if (reel.anchor) {
      attachButton({ anchor: reel.anchor, username: reel.username, container: null });
    }
  }

  // زر بارز في صفحة الملف الشخصي
  function checkProfile() {
    if (!adapter.profile) return;
    let prof = null;
    try { prof = adapter.profile(); } catch (e) { console.debug('[NO HABAL] profile', e); }
    const old = document.querySelector('.nh-profile-btn');
    if (!prof?.username || !prof.anchor) { old?.remove(); return; }

    // mine: أبلغتَ أنت عنه · blocked: محظور جماعياً · open: يمكن الإبلاغ
    // (التراجع متاح فقط من رسالة الإشعار بعد الإبلاغ)
    const state = mine.has(prof.username) ? 'mine'
      : blocked.has(prof.username) ? 'blocked' : 'open';
    if (old && old.dataset.user === prof.username && old.dataset.state === state
        && (prof.inside ? old.parentElement === prof.anchor
                        : old.previousElementSibling === prof.anchor)) return;
    old?.remove();

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nh-profile-btn';
    btn.dataset.user = prof.username;
    btn.dataset.state = state;
    btn.dir = 'rtl';
    if (state === 'mine') {
      btn.append(icon('check'), 'تم الإبلاغ');
      btn.disabled = true;
    } else if (state === 'blocked') {
      btn.append(icon('check'), 'محظور في NO HABAL');
      btn.disabled = true;
    } else {
      btn.append(icon('flag'), 'إبلاغ NO HABAL');
      btn.title = `الإبلاغ عن @${prof.username} وإخفاؤه من صفحاتك`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onReport(prof.username, null, btn);
      }, true);
    }
    // inside: داخل عنصر الاسم نفسه (في نفس السطر) بدل سطر جديد يتداخل مع ما تحته
    if (prof.inside) {
      btn.classList.add('nh-inline');
      prof.anchor.appendChild(btn);
    } else {
      prof.anchor.insertAdjacentElement('afterend', btn);
    }
  }

  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      scan();
    }, 250);
  }

  // -------------------------------------------------------------------------
  //  التشغيل
  // -------------------------------------------------------------------------
  async function start(a) {
    adapter = a;
    await loadState();

    new MutationObserver(scheduleScan).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    // الريلز تتغير بالتمرير دون تغيّر كبير في الـ DOM
    setInterval(() => {
      if (!alive()) return;
      enforceCovered();
      checkReel();
    }, 800);

    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;
      if (!('lists' in changes || 'user_hidden' in changes || 'settings' in changes)) return;
      await loadState();
      revealUnblocked();
      scan();
    });

    scan();
  }

  // أدوات مشتركة للـ adapters
  const utils = {
    // أقرب فيديو لمنتصف الشاشة (للريلز)
    centeredVideo() {
      const mid = window.innerHeight / 2;
      let best = null;
      let bestDist = Infinity;
      for (const v of document.querySelectorAll('video')) {
        const r = v.getBoundingClientRect();
        if (r.height < 100 || r.bottom < 0 || r.top > window.innerHeight) continue;
        const d = Math.abs((r.top + r.bottom) / 2 - mid);
        if (d < bestDist) { bestDist = d; best = v; }
      }
      return best;
    },

    // يصعد من عنصر حتى يجد رابط حساب
    findProfileNear(el, parse, maxDepth = 14) {
      for (let n = el, i = 0; n && i < maxDepth; n = n.parentElement, i += 1) {
        for (const a of n.querySelectorAll('a[href]')) {
          const u = parse(a.href);
          if (u) return { anchor: a, username: u };
        }
      }
      return null;
    },

    // ArrowDown لتخطي الريل، مع تمرير احتياطي
    pressArrowDown(fromEl) {
      const opts = { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true };
      const target = document.activeElement && document.activeElement !== document.body
        ? document.activeElement : document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', opts));
      target.dispatchEvent(new KeyboardEvent('keyup', opts));

      const before = fromEl?.getBoundingClientRect().top;
      setTimeout(() => {
        if (!fromEl || fromEl.getBoundingClientRect().top !== before) return;
        for (let n = fromEl.parentElement; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) {
            n.scrollBy({ top: n.clientHeight, behavior: 'smooth' });
            return;
          }
        }
        window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
      }, 600);
    },
  };

  window.NoHabal = { register: start, utils, toast };
})();
