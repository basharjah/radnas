import { useEffect, useState } from 'react'
import { api } from '../api'
import { dt } from '../format'

interface Entry {
  id: number
  performed_by_name: string | null
  action: string
  target_type: string | null
  target_id: string | null
  details: string | null
  ip: string | null
  created_at: string
}

export default function Audit() {
  const [rows, setRows] = useState<Entry[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState('')

  const load = () => api.get('/audit', { params: { q, limit: 100 } }).then((r) => { setRows(r.data.data); setTotal(r.data.total) })
  useEffect(() => { load() }, [])

  return (
    <div>
      <div className="page-head"><h1>سجلّ التدقيق</h1><p>{total} حدث</p></div>
      <div className="toolbar">
        <input placeholder="بحث بالمنفّذ أو الهدف أو التفاصيل…" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
        <button className="btn" onClick={load}>بحث</button>
      </div>
      <table className="tbl">
        <thead><tr><th>الوقت</th><th>المنفّذ</th><th>الإجراء</th><th>الهدف</th><th>التفاصيل</th><th>IP</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>{dt(a.created_at)}</td>
              <td>{a.performed_by_name || '—'}</td>
              <td><span className="role">{a.action}</span></td>
              <td>{a.target_id || '—'}</td>
              <td>{a.details || '—'}</td>
              <td><code>{a.ip || '—'}</code></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="empty">لا أحداث</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
