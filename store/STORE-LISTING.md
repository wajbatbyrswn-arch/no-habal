# NO HABAL — بيانات النشر على Chrome Web Store

انسخ كل قسم إلى الخانة المقابلة في لوحة المطوّر:
https://chrome.google.com/webstore/devconsole

---

## الملف المرفوع (Package)

`dist/no-habal-1.0.0.zip`

## Store listing

**Name:** NO HABAL

**Summary (حد أقصى 132 حرفاً):**

> إخفاء الحسابات التافهة على إنستغرام وفيسبوك وتيك توك وX وريدت بقائمة جماعية يبنيها المستخدمون.

**Category:** Social & Communication

**Language:** Arabic (العربية)

**Description (الوصف الكامل):**

```
NO HABAL ⛔ — نظّف صفحاتك من المحتوى التافه

إضافة تخفي حسابات المحتوى التافه على Instagram وFacebook وTikTok وX وReddit، اعتماداً على قائمة جماعية يبنيها المستخدمون أنفسهم.

✦ كيف تعمل؟
• بجانب اسم كل حساب يظهر علم أخضر صغير. اضغطه للإبلاغ، فيختفي الحساب من صفحاتك فوراً.
• عندما يصل الحساب إلى عدد كافٍ من البلاغات من مستخدمين مختلفين، يُعتمد ويختفي عند جميع مستخدمي الإضافة.
• أخطأت؟ زر "تراجع" يظهر مباشرة بعد الإبلاغ.

✦ المزايا
• إخفاء فوري للمنشورات والتغريدات.
• تخطّي الريلز وفيديوهات TikTok المحظورة تلقائياً مع كتم صوتها.
• قوائم منفصلة لكل منصة.
• سريعة: القائمة محفوظة على جهازك، ولا تتصل بالإنترنت عند كل منشور.
• حظر فعلي تلقائي على Instagram (اختياري ومطفأ افتراضياً): يحظر الحسابات المعتمدة من حسابك تدريجياً بحد أقصى 35 يومياً، فتختفي عنك في الهاتف أيضاً.

✦ الخصوصية
• لا نطلب تسجيل دخول، ولا نجمع اسمك أو بريدك أو سجل تصفحك.
• نستخدم معرّفاً عشوائياً فقط لمنع تكرار البلاغات.

سياسة الخصوصية: https://wajbatbyrswn-arch.github.io/no-habal-admin/privacy.html
```

**English description (اختياري، لإضافة لغة ثانية):**

```
NO HABAL hides low-quality accounts on Instagram, Facebook, TikTok, X and Reddit using a community-built list.
Flag an account with one click to hide it instantly for you; once enough different users report it, it is hidden for everyone.
Includes undo, separate lists per platform, auto-skipping and muting of blocked reels/videos, and an optional (off by default)
gradual auto-block on Instagram (max 35/day). No login, no personal data, no tracking.
```

## الصور المطلوبة

| النوع | المقاس | ملاحظات |
|---|---|---|
| أيقونة المتجر | 128×128 | `extension/icons/icon128.png` (جاهزة) |
| لقطات شاشة | 1280×800 أو 640×400 | من 1 إلى 5 صور: زر العلم على منشور، رسالة الإبلاغ، نافذة الإضافة، ريل مغطّى |
| صورة ترويجية صغيرة | 440×280 | اختيارية |

## Privacy practices (تبويب الخصوصية)

**Single purpose:**

> Hide posts and videos from accounts on a community-maintained list on Instagram, Facebook, TikTok, X and Reddit, and let users report accounts to that list.

**Permission justifications:**

| الصلاحية | التبرير (بالإنجليزية كما يطلبها المتجر) |
|---|---|
| `storage` | Stores the approved account lists, the user's own reports, settings and hidden-post counters locally. |
| `alarms` | Refreshes the community list every 30 minutes and runs the optional, rate-limited auto-block queue. |
| Host: `bohiqxxispuwipmfijgn.supabase.co` | The extension's own backend: downloads the approved list and submits/withdraws reports. |
| Content scripts on instagram.com, facebook.com, tiktok.com, x.com, twitter.com, reddit.com | Reads author usernames on the page to hide listed accounts and to add the report button. Page content is processed locally and never sent. |

**Remote code:** No, I am not using remote code.

**Data usage — ضع علامة على:**

- ☑ *Website content* — لا. (المحتوى يُعالَج محلياً ولا يُرسل.)
- ☑ *User activity* — نعم: البلاغات (اسم الحساب المُبلَّغ عنه) ووقت آخر استخدام.
- كل ما عدا ذلك: لا.

**Certify:**
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases.
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:**
https://wajbatbyrswn-arch.github.io/no-habal-admin/privacy.html

## Distribution

- **Visibility:** Public (أو Unlisted للتجربة أولاً مع رابط مباشر)
- **Regions:** All regions

---

## تحديث الإضافة لاحقاً

1. ارفع رقم `version` في `extension/manifest.json` (مثلاً 1.0.1).
2. أعد إنشاء ملف zip.
3. Package → Upload new package → Submit for review.
