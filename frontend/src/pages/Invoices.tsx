import { useEffect, useState } from 'react'
import { api } from '../api'
import { money, date } from '../format'

interface Invoice {
  id: string
  number: string
  description: string | null
  amount: string
  status: string
  issued_at: string
  subscriber_username: string | null
  manager_name: string | null
}

export default function Invoices() {
  const [rows, setRows] = useState<Invoice[]>([])
  const [sum, setSum] = useState({ total: 0, unpaid: 0, count: 0 })
  const [status, setStatus] = useState('')

  const load = () =>
    api.get('/invoices', { params: status ? { status } : {} }).then((r) => {
      setRows(r.data.data)
      setSum({ total: r.data.sum_total, unpaid: r.data.sum_unpaid, count: r.data.total })
    })
  useEffect(() => { load() }, [status])

  async function toggle(inv: Invoice) {
    await api.post(`/invoices/${inv.id}/${inv.status === 'paid' ? 'unpay' : 'pay'}`)
    load()
  }

  return (
    <div>
      <div className="page-head"><h1>الفواتير</h1><p>{sum.count} فاتورة</p></div>
      <div className="sum-row">
        <div className="sum-card red"><span>غير مدفوع</span><b>{money(sum.unpaid)}</b></div>
        <div className="sum-card"><span>الإجمالي</span><b>{money(sum.total)}</b></div>
      </div>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل الحالات</option>
          <option value="unpaid">غير مدفوع</option>
          <option value="paid">مدفوع</option>
        </select>
      </div>
      <table className="tbl">
        <thead>
          <tr><th>رقم</th><th>التاريخ</th><th>المشترك</th><th>الموزّع</th><th>الوصف</th><th>المبلغ</th><th>الحالة</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id}>
              <td>{i.number}</td>
              <td>{date(i.issued_at)}</td>
              <td>{i.subscriber_username || '—'}</td>
              <td>{i.manager_name || '—'}</td>
              <td>{i.description}</td>
              <td>{money(i.amount)}</td>
              <td><span className={'badge ' + (i.status === 'paid' ? 'active' : 'expired')}>{i.status === 'paid' ? 'مدفوع' : 'غير مدفوع'}</span></td>
              <td><button className="btn sm" onClick={() => toggle(i)}>{i.status === 'paid' ? 'إلغاء الدفع' : 'تحديد كمدفوع'}</button></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="empty">لا فواتير</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
