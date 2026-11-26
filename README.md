# NO HABAL ⛔

إضافة متصفح (Manifest V3) تخفي حسابات المحتوى التافه على Instagram وFacebook وTikTok وX وReddit، بقائمة جماعية يبنيها المستخدمون.

**الموقع والتحميل:** https://wajbatbyrswn-arch.github.io/no-habal/

## المجلدات

| المجلد | المحتوى |
|---|---|
| `extension/` | الإضافة: `manifest.json`، و`background/service-worker.js`، و`content/` (محرك الإخفاء ومحوّل لكل منصة)، و`popup/` |
| `supabase/schema.sql` | الجداول، ودوال `submit_report` و`withdraw_report` و`ping_user`، وسياسات RLS |
| `supabase/migrations/` | ترحيلات لمرة واحدة على قاعدة البيانات المنشورة (مثل إضافة منصة Reddit) |
| `docs/` | موقع التحميل (GitHub Pages) |
| `store/` | نصوص النشر على متاجر الإضافات |

لوحة الأدمن في مستودع مستقل: [no-habal-admin](https://github.com/wajbatbyrswn-arch/no-habal-admin).

## التثبيت اليدوي

1. حمّل `no-habal.zip` من [آخر إصدار](https://github.com/wajbatbyrswn-arch/no-habal/releases/latest) وفك ضغطه.
2. افتح `chrome://extensions` وفعّل **Developer mode**.
3. اضغط **Load unpacked** واختر المجلد.

## إصدار نسخة جديدة

1. ارفع `version` في `extension/manifest.json`.
2. أنشئ ملف zip من محتويات `extension/` (الملفات في جذر الأرشيف).
3. أنشئ Release جديداً وارفع الملف باسم `no-habal.zip` حتى يبقى رابط التحميل في الموقع ثابتاً.
