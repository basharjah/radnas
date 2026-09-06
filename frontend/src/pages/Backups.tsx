import { useEffect, useState } from 'react'
import { api } from '../api'
import { dt } from '../format'
import { useAuth } from '../auth'

interface Backup { name: string; size: number; created_at: string }

export default function Backups() {
  const { user } = useAuth()
  const isOwner = user?.role === 'owner'
  const [rows, setRows] = useState<Backup[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = () => api.get('/backups').then((r) => setRows(r.data.data))
  useEffect(() => { load() }, [])

  async function create() {
    setBusy(true); setMsg('')
    try {
      const r = await api.post('/backups')
      setMsg('أُنشئت نسخة: ' + r.data.name); load()
    } catch (e: any) {
      setMsg('فشل: ' + (e?.response?.data?.hint || e?.response?.data?.error || 'خطأ'))
    }
    setBusy(false); setTimeout(() => setMsg(''), 6000)
  }

  async function download(name: string) {
    const r = await api.get(`/backups/${name}/download`, { responseType: 'blob' })
    const url = URL.createObjectURL(r.data)
    const a = document.createElement('a')
    a.href = url; a.download = name; a.click()
    URL.revokeObjectURL(url)
  }

  const kb = (n: number) => (n / 1024).toFixed(1) + ' KB'

  return (
    <div>
      <div className="page-head row">
        <div><h1>النسخ الاحتياطية</h1><p>{isOwner ? 'نسخة كاملة لقاعدة البيانات (pg_dump)' : 'نسخة من بيانات شركتك (مشتركون/باقات/أجهزة) بصيغة JSON'} — نزّلها واحفظها خارج الخادم</p></div>
        <button className="btn-primary inline" onClick={create} disabled={busy}>{busy ? '…' : 'أخذ نسخة الآن'}</button>
      </div>
      {msg && <div className="notice">{msg}</div>}
      <table className="tbl">
        <thead><tr><th>الملف</th><th>الحجم</th><th>التاريخ</th><th></th></tr></thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.name}>
              <td><code>{b.name}</code></td>
              <td>{kb(b.size)}</td>
              <td>{dt(b.created_at)}</td>
              <td><button className="btn sm" onClick={() => download(b.name)}>تنزيل</button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4} className="empty">لا نسخ بعد</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
