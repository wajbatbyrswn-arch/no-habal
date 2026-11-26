/* NO HABAL — Reddit adapter
 * - الواجهة الجديدة: المنشور <shreddit-post author="...">، التعليق <shreddit-comment author="...">
 *   (الاسم صفة على العنصر؛ الواجهة تستخدم shadow DOM لذا نزرع الزر داخل شريط المعلومات slot="credit-bar")
 * - الواجهة القديمة (old.reddit.com): عناصر .thing[data-author] وروابط a.author
 * - الملف الشخصي: /user/<name>/ أو /u/<name>/
 */
(() => {
  'use strict';

  // مسارات ليست أسماء مستخدمين
  const RESERVED = new Set([
    'r', 'user', 'u', 'home', 'popular', 'all', 'settings', 'messages', 'submit', 'search',
    'top', 'new', 'hot', 'rising', 'best', 'comments', 'mod', 'admin', 'about', 'help',
    'wiki', 'report', 'share', 'saved', 'hidden', 'upvoted', 'downvoted', 'history',
    'submitted', 'overview', 'posts', 'news', 'explore', 'chat', 'inbox', 'premium', 'me',
  ]);
  const USERNAME_RE = /^[a-z0-9_-]{2,20}$/;
  const AD_SELECTOR = 'shreddit-ad-post, shreddit-comment-tree-ad, shreddit-comments-page-ad, [promoted]';

  function cleanUser(raw) {
    let u;
    try { u = decodeURIComponent(String(raw || '')).toLowerCase(); } catch { return null; }
    return USERNAME_RE.test(u) && !RESERVED.has(u) ? u : null;
  }

  function parseProfile(href) {
    let url;
    try { url = new URL(href, location.origin); } catch { return null; }
    if (!/(^|\.)reddit\.com$/.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2 || !/^(user|u)$/i.test(parts[0])) return null;
    return cleanUser(parts[1]);
  }

  // في صفحة المستخدم المسار قد يمتد: /user/foo/comments/... إلخ
  const profileUser = () => parseProfile(location.pathname);

  const isAd = (el) => Boolean(el.closest?.(AD_SELECTOR) || el.hasAttribute?.('promoted'));

  // الواجهة الجديدة قد تعيد تدوير عناصر القائمة؛ لا نُبقي element مخفياً لمستخدم آخر
  function guardRecycled(container, username) {
    if (container?.classList.contains('nh-hidden') && container.dataset.nhUser !== username) {
      container.classList.remove('nh-hidden');
      delete container.dataset.nhUser;
    }
  }

  // علامة غير مرئية نضعها قبل العنصر حين لا يوجد رابط اسم داخل DOM العادي
  // (الواجهة الجديدة تعرض معظم المحتوى عبر shadow DOM، والزر يُحقن بعد هذه العلامة)
  function marker(host, before, username, cls) {
    let el = host.querySelector(`:scope > .${cls}[data-nh-user="${username}"]`);
    if (!el) {
      el = document.createElement('span');
      el.className = cls;
      el.dataset.nhUser = username;
      el.hidden = true;
      host.insertBefore(el, before);
    }
    return el;
  }

  function postAnchor(post, username) {
    // شريط المعلومات داخل شريدت بوست: نضع الزر فيه ونطلب إسقاطه في نفس الـ slot
    const slot = [...post.children].find((el) =>
      ['credit-bar', 'author'].includes(el.getAttribute('slot')));
    if (slot) return { anchor: slot, btnSlot: slot.getAttribute('slot') };

    // روابط /user/ نادرة في الواجهة الجديدة، لكنها موجودة في بعض القوالب
    const link = [...post.querySelectorAll('a[href]')].find((a) =>
      parseProfile(a.getAttribute('href')) === username);
    if (link) return { anchor: link };

    const host = post.parentElement;
    return host ? { anchor: marker(host, post, username, 'nh-reddit-anchor') } : null;
  }

  function commentAnchor(comment, username) {
    const meta = comment.querySelector(':scope [slot="commentMeta"]');
    const link = meta && [...meta.querySelectorAll('a[href]')].find((a) =>
      parseProfile(a.getAttribute('href')) === username);
    if (link) return { anchor: link };
    return { anchor: marker(comment, comment.firstChild, username, 'nh-reddit-anchor') };
  }

  function thingAnchor(thing, username) {
    const link = [...thing.querySelectorAll('a.author[href], a[href]')].find((a) =>
      parseProfile(a.getAttribute('href')) === username);
    if (link) return { anchor: link };
    const entry = thing.querySelector(':scope > .entry') || thing;
    return { anchor: marker(entry, entry.firstChild, username, 'nh-reddit-anchor') };
  }

  const adapter = {
    platform: 'reddit',

    scanPosts() {
      const items = [];

      for (const post of document.querySelectorAll('shreddit-post[author]')) {
        if (isAd(post)) continue;
        const username = cleanUser(post.getAttribute('author'));
        if (!username) continue;
        const container = post.closest('article[data-post-id]') || post;
        guardRecycled(container, username);
        const a = postAnchor(post, username);
        if (a) items.push({ container, username, ...a });
      }

      for (const comment of document.querySelectorAll('shreddit-comment[author]')) {
        if (isAd(comment)) continue;
        const username = cleanUser(comment.getAttribute('author'));
        if (!username) continue;
        guardRecycled(comment, username);
        const a = commentAnchor(comment, username);
        if (a) items.push({ container: comment, username, ...a });
      }

      for (const thing of document.querySelectorAll('.thing[data-author]')) {
        const username = cleanUser(thing.getAttribute('data-author'));
        if (!username) continue;
        guardRecycled(thing, username);
        const a = thingAnchor(thing, username);
        if (a) items.push({ container: thing, username, ...a });
      }

      return items;
    },

    profile() {
      const username = profileUser();
      if (!username) return null;

      let anchor = [...document.querySelectorAll('h1, h2, shreddit-profile-title, [data-testid="user-profile-nickname"]')]
        .find((el) => el.textContent.trim().toLowerCase().includes(username));
      if (!anchor) {
        anchor = [...document.querySelectorAll('a[href]')].find((a) =>
          parseProfile(a.getAttribute('href')) === username && a.textContent.trim() && !a.querySelector('img'));
      }
      if (!anchor) {
        const host = document.querySelector('main, shreddit-app') || document.body;
        anchor = marker(host, host.firstChild, username, 'nh-reddit-profile-anchor');
      }
      return { username, anchor };
    },
  };

  NoHabal.register(adapter);
})();
