import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

/**
 * Continuous ping tool, shared by the Subscribers and Online pages.
 *
 * The loop is frontend-driven (recursive setTimeout, not setInterval) so a slow reply can never
 * stack up requests. Options are mirrored into refs because pingTick re-schedules itself: reading
 * state through its closure would freeze the values at start time, and both fields stay editable
 * while a run is in progress.
 */
interface Props {
  username: string
  /** Prefill: the live session IP, falling back to a static one. */
  ip: string | null
  onClose: () => void
}

interface Entry { seq: number; ms: number | null; ok: boolean; bytes: number }

const clampSize = (v: string) => Math.min(65500, Math.max(1, Math.floor(Number(v) || 56)))
const clampEvery = (v: string) => Math.min(60000, Math.max(200, Math.floor(Number(v) || 1000)))

export default function PingModal({ username, ip, onClose }: Props) {
  const [pingIp, setPingIp] = useState(ip || '')
  // Strings, not numbers: a bare number input turns '' into 0, which makes clearing-then-retyping
  // practically impossible on a phone.
  const [size, setSize] = useState('1000')
  const [every, setEvery] = useState('1000')
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<Entry[]>([])
  const [err, setErr] = useState('')

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const active = useRef(false)
  const seqRef = useRef(0)
  const ipRef = useRef(pingIp)
  const sizeRef = useRef(1000)
  const everyRef = useRef(1000)
  ipRef.current = pingIp
  sizeRef.current = clampSize(size)
  everyRef.current = clampEvery(every)

  function stop() {
    active.current = false
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setRunning(false)
  }
  useEffect(() => () => stop(), []) // clear the timer if the modal unmounts mid-run

  async function tick() {
    if (!active.current) return
    const seq = ++seqRef.current
    const bytes = sizeRef.current
    const started = Date.now()
    try {
      const r = await api.get('/radius/ping', { params: { ip: ipRef.current.trim(), size: bytes } })
      // Echo the size the SERVER pinged with, so the log proves the option was applied.
      setLog((l) => [{ seq, ms: r.data.reachable ? r.data.ms : null, ok: !!r.data.reachable, bytes: Number(r.data.size) || bytes }, ...l].slice(0, 100))
    } catch {
      setLog((l) => [{ seq, ms: null, ok: false, bytes }, ...l].slice(0, 100))
    }
    if (active.current) {
      // Subtract the round-trip so the period IS the chosen interval, not interval + request time.
      timer.current = setTimeout(tick, Math.max(0, everyRef.current - (Date.now() - started)))
    }
  }
  function start() {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(pingIp.trim())) { setErr('IP غير صالح'); return }
    setErr(''); setLog([]); seqRef.current = 0; active.current = true; setRunning(true)
    tick()
  }
  function close() { stop(); onClose() }

  const sent = log.length
  const recv = log.filter((x) => x.ok).length
  const loss = sent ? Math.round(((sent - recv) / sent) * 100) : 0
  const times = log.filter((x) => x.ok && x.ms != null).map((x) => x.ms as number)
  const avg = times.length ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10 : 0
  const min = times.length ? Math.min(...times) : 0
  const max = times.length ? Math.max(...times) : 0
  const spark = times.slice(0, 20).reverse()

  return (
    <div className="modal-back" onClick={close}>
      <div className="modal usage-modal ping-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Ping — {username}</h2>
        <div className="ping-form">
          <div className="full">
            <label>IP</label>
            <input value={pingIp} onChange={(e) => setPingIp(e.target.value)} disabled={running} dir="ltr" />
          </div>
          {/* Both stay enabled while pinging — tick reads them through refs, so a change takes
              effect on the very next packet. Blur normalises to the accepted range. */}
          <div>
            <label title="1–65500 bytes">Packet Size</label>
            <input type="text" inputMode="numeric" dir="ltr" value={size} title="1–65500"
              onChange={(e) => setSize(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={() => setSize(String(clampSize(size)))} />
          </div>
          <div>
            <label title="200–60000 ms">Interval (ms)</label>
            <input type="text" inputMode="numeric" dir="ltr" value={every} title="200–60000"
              onChange={(e) => setEvery(e.target.value.replace(/[^\d]/g, ''))}
              onBlur={() => setEvery(String(clampEvery(every)))} />
          </div>
          <div className="full">
            {!running
              ? <button type="button" className="btn-primary" onClick={start}>▶ بدء</button>
              : <button type="button" className="btn-primary danger" onClick={stop}>■ إيقاف</button>}
          </div>
        </div>

        {err && <div className="error">{err}</div>}

        <div className="usage-stats" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <div><span>مُرسَل</span><b dir="ltr">{sent}</b></div>
          <div><span>مُستقبَل</span><b dir="ltr">{recv}</b></div>
          <div><span>الفقد</span><b dir="ltr" className={loss > 0 ? 'neg' : ''}>{loss}%</b></div>
        </div>
        <div className="usage-stats" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <div><span>المتوسط</span><b dir="ltr">{avg} ms</b></div>
          <div><span>الأدنى</span><b dir="ltr">{min} ms</b></div>
          <div><span>الأقصى</span><b dir="ltr">{max} ms</b></div>
        </div>

        {spark.length > 1 && (() => {
          const W = 320, H = 40, mx = Math.max(...spark, 1)
          const pts = spark.map((v, i) => `${((i / (spark.length - 1)) * W).toFixed(1)},${(H - (v / mx) * (H - 5) - 2).toFixed(1)}`).join(' ')
          return <svg viewBox={`0 0 ${W} ${H}`} className="ping-spark" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" /></svg>
        })()}

        <label className="ping-log-label">النتائج المباشرة {running && <span className="live-dot" />}</label>
        <div className="ping-log">
          {log.length === 0
            ? <p className="muted" style={{ textAlign: 'center', padding: '22px 14px' }}>{running ? 'جارٍ الفحص…' : 'اضبط الخيارات ثم اضغط «بدء»'}</p>
            : log.map((x) => (
              <div key={x.seq} className={'ping-row ' + (x.ok ? 'ok' : 'fail')} dir="ltr">
                {/* Compact on purpose: "N bytes from <ip>:" pushed the time off the right edge on a
                    phone. The IP is in the field above and cannot change mid-run. */}
                {x.ok ? `seq=${x.seq} · ${x.bytes}B · ${x.ms ?? '?'} ms` : `seq=${x.seq} · ${x.bytes}B · ✕ timeout`}
              </div>
            ))}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={close}>إغلاق</button>
        </div>
      </div>
    </div>
  )
}
