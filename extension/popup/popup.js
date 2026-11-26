/* NO HABAL — Popup: إحصائيات + مفاتيح التشغيل */
(() => {
  'use strict';
  // Firefox: واجهة browser تعيد Promises؛ Chrome/Edge: chrome
  const chrome = globalThis.browser ?? globalThis.chrome;

  const $ = (id) => document.getElementById(id);
  const send = (msg) => chrome.runtime.sendMessage(msg);
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  function ago(ts) {
    if (!ts) return null;
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'الآن';
    const m = Math.round(s / 60);
    if (m < 60) return `قبل ${m} دقيقة`;
    const h = Math.round(m / 60);
    if (h < 24) return `قبل ${h} ساعة`;
    return `قبل ${Math.round(h / 24)} يوم`;
  }

  const ERRORS = {
    timeout: 'لم تكتمل العملية في الوقت المحدد',
    options_button_not_found: 'لم يُعثر على زر الخيارات في صفحة الحساب',
    block_menu_item_not_found: 'لم يُعثر على خيار "حظر"',
    confirm_button_not_found: 'لم يُعثر على زر تأكيد الحظر',
    unblock_button_not_seen: 'لم يتأكد نجاح الحظر',
    wrong_profile: 'فُتحت صفحة حساب مختلف',
  };

  function blockStateText(b, s) {
    if (!s.autoBlock) return 'متوقف';
    if (!s.enabled) return 'متوقف (الإخفاء مطفأ)';
    if (b.running) return `يحظر @${b.running}…`;
    const now = Date.now();
    if (b.count >= b.cap) return 'اكتمل حد اليوم';
    if (b.cooldown_until > now) {
      return `استراحة بعد أخطاء · ${Math.ceil((b.cooldown_until - now) / 60000)} د`;
    }
    if (!b.queue) return 'لا يوجد حسابات للحظر';
    if (b.next_at > now) return `التالي بعد ${Math.ceil((b.next_at - now) / 1000)} ث`;
    return 'بانتظار تبويب Instagram نشط';
  }

  function render(d) {
    const s = d.settings;
    $('enabled').checked = s.enabled !== false;
    $('autoBlock').checked = Boolean(s.autoBlock);

    const pill = $('status-pill');
    pill.textContent = s.enabled !== false ? 'يعمل' : 'متوقف';
    pill.classList.toggle('on', s.enabled !== false);

    $('hidden-total').textContent = fmt(d.stats.hidden_total);
    $('mine-total').textContent = fmt(Object.values(d.mine).reduce((a, b) => a + b, 0));
    $('list-instagram').textContent = fmt(d.lists.instagram);
    $('list-facebook').textContent = fmt(d.lists.facebook);
    $('list-tiktok').textContent = fmt(d.lists.tiktok);
    $('list-x').textContent = fmt(d.lists.x);
    $('list-reddit').textContent = fmt(d.lists.reddit);

    const b = d.block;
    $('block-panel').classList.toggle('hidden', !s.autoBlock);
    $('block-count').textContent = b.count;
    $('block-cap').textContent = b.cap;
    $('block-bar').style.width = `${Math.min(100, (b.count / b.cap) * 100)}%`;
    $('block-queue').textContent = fmt(b.queue);
    $('block-state').textContent = blockStateText(b, s);
    $('block-total').textContent = fmt(b.total);
    $('block-last').textContent = b.last_blocked
      ? `@${b.last_blocked.username} · ${ago(b.last_blocked.at)}` : '—';

    const err = $('block-error');
    if (b.last_error && s.autoBlock) {
      err.textContent = `آخر خطأ مع @${b.last_error.username}: ${ERRORS[b.last_error.error] || b.last_error.error}`;
      err.classList.remove('hidden');
    } else {
      err.classList.add('hidden');
    }

    $('synced').textContent = d.synced_at ? `آخر مزامنة ${ago(d.synced_at)}` : 'لم تتم المزامنة بعد';
  }

  async function refresh() {
    try {
      const res = await send({ type: 'status' });
      if (res?.ok) render(res.data);
    } catch (e) {
      console.error(e);
    }
  }

  $('enabled').addEventListener('change', async (e) => {
    await send({ type: 'setSettings', enabled: e.target.checked });
    refresh();
  });

  $('autoBlock').addEventListener('change', async (e) => {
    await send({ type: 'setSettings', autoBlock: e.target.checked });
    refresh();
  });

  $('sync-btn').addEventListener('click', async () => {
    const btn = $('sync-btn');
    btn.disabled = true;
    btn.textContent = 'جارٍ المزامنة…';
    const res = await send({ type: 'sync' }).catch(() => null);
    btn.disabled = false;
    btn.textContent = res?.ok ? 'تمت ✓' : 'تعذّرت المزامنة';
    setTimeout(() => { btn.textContent = 'مزامنة الآن'; }, 2000);
    refresh();
  });

  refresh();
  setInterval(refresh, 1500);
})();
