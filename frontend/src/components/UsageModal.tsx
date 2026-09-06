import { useEffect, useState } from 'react'
import { api } from '../api'

interface Usage {
  username: string; download_mb: number; upload_mb: number; total_mb: number; sessions: number; last_session: string | null
  daily_used_mb: number; monthly_used_mb: number
  daily_quota_mb: number | null; monthly_quota_mb: number | null; bonus_quota_mb: number
  fup_behavior: string | null; quota_locked: boolean; fup_active: boolean
}

const fmtData = (mb: number) =>
  mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : (mb < 10 ? mb.toFixed(2) : Math.round(mb).toString()) + ' MB'
const gb = (mb: number) => +(mb / 1024).toFixed(1)

/** Per-subscriber usage view (download/upload chart, day/month totals, quota bars). Shared by
 *  the Subscribers and Online pages — one place to evolve the usage UI. */
export default function UsageModal({ subId, username, onClose }: { subId: string; username: string; onClose: () => void }) {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let ok = true
    setLoading(true)
    api.get(`/subscribers/${subId}/usage`)
      .then((r) => { if (ok) setUsage(r.data) })
      .catch(() => { if (ok) setUsage(null) })
      .finally(() => { if (ok) setLoading(false) })
    return () => { ok = false }
  }, [subId])

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal usage-modal" onClick={(e) => e.stopPropagation()}>
        <h2>الاستهلاك — {username}</h2>
        {loading && <p className="muted" style={{ textAlign: 'center', padding: '24px 0' }}>جارٍ التحميل…</p>}
        {!loading && usage && (() => {
          return (
            <>
              {usage.total_mb === 0 ? (
                <p className="muted usage-empty">
                  لا يوجد استهلاك مُسجّل بعد.<br />
                  ستظهر كمية التنزيل والرفع هنا فور مرور بيانات المشترك عبر راوتر حقيقي (من جدول radacct).
                </p>
              ) : (
                <div className="usage-chart">
                  {(() => {
                    // حلقة بدل عمودين: العمودان يُظهران المقدارين ولا يُظهران النسبة بينهما،
                    // وهي أوّل ما يُقرأ في الاستهلاك — تنزيل غالب أم رفع غير معتاد.
                    const R = 54, C = 2 * Math.PI * R
                    const dlF = usage.download_mb / usage.total_mb
                    const ulF = usage.upload_mb / usage.total_mb
                    // فجوة بلون السطح بين القوسين حتى لا يلتحما ويبدوا قوساً واحداً.
                    const GAP = dlF > 0 && ulF > 0 ? 3 : 0
                    const dlLen = Math.max(0, C * dlF - GAP)
                    const ulLen = Math.max(0, C * ulF - GAP)
                    const pct = (f: number) => (f * 100 < 1 && f > 0 ? '<1' : Math.round(f * 100)) + '%'
                    return (
                      <>
                        <div className="udonut">
                          <svg viewBox="0 0 140 140" role="img"
                            aria-label={`التنزيل ${pct(dlF)} والرفع ${pct(ulF)} من إجمالي ${fmtData(usage.total_mb)}`}>
                            <circle className="udonut-track" cx="70" cy="70" r={R} fill="none" strokeWidth="18" />
                            <circle className="udonut-dl" cx="70" cy="70" r={R} fill="none" strokeWidth="18"
                              strokeDasharray={`${dlLen} ${C - dlLen}`} strokeDashoffset={GAP / 2} />
                            <circle className="udonut-ul" cx="70" cy="70" r={R} fill="none" strokeWidth="18"
                              strokeDasharray={`${ulLen} ${C - ulLen}`} strokeDashoffset={-(C * dlF) + GAP / 2} />
                          </svg>
                          <div className="udonut-mid">
                            <b>{fmtData(usage.total_mb)}</b>
                            <span>الإجمالي</span>
                          </div>
                        </div>
                        <ul className="udonut-key">
                          <li>
                            <i className="k dl" />
                            <span>التنزيل</span>
                            <b>{fmtData(usage.download_mb)}</b>
                            <em>{pct(dlF)}</em>
                          </li>
                          <li>
                            <i className="k ul" />
                            <span>الرفع</span>
                            <b>{fmtData(usage.upload_mb)}</b>
                            <em>{pct(ulF)}</em>
                          </li>
                        </ul>
                      </>
                    )
                  })()}
                </div>
              )}
              <div className="usage-stats">
                <div><span>التنزيل (إجمالي)</span><b>{fmtData(usage.download_mb)}</b></div>
                <div><span>الرفع (إجمالي)</span><b>{fmtData(usage.upload_mb)}</b></div>
                <div><span>الجلسات</span><b>{usage.sessions}</b></div>
              </div>
              <div className="usage-stats" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: 10 }}>
                <div><span>اليوم (منذ 12 منتصف الليل)</span><b>{fmtData(usage.daily_used_mb)}</b></div>
                <div><span>هذا الشهر</span><b>{fmtData(usage.monthly_used_mb)}</b></div>
              </div>
              {usage.daily_quota_mb ? (
                <div className="quota-box">
                  <div className="quota-head"><span>الحصة اليومية</span><b dir="ltr">{fmtData(usage.daily_used_mb)} / {fmtData(usage.daily_quota_mb)}</b></div>
                  <div className="quota-bar"><div className="quota-fill" style={{ width: Math.min(100, (usage.daily_used_mb / usage.daily_quota_mb) * 100) + '%' }} /></div>
                </div>
              ) : null}
              {usage.monthly_quota_mb ? (() => {
                const eff = Number(usage.monthly_quota_mb) + (Number(usage.bonus_quota_mb) || 0)
                return (
                  <div className="quota-box">
                    <div className="quota-head">
                      <span>الحصة الشهرية{usage.bonus_quota_mb ? ` (+${gb(usage.bonus_quota_mb)}GB مشحون)` : ''}</span>
                      <b dir="ltr">{fmtData(usage.monthly_used_mb)} / {fmtData(eff)}</b>
                    </div>
                    <div className="quota-bar">
                      <div className={'quota-fill' + (usage.quota_locked ? ' over' : '')}
                        style={{ width: Math.min(100, (usage.monthly_used_mb / eff) * 100) + '%' }} />
                    </div>
                    {(usage.quota_locked || usage.fup_active) && (
                      <div className="quota-state">
                        {usage.quota_locked ? '⛔ محظور — تجاوز الحصة الشهرية' : '🐢 مخفّض السرعة (FUP) — تجاوز الحصة'}
                      </div>
                    )}
                  </div>
                )
              })() : null}
            </>
          )
        })()}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>إغلاق</button>
        </div>
      </div>
    </div>
  )
}
