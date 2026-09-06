import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { portalApi } from '../portalApi'
import { Logo } from '../components/Logo'

export default function PortalLogin() {
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('')
    try {
      const r = await portalApi.post('/login', { username, password })
      localStorage.setItem('radnas_portal_token', r.data.token)
      nav('/portal')
    } catch {
      setErr('اسم المستخدم أو كلمة المرور غير صحيحة')
    }
  }

  return (
    <div className="login-wrap portal">
      <form className="login-card" onSubmit={submit}>
        <div className="brand"><Logo /> Rad<b>Nas</b></div>
        <p className="brand-sub">بوابة المشترك</p>
        <label>اسم المستخدم</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <label>كلمة المرور</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <div className="error">{err}</div>}
        <button className="btn-primary">دخول</button>
      </form>
    </div>
  )
}
