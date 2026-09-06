import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import ThemeToggle from '../components/ThemeToggle'
import { Logo } from '../components/Logo'

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [username, setUsername] = useState('owner')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(username, password)
      nav('/dashboard')
    } catch (e: any) {
      // The API answers 403 with a reason when the credentials are right but the account is not
      // usable yet, so a company awaiting approval isn't told its password is wrong.
      const d = e?.response?.data
      setError(d?.message || 'اسم المستخدم أو كلمة المرور غير صحيحة')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <ThemeToggle />
      <form className="login-card" onSubmit={submit}>
        <div className="brand"><Logo /> Rad<b>Nas</b></div>
        <p className="brand-sub">Provider control panel</p>
        <label>اسم المستخدم</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        <label>كلمة المرور</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <button className="btn-primary" disabled={busy}>{busy ? '…' : 'دخول'}</button>
        {/* Client-side Link, not <a> — a full reload here would throw away the SPA and flash. */}
        <Link className="reg-alt" to="/register">ليس لديك حساب؟ أنشئ حساب شركة</Link>
        <Link className="back-home" to="/">← العودة إلى الصفحة الرئيسية</Link>
      </form>
    </div>
  )
}
