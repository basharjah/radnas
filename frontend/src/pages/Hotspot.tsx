import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { dt } from '../format'
import { NavIcon } from '../components/NavIcon'

interface Stats { total: number; unused: number; active: number; expired: number; batches: number }
interface Batch { id: string; code: string; count: number; created_at: string; plan_name: string | null; cards_count: number }
interface Card { id: string; username: string; password: string; status: string; plan_name: string | null }
interface Plan { id: string; name: string }

const cardStatus: Record<string, string> = { unused: 'غير مستخدم', active: 'نشط', expired: 'منتهٍ' }

export default function Hotspot() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [batches, setBatches] = useState<Batch[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [selBatch, setSelBatch] = useState<string | null>(null)
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({ plan_id: '', count: 10 })

  const load = async () => {
    setStats((await api.get('/hotspot/stats')).data)
    setBatches((await api.get('/hotspot/batches')).data.data)
    setPlans((await api.get('/plans')).data.data)
  }
  useEffect(() => { load() }, [])

  const viewCards = async (b: Batch) => {
    setSelBatch(b.code)
    setCards((await api.get('/hotspot/cards', { params: { batch_id: b.id } })).data.data)
  }

  async function gen(e: FormEvent) {
    e.preventDefault()
    await api.post('/hotspot/batches', { plan_id: form.plan_id, count: Number(form.count) })
    setShow(false); load()
  }

  return (
    <div>
      <div className="page-head row">
        <div><h1>هوت سبوت</h1><p>كروت الاشتراك المؤقّت (vouchers)</p></div>
        <button className="btn-primary inline" onClick={() => { setForm({ plan_id: plans[0]?.id || '', count: 10 }); setShow(true) }}>+ توليد دفعة</button>
      </div>

      {stats && (
        <div className="cards">
          <div className="card tone-blue"><div className="card-ico"><NavIcon name="ticket" size={22} /></div><div className="card-body"><div className="card-label">إجمالي الكروت</div><div className="card-num">{stats.total}</div></div></div>
          <div className="card tone-green"><div className="card-ico"><NavIcon name="tag" size={22} /></div><div className="card-body"><div className="card-label">غير مستخدم</div><div className="card-num">{stats.unused}</div></div></div>
          <div className="card tone-teal"><div className="card-ico"><NavIcon name="online" size={22} /></div><div className="card-body"><div className="card-label">نشط</div><div className="card-num">{stats.active}</div></div></div>
          <div className="card tone-violet"><div className="card-ico"><NavIcon name="plans" size={22} /></div><div className="card-body"><div className="card-label">الدفعات</div><div className="card-num">{stats.batches}</div></div></div>
        </div>
      )}

      <h2 className="section">الدفعات</h2>
      <table className="tbl">
        <thead><tr><th>الرمز</th><th>الباقة</th><th>العدد</th><th>التاريخ</th><th></th></tr></thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.id}>
              <td><code>{b.code}</code></td>
              <td>{b.plan_name || '—'}</td>
              <td>{b.cards_count}</td>
              <td>{dt(b.created_at)}</td>
              <td><button className="btn sm" onClick={() => viewCards(b)}>عرض الكروت</button></td>
            </tr>
          ))}
          {batches.length === 0 && <tr><td colSpan={5} className="empty">لا دفعات بعد</td></tr>}
        </tbody>
      </table>

      {selBatch && (
        <>
          <h2 className="section">كروت الدفعة <code>{selBatch}</code></h2>
          <table className="tbl">
            <thead><tr><th>اسم المستخدم</th><th>كلمة المرور</th><th>الباقة</th><th>الحالة</th></tr></thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id}>
                  <td><code>{c.username}</code></td>
                  <td><code>{c.password}</code></td>
                  <td>{c.plan_name || '—'}</td>
                  <td><span className={'badge ' + c.status}>{cardStatus[c.status] ?? c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {show && (
        <div className="modal-back" onClick={() => setShow(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={gen}>
            <h2>توليد دفعة كروت</h2>
            <label>الباقة</label>
            <select value={form.plan_id} onChange={(e) => setForm({ ...form, plan_id: e.target.value })}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <label>عدد الكروت</label>
            <input type="number" value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })} />
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setShow(false)}>إلغاء</button>
              <button className="btn-primary">توليد</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
