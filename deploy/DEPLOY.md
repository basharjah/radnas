# نشر RadNas على VPS (Rocky Linux 10 + SPanel)

دليل خطوة‑بخطوة لنشر **RadNas** على خادم ScalaHosting.

## الخادم
| | |
|---|---|
| IP | `165.140.158.104` |
| المضيف | `cloud-e8c770.managed-vps.net` |
| المواصفات | 2 vCPU · 4GB RAM · 50GB SSD |
| النظام | Rocky Linux 10 + SPanel |
| منفذ SSH | **6543** (وليس 22) — root + كلمة مرور إيميل الترحيب |
| لوحة SPanel | من Client Area: زر **Log in to SPanel** (دخول تلقائي)، أو `https://165.140.158.104:8443` |

> **ملاحظة SPanel:** SPanel يشغّل Apache على 80/443 ويدير DNS/SSL/الجدار الناري. لا نلغيه — بل نجعل RadNas يعمل خلفه: الواجهة تُخدَّم من `frontend/dist`، والـAPI يُعكَس إلى `127.0.0.1:4000`. خطوة الربط (§7) نُنجزها سويّة بعد الدخول لأنها تعتمد على واجهة SPanel.

ملفات هذه الحزمة:
- `server-setup.sh` — إعداد الخادم (يُشغَّل مرّة كـroot).
- `deploy-app.sh` — بناء وتشغيل التطبيق (يُشغَّل كمستخدم `radnas`).
- `.env.production.example` — قالب متغيّرات البيئة.
- `apache-radnas-proxy.conf.example` — إعداد العكس في Apache.
- `pack.ps1` — تحزيم الشيفرة للرفع (من ويندوز).

---

## §1 — الاتصال بالخادم (SSH)
من ويندوز (PowerShell) — **المنفذ 6543**:
```bash
ssh -p 6543 root@165.140.158.104
```
كلمة مرور root في إيميل الترحيب *"New Cloud VPS"*. إن لم تصلك، اضبطها من SPanel أو عبر دعم ScalaHosting.
> بعد الدخول أول مرّة سنولّد **مفتاح SSH** لأتّصل بأمان بلا كلمة مرور.

## §2 — إعداد الخادم (كـroot)
ارفع `server-setup.sh` أو انسخ محتواه، ثم:
```bash
sudo bash server-setup.sh
```
يثبّت: Node 20+ · pm2 · PostgreSQL 17 · FreeRADIUS · ويضبط firewalld + SELinux + مستخدم `radnas`.

## §3 — قاعدة البيانات
```bash
sudo -u postgres psql -c "CREATE USER radnas WITH PASSWORD 'STRONG_DB_PW';"
sudo -u postgres psql -c "CREATE DATABASE radnas OWNER radnas;"
```
تأكّد أن `pg_hba.conf` يسمح بالدخول المحلي بكلمة مرور (`127.0.0.1/32  scram-sha-256`) ثم:
```bash
sudo systemctl reload postgresql-17
```
(الجداول والبذور تُطبَّق لاحقاً في §6 عبر `npm run migrate` و`npm run seed`.)

## §4 — رفع الشيفرة
على ويندوز:
```bash
powershell -File C:\work\sityx_projects\radnas\deploy\pack.ps1
```
ثم ارفع واستخرج:
```bash
scp C:\work\sityx_projects\radnas\radnas-deploy.tgz radnas@165.140.158.104:/home/radnas/
ssh radnas@165.140.158.104 "mkdir -p ~/app && tar -xzf ~/radnas-deploy.tgz -C ~/app"
```

## §5 — متغيّرات البيئة
```bash
cp ~/app/deploy/.env.production.example ~/app/backend/.env
nano ~/app/backend/.env
```
اضبط: `DATABASE_URL` (كلمة مرور §3) · `JWT_SECRET` (`openssl rand -hex 32`) · `CORS_ORIGIN` (دومينك أو `http://165.140.158.104` مؤقتاً).

## §6 — البناء والتشغيل (كـradnas)
```bash
su - radnas
cd ~/app/deploy && bash deploy-app.sh
```
يثبّت الاعتماديات، يطبّق الـmigrations، يبذر `owner`، يبني الواجهة، ويشغّل الباك عبر pm2 على `:4000`.
لإبقاء pm2 بعد إعادة الإقلاع (كـroot مرّة):
```bash
pm2 startup systemd -u radnas --hp /home/radnas   # نفّذ السطر الذي يطبعه، ثم:  pm2 save
```

## §7 — الربط عبر SPanel (نُنجزها سويّة)
1. في SPanel: أضف دومينك (أو سب‑دومين) ووجّهه للخادم (A‑record → `165.140.158.104`).
2. اضبط جذر الموقع (docroot) على `/home/radnas/app/frontend/dist`.
3. أضف إعداد العكس من `apache-radnas-proxy.conf.example` (عبر "Apache custom configuration" أو نضعه في vhost عبر SSH).
4. أصدر شهادة SSL مجانية (Let's Encrypt) من SPanel للدومين.
> للتجربة السريعة بلا دومين يمكن الوصول مؤقتاً عبر `http://165.140.158.104` (نضبط SPanel لخدمة RadNas على الجذر).

## §8 — الأمان قبل الإطلاق
- غيّر كلمة مرور `owner` من داخل RadNas (الافتراضية `owner12345`).
- `JWT_SECRET` قوي (§5). لا تكشف PostgreSQL للإنترنت (اتصال محلي فقط).
- فعّل النسخ الاحتياطي (نظام pg_dump المدمج في RadNas).

## §9 — المرحلة 2: الأبراج (لاحقاً)
FreeRADIUS مثبَّت مسبقاً. نضبط وحدة SQL لتقرأ نفس قاعدة RadNas (كما في الإثبات المحلي)، ونصل الأبراج عبر **WireGuard**، ونفعّل **CoA** على 3799. نؤجّلها حتى يعمل الويب.

## §10 — تشخيص
```bash
pm2 logs radnas            # سجلّ الباك
pm2 status                 # حالة العملية
sudo systemctl status postgresql-17 firewalld httpd
sudo firewall-cmd --list-all
curl -s http://127.0.0.1:4000/health   # يجب أن يرجع ok
```
