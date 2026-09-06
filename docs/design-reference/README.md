# NetCore RADIUS — Design Reference (RadNas spec)

٣٠ لقطة (`radnas-ref-01..30`) تمثّل الجولة الكاملة في NetCore RADIUS، وهي المواصفة التي نبني RadNas عليها.

## الشاشات/الميزات المرصودة
1. **Login** — لوحة المزوّد، دخول owner، تبديل عربي/English.
2. **Dashboard** — بطاقات: إجمالي المشتركين، النشطون، غير متصل، المتصلون الآن (PPPoE/Hotspot)، المعطّلون، المنتهون، الباقات، المدراء/الموزّعون؛ جداول المتصلين الآن.
3. **Subscribers** — قائمة + فلاتر (مدفوع/غير مدفوع/معطّل/منتهي/متصل/تجاوز الحد/مخفّض السرعة/الأعلى استهلاكاً)؛ إجراءات جماعية (Set Expiry, Expire, Delete, Disable, Disconnect, Renew, Extend, Unlock MAC)؛ CSV استيراد/تصدير؛ أعمدة (username, name, phone, address, plan, reseller, IP, MAC, status, expiry, paid, last-active, quota).
4. **Plan create/edit** — الاسم، السعر، سعر التصفير اليومي، سرعة تنزيل/رفع، المدة+الوحدة، حصة يومية/شهرية، mikrotik pool + expired pool، ساعات مجانية، سرعة مفتوحة (burst)، FUP (تخفيض بعد الحصة + سلوك)، سماح بالتجاوز الشهري.
5. **Hotspot** — كروت/دفعات (batches)، توليد دفعة، طباعة، عدّادات (إجمالي/غير مستخدم/نشط/منتهي/متصل)، إيرادات.
6. **Managers/Resellers** — شجرة موزّعين (parent)، رصيد، نقاط، أسعار لكل موزّع، تحويل رصيد/نقاط/مستخدمين، Withdraw، login-as (impersonate)، تعديل/حذف/تفعيل.
7. **Invoices** — رقم، تاريخ، مشترك، موزّع، وصف، مبلغ، حالة؛ فلاتر؛ تحديد جماعي؛ إضافة دفعة؛ View/Print.
8. **Transactions (ledger)** — مبلغ، نوع (charge/commission)، اتجاه (صادر لموزّع)، ملاحظة، تاريخ، نقاط.
9. **NAS/Routers** — shortname, IP, type, service, API, secret, description؛ زر «إعادة تشغيل FreeRADIUS».
10. **Interfaces** — مراقبة bandwidth حيّة لكل منفذ + per-user PPP sessions.
11. **Network monitoring** — طوبولوجيا، أجهزة، وصلات فعّالة/متدهورة/مقطوعة، متوسط الاستجابة، Live Traffic، اكتشاف.
12. **Router Logs** — سجلّات لكل NAS حسب topic.
13. **WireGuard** — Server tunnel IP + Endpoint؛ Add Peer (name, type=mikrotik, MikroTik Public Key, Link to NAS)؛ Last handshake.
14. **L2TP/IPsec** — بديل اختياري لكل NAS (نقطة اتصال + IPsec key).
15. **Reports** — منتهٍ خلال 7 أيام، إيراد الشهر، إيراد آخر 12 شهر، رسم شهري، فوترة الموزّعين.
16. **Subscriber portal** — `/portal/login` لعرض حساب المشترك.
17. **Settings** — المنطقة الزمنية، وقت انتهاء ثابت + تطبيق جماعي، MAC auto-lock، تحويل المنتهين لـ expiry pool (Framed-Pool).
18. **Telegram** — bot token، Polling/Webhook، admin chat IDs، تنبيهات (انتهاء خلال 3 أيام، منتهي، بلوغ الحصة اليومية/الشهرية، NAS down/recovers).
19. **Audit log** — من قام بالإجراء، الهدف، النوع (subscriber.create/update/delete/change_plan/quota_reset، manager.impersonate.start/stop، bulk_renew)، IP، الوقت.
20. **Backups** — نسخة يومية تلقائية 03:00 (DB + إعداد FreeRADIUS)، الاحتفاظ بآخر 14، تنزيل.
21. **License** — الباقة (Pro)، عدّاد المشتركين/الموزّعين، تاريخ الانتهاء، ID.
22. **System updates** — الإصدار الحالي، فحص/تطبيق تلقائي موقّع، سجلّ النشاط.

> ملاحظة: النظام الأصلي مبني على **Laravel/PHP** (ظهر `php artisan` في شاشة التحديثات). نعيد بناءه بـ **Fastify + PostgreSQL + React**.
