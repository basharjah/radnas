# radnas — ISP Subscriber & RADIUS Management Platform

منصّة إدارة مشتركي مزوّدي الإنترنت (نظير NetCore RADIUS): لوحة تحكّم متعددة المستأجرين (نظام موزّعين) فوق FreeRADIUS، مع إدارة الباقات، الفوترة، الهوت سبوت، والتحكّم بالراوترات عبر WireGuard + RADIUS CoA.

## Stack
- **Backend:** Node.js + Fastify + TypeScript
- **Database:** PostgreSQL
- **Frontend:** React (Vite) — *يُضاف في المرحلة التالية*
- **RADIUS:** FreeRADIUS (SQL backend)
- **Router control:** WireGuard tunnels + RADIUS CoA/Disconnect

## Structure
```
radnas/
  backend/                 Fastify API + DB migrations
    src/
      routes/              مسارات الـ API
      db/                  اتصال + migrations runner + seed
    db/migrations/         ملفات SQL للمخطط
  frontend/                تطبيق React (قريباً)
  docs/
    design-reference/      لقطات NetCore المرجعية = المواصفة
```

## Getting started (backend)
```bash
cd backend
cp .env.example .env        # عدّل DATABASE_URL و JWT_SECRET
npm install
npm run migrate             # ينشئ الجداول
npm run seed                # ينشئ owner + باقات تجريبية
npm run dev                 # API على http://localhost:4000
```
تحقّق: `GET http://localhost:4000/health` و `GET /health/db`.

## Roadmap (phased)
- [x] **P0** — أساس المشروع + مخطط قاعدة البيانات + فحوصات الصحة
- [ ] **P1** — مصادقة JWT + لوحة المعلومات + إدارة المشتركين
- [ ] **P2** — الباقات + شجرة الموزّعين + الفوترة + الحركات المالية
- [ ] **P3** — تكامل FreeRADIUS الحيّ + أجهزة NAS + الهوت سبوت
- [ ] **P4** — WireGuard + CoA/Disconnect (الحلقة الحرجة) + المراقبة الحيّة
- [ ] **P5** — تيليجرام + التدقيق + النسخ الاحتياطي + التقارير + بوابة المشترك
- [ ] **P6** — التوسّع (تقسيم radacct) + الجاهزية العالية
