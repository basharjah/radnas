import { useEffect, useState } from 'react'
import { api } from '../api'
import { money, dt } from '../format'

interface Tx {
  id: string
  type: string
  direction: string
  amount: string
  points: number
  note: string | null
  created_at: string
  manager_name: string | null
  counterparty_name: string | null
}

const typeLabel: Record<string, string> = {
  charge: 'خصم', commission: 'عمولة', topup: 'شحن', withdraw: 'سحب', transfer: 'تحويل',
}

export default function Transactions() {
  const [rows, setRows] = useState<Tx[]>([])
  const [sum, setSum] = useState(0)

  useEffect(() => {
    api.get('/transactions').then((r) => {
      setRows(r.data.data)
      setSum(r.data.sum_amount)
    })
  }, [])

  return (
    <div>
      <div className="page-head"><h1>الحركات المالية</h1><p>سجلّ الشحن والعمولات والخصومات</p></div>
      <div className="sum-row">
        <div className="sum-card teal"><span>مجموع الحركات</span><b>{money(sum)}</b></div>
      </div>
      <table className="tbl">
        <thead>
          <tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>الموزّع</th><th>الطرف الآخر</th><th>ملاحظة</th></tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{dt(t.created_at)}</td>
              <td><span className="role">{typeLabel[t.type] ?? t.type}</span></td>
              <td>{money(t.amount)}</td>
              <td>{t.manager_name || '—'}</td>
              <td>{t.counterparty_name || '—'}</td>
              <td>{t.note || '—'}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="empty">لا حركات</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
