# NO HABAL — النشر على Firefox وMicrosoft Edge (مجاناً)

قبل الرفع ابنِ الملفات من مجلد المشروع:

```powershell
node scripts/build.mjs
```

يُنتج:

| الملف | لأي متجر |
|---|---|
| `dist/no-habal-firefox-<version>.zip` | Firefox Add-ons |
| `dist/no-habal-chromium-<version>.zip` | Microsoft Edge (وChrome لاحقاً) |

النصوص (الوصف، سبب الصلاحيات، الخصوصية) موجودة في `store/STORE-LISTING.md` وتصلح للمتجرين.

---

## 1. Firefox Add-ons (AMO)

**التسجيل:** مجاني، يحتاج حساب Mozilla فقط.

1. ادخل https://addons.mozilla.org/developers/ وسجّل دخول أو أنشئ حساب Mozilla.
2. اضغط **Submit a New Add-on**.
3. **How to distribute:** اختر **On this site** (حتى تظهر في المتجر).
4. **Upload Version:** ارفع `dist/no-habal-firefox-<version>.zip`.
   - **Compatible platforms:** فعّل Firefox (ويمكن Firefox for Android أيضاً).
5. **Source code:** اختر **No** — الكود غير مضغوط أو مُعالج، فلا يحتاجون نسخة مصدر.
6. **Describe Add-on:**
   - **Name:** NO HABAL
   - **Summary** (حتى 250 حرفاً): انسخ الوصف القصير من `STORE-LISTING.md`.
   - **Description:** انسخ الوصف الكامل.
   - **Categories:** Social & Communication، وPrivacy & Security.
   - **Support website:** https://github.com/wajbatbyrswn-arch/no-habal/issues
   - **License:** All Rights Reserved (أو MIT إذا قررت فتح المصدر).
   - **Privacy Policy:** فعّل الخيار والصق نص سياسة الخصوصية، أو اكتب رابطها:
     https://wajbatbyrswn-arch.github.io/no-habal-admin/privacy.html
7. **Notes to Reviewer** (مهم لتسريع المراجعة):

   ```
   No login is needed. Open instagram.com / facebook.com / tiktok.com / x.com / reddit.com: a small green flag
   appears next to account names; clicking it hides that account locally and sends a report to our
   Supabase backend (bohiqxxispuwipmfijgn.supabase.co). The optional Instagram auto-block is OFF by
   default (popup toggle) and is limited to 35 blocks/day performed through Instagram's own menu.
   No remote code, no minification. Built from https://github.com/wajbatbyrswn-arch/no-habal
   ```
8. اضغط **Submit Version**. المراجعة عادة من يوم إلى أسبوع، ويصلك بريد بالنتيجة.

**رابط الإضافة بعد القبول:** `https://addons.mozilla.org/firefox/addon/no-habal/`

---

## 2. Microsoft Edge Add-ons

**التسجيل:** مجاني، يحتاج حساب Microsoft.

1. ادخل https://partner.microsoft.com/dashboard/microsoftedge/overview
   - أول مرة: **Register** ← Account type: **Individual** ← اكتب اسمك وبلدك ← لا توجد رسوم.
2. اضغط **Create new extension** وارفع `dist/no-habal-chromium-<version>.zip`.
3. **Availability:**
   - Visibility: **Public**
   - Markets: **All markets** (أو اختر الدول العربية).
4. **Properties:**
   - Category: **Social**
   - Privacy policy requirements: **Yes**، والرابط:
     https://wajbatbyrswn-arch.github.io/no-habal-admin/privacy.html
   - Website: https://wajbatbyrswn-arch.github.io/no-habal/
   - Support contact: https://github.com/wajbatbyrswn-arch/no-habal/issues
5. **Store listings** ← أضف لغة **Arabic** (ويمكن English أيضاً):
   - **Description:** الوصف الكامل من `STORE-LISTING.md`.
   - **Short description:** الوصف القصير.
   - **Extension Store logo:** `extension/icons/icon128.png`.
   - **Screenshots** (اختيارية لكن مهمة): 1280×800 أو 640×400.
6. **Submit** ← في خانة **Notes for certification** الصق نفس ملاحظات المراجع أعلاه.
7. المراجعة حتى 7 أيام عمل.

---

## تحديث الإضافة لاحقاً

1. ارفع `version` في `extension/manifest.json`.
2. `node scripts/build.mjs`
3. **Firefox:** صفحة الإضافة ← **Upload New Version**.
   **Edge:** صفحة الإضافة ← **Packages** ← **Replace** ← **Publish**.

المستخدمون في المتجرين تصلهم التحديثات تلقائياً.
