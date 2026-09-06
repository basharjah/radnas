import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { dt } from '../format'

interface Peer {
  id: string
  name: string
  public_key: string
  tunnel_ip: string
  nas_name: string | null
  last_handshake: string | null
}
interface Nas { id: string; shortname: string | null; nasname: string }
interface Server { server_tunnel_ip: string; endpoint: string; server_public_key: string }

export default function WireGuard() {
  const [peers, setPeers] = useState<Peer[]>([])
  const [nas, setNas] = useState<Nas[]>([])
  const [server, setServer] = useState<Server | null>(null)
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ name: '', public_key: '', nas_id: '' })

  const load = async () => {
    setServer((await api.get('/wireguard/server')).data)
    setPeers((await api.get('/wireguard')).data.data)
    setNas((await api.get('/nas')).data.data)
  }
  useEffect(() => { load() }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    await api.post('/wireguard', { name: form.name, public_key: form.public_key, nas_id: form.nas_id || null })
    setShow(false); setForm({ name: '', public_key: '', nas_id: '' }); load()
  }
  async function del(id: string) {
    if (!confirm('حذف هذا النفق؟')) return
    await api.post(`/wireguard/${id}/delete`); load()
  }

  return (
    <div>
      <div className="page-head row">
        <div><h1>WireGuard</h1><p>أنفاق الراوترات للتحكّم الآمن (CoA/Disconnect) — {peers.length}</p></div>
        <button className="btn-primary inline" onClick={() => { setForm({ name: '', public_key: '', nas_id: nas[0]?.id || '' }); setShow(true) }}>+ نفق جديد</button>
      </div>

      {server && (
        <div className="wg-server">
          <div><span>عنوان النفق للخادم</span><code>{server.server_tunnel_ip}</code></div>
          <div><span>Endpoint</span><code>{server.endpoint}</code></div>
          <div><span>مفتاح الخادم العام</span><code className="key">{server.server_public_key || '— لم يُضبط بعد —'}</code></div>
        </div>
      )}

      <table className="tbl">
        <thead><tr><th>الاسم</th><th>عنوان النفق</th><th>الراوتر (NAS)</th><th>آخر مصافحة</th><th>المفتاح العام</th><th></th></tr></thead>
        <tbody>
          {peers.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td><code>{p.tunnel_ip}</code></td>
              <td>{p.nas_name || '—'}</td>
              <td>{p.last_handshake ? dt(p.last_handshake) : '—'}</td>
              <td><code className="key">{p.public_key.slice(0, 18)}…</code></td>
              <td><button className="btn sm danger" onClick={() => del(p.id)}>حذف</button></td>
            </tr>
          ))}
          {peers.length === 0 && <tr><td colSpan={6} className="empty">لا أنفاق بعد. أضف نفقاً لربط راوتر عبر WireGuard.</td></tr>}
        </tbody>
      </table>

      {show && (
        <div className="modal-back" onClick={() => setShow(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={add}>
            <h2>نفق WireGuard جديد</h2>
            <label>الاسم</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="MikroTik - فرع 1" autoFocus />
            <label>مفتاح MikroTik العام (Public Key)</label>
            <input value={form.public_key} onChange={(e) => setForm({ ...form, public_key: e.target.value })} placeholder="/interface wireguard print" />
            <label>ربط بالراوتر (NAS)</label>
            <select value={form.nas_id} onChange={(e) => setForm({ ...form, nas_id: e.target.value })}>
              <option value="">— لا شيء —</option>
              {nas.map((n) => <option key={n.id} value={n.id}>{n.shortname || n.nasname}</option>)}
            </select>
            <p className="muted">سيُخصَّص عنوان نفق تلقائياً (10.10.10.x).</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShow(false)}>إلغاء</button>
              <button className="btn-primary">حفظ</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
