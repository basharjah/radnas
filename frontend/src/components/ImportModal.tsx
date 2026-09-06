import { useEffect, useState } from 'react'
import { api } from '../api'

/**
 * Bulk subscriber import from a spreadsheet.
 *
 * The file is parsed here in the browser, so the API stays a plain JSON endpoint (no multipart, no
 * server-side xlsx parser). CSV is handled natively; .xlsx pulls in exceljs through a dynamic
 * import, so that weight is only downloaded by someone who actually imports a workbook.
 *
 * Nothing is written until the operator has seen the server's verdict for every row: "معاينة" runs
 * the identical import with dry_run, so the preview cannot disagree with what the import will do.
 */
interface Manager { id: string; username: string; full_name: string | null; role: string }
interface Props { managers: Manager[]; isOwner: boolean; onClose: () => void; onDone: () => void }

interface RouterRow {
  username: string; password: string; profile: string
  full_name?: string; mac?: string; disabled_on_router: boolean
  state: 'new' | 'mine' | 'other_tenant'
}

interface RowResult {
  row: number; username: string
  verdict: 'create' | 'update' | 'skip' | 'error'
  reason?: string; plan_name?: string | null; expiry_at?: string | null
}
interface Report {
  dry_run: boolean; total: number; created: number; updated: number
  skipped: number; errors: number; headroom: number | null; results: RowResult[]
}

/** Header aliases — the sheet may be written in Arabic or English. */
const FIELD_ALIASES: Record<string, string[]> = {
  username: ['username', 'user', 'اسم المستخدم', 'المستخدم', 'اسم الدخول'],
  password: ['password', 'pass', 'كلمة المرور', 'كلمه المرور', 'الرمز'],
  full_name: ['full_name', 'name', 'fullname', 'الاسم الكامل', 'الاسم', 'اسم الزبون'],
  phone: ['phone', 'mobile', 'الهاتف', 'الموبايل', 'الجوال'],
  address: ['address', 'العنوان'],
  static_ip: ['static_ip', 'ip', 'العنوان الثابت'],
  plan: ['plan', 'package', 'الباقة', 'الباقه', 'الخدمة'],
  created_at: ['created_at', 'created', 'date', 'تاريخ الإنشاء', 'تاريخ الانشاء', 'تاريخ إنشاء الحساب', 'التاريخ'],
}
const normHeader = (h: string) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
function mapHeaders(headers: string[]): Record<number, string> {
  const map: Record<number, string> = {}
  headers.forEach((h, i) => {
    const n = normHeader(h)
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some((a) => normHeader(a) === n)) { map[i] = field; return }
    }
  })
  return map
}

/** Minimal RFC-4180 CSV reader — handles quoted fields and embedded commas/newlines. */
/**
 * Parse a RouterOS `.rsc` export of `/ppp secret`.
 *
 * The REST API masks every password as `*****` no matter what policy the reading account holds —
 * verified against a live RB5009, where even the RADIUS shared secret came back masked — so pulling
 * accounts over the tunnel can bring names and profiles but never credentials. The router will
 * however write them out itself:
 *
 *     /ppp/secret/export file=radnas-secrets show-sensitive
 *
 * producing a file of `add name="..." password="..." profile=...` lines. That is the only route to
 * the real passwords that needs no write access to the router.
 *
 * Section headers are tracked and only `/ppp secret` is read. A whole-config export also contains
 * `/user add name=... password=...`, and importing the router's own admin account as a subscriber
 * would be both wrong and a credential leak into the subscriber table.
 */
function parseRsc(text: string): RouterRow[] {
  // RouterOS wraps long lines with a trailing backslash; join them first or a password split across
  // two lines is silently dropped.
  const joined = text.replace(/\\[ \t]*\r?\n[ \t]*/g, ' ')
  const val = (line: string, key: string): string | undefined => {
    // String.raw so the class escapes survive: in a plain quoted string JS drops the
    // backslash of an unknown escape, turning \s into a literal 's' and the match into
    // nonsense that quietly finds nothing.
    const m = line.match(new RegExp(String.raw`(?:^|\s)` + key + String.raw`=(?:"([^"]*)"|([^\s]+))`))
    return m ? (m[1] ?? m[2]) : undefined
  }
  const out: RouterRow[] = []
  let inSecrets = false
  for (const raw of joined.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('/')) { inSecrets = /^\/ppp[/ ]secret\s*$/.test(line); continue }
    if (!inSecrets || !/^add\b/.test(line)) continue
    const username = val(line, 'name')
    const password = val(line, 'password')
    // A masked password is not a password: the export was taken without `show-sensitive`.
    if (!username || !password || /^\*+$/.test(password)) continue
    const comment = val(line, 'comment')
    const caller = val(line, 'caller-id')
    out.push({
      username, password,
      profile: val(line, 'profile') || '(default)',
      ...(comment ? { full_name: comment } : {}),
      ...(caller ? { mac: caller } : {}),
      disabled_on_router: val(line, 'disabled') === 'yes',
      // Ownership is decided by the server on import; a file cannot know it.
      state: 'new',
    })
  }
  return out
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false }
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',' || c === ';') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''))
}

export default function ImportModal({ managers, isOwner, onClose, onDone }: Props) {
  const [rows, setRows] = useState<Record<string, string>[]>([])
  // Pulling accounts straight off the router, for an ISP whose subscribers live in `/ppp secret`.
  // RouterOS checks those before RADIUS, so nothing reaches the platform until each name exists here
  // spelled identically — and retyping them by hand is how a paying subscriber gets cut off.
  const [nasList, setNasList] = useState<{ id: string; shortname: string | null; nasname: string }[]>([])
  const [routerRows, setRouterRows] = useState<RouterRow[] | null>(null)
  const [profileMap, setProfileMap] = useState<Record<string, string>>({})
  const [planNames, setPlanNames] = useState<string[]>([])
  const [pulling, setPulling] = useState('')
  const [fileName, setFileName] = useState('')
  const [managerId, setManagerId] = useState('')
  const [activation, setActivation] = useState<'from_today' | 'from_created' | 'inactive'>('from_today')
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update'>('update')
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  // How many of the router's accounts came back with their password hidden, and the one line that
  // lifts it — kept apart from `err` because a partial pull still shows a usable list.
  const [masked, setMasked] = useState(0)
  const [fix, setFix] = useState('')

  // Routers and plan names, loaded once so the router tab can offer both.
  useEffect(() => {
    api.get('/nas').then((r) => setNasList(r.data.data || [])).catch(() => {})
    api.get('/plans').then((r) => setPlanNames((r.data.data || []).map((p: any) => p.name))).catch(() => {})
  }, [])

  async function pullFromRouter(nasId: string) {
    setPulling(nasId); setErr(''); setReport(null); setRows([]); setRouterRows(null)
    setMasked(0); setFix('')
    try {
      const r = await api.get(`/nas/${nasId}/router-secrets`)
      const rr: RouterRow[] = r.data.rows
      setRouterRows(rr)
      // A partial read is reported, not swallowed: the accounts RouterOS masked are exactly the ones
      // that would have arrived with `*****` as their password and never dialled in again.
      setMasked(Number(r.data.masked || 0))
      setFix(r.data.fix || '')
      setFileName(`الراوتر ${r.data.router} — ${rr.length} حساباً`)
      // Pre-map any profile whose name matches a plan exactly; the rest the operator picks.
      const guess: Record<string, string> = {}
      for (const p of r.data.profiles as string[]) {
        const hit = planNames.find((n) => n.toLowerCase() === String(p).toLowerCase())
        if (hit) guess[p] = hit
      }
      setProfileMap(guess)
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'تعذّر قراءة الحسابات من الراوتر')
      setFix(e?.response?.data?.fix || '')
    } finally { setPulling('') }
  }

  /** Turn the router's accounts into import rows once every profile has a plan. */
  function applyRouterRows() {
    if (!routerRows) return
    setRows(routerRows
      // A name owned by another company is never touched: the server would refuse it anyway, and
      // showing it as importable would be a lie.
      .filter((r) => r.state !== 'other_tenant')
      .map((r) => ({
        username: r.username,
        password: r.password,
        plan: profileMap[r.profile] || '',
        ...(r.full_name ? { full_name: r.full_name } : {}),
      })))
    setReport(null)
  }

  /** Feed rows into the same profile→plan mapping step the live router pull uses. */
  function useRouterRows(rr: RouterRow[], label: string) {
    setRouterRows(rr)
    setMasked(0); setFix('')
    setFileName(label)
    const guess: Record<string, string> = {}
    for (const p of [...new Set(rr.map((r) => r.profile))]) {
      const hit = planNames.find((n) => n.toLowerCase() === p.toLowerCase())
      if (hit) guess[p] = hit
    }
    setProfileMap(guess)
  }

  async function readFile(file: File) {
    setErr(''); setReport(null); setRows([]); setFileName(file.name)
    setBusy('read')
    try {
      // A RouterOS export carries profile names, so it goes through the mapping step rather than
      // the header-matching spreadsheet path — the profiles are the whole point of the file.
      if (/\.rsc$/i.test(file.name)) {
        const rr = parseRsc(await file.text())
        if (!rr.length) {
          setErr('لم أجد حسابات في هذا الملف. تأكّد أنك صدّرته بـ /ppp/secret/export file=radnas-secrets show-sensitive '
            + '— وبدون show-sensitive تُكتب كلمات المرور نجوماً فتُستثنى كلها.')
          setBusy(''); return
        }
        useRouterRows(rr, `${file.name} — ${rr.length} حساباً`)
        setBusy(''); return
      }
      let grid: string[][]
      if (/\.csv$/i.test(file.name)) {
        grid = parseCsv(await file.text())
      } else {
        // Loaded on demand — a CSV import never pays for the workbook parser.
        const ExcelJS = (await import('exceljs')).default
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(await file.arrayBuffer())
        const ws = wb.worksheets[0]
        if (!ws) throw new Error('empty')
        grid = []
        ws.eachRow((r) => {
          const vals = (r.values as unknown[]).slice(1)
          grid.push(vals.map((v) => {
            if (v == null) return ''
            if (v instanceof Date) return v.toISOString()
            if (typeof v === 'object' && 'text' in (v as object)) return String((v as { text: unknown }).text ?? '')
            if (typeof v === 'object' && 'result' in (v as object)) return String((v as { result: unknown }).result ?? '')
            return String(v)
          }))
        })
        grid = grid.filter((r) => r.some((v) => String(v).trim() !== ''))
      }
      if (grid.length < 2) throw new Error('need_rows')
      const map = mapHeaders(grid[0]!)
      const fields = Object.values(map)
      if (!fields.includes('username') || !fields.includes('password')) {
        setErr('لم أجد عمودَي «اسم المستخدم» و«كلمة المرور». تأكّد أن الصف الأول يحوي العناوين.')
        setBusy(''); return
      }
      const parsed = grid.slice(1).map((r) => {
        const o: Record<string, string> = {}
        r.forEach((v, i) => { const f = map[i]; if (f) o[f] = String(v ?? '').trim() })
        return o
      }).filter((o) => o.username && o.password)
      if (!parsed.length) throw new Error('need_rows')
      setRows(parsed)
    } catch (e) {
      setErr((e as Error).message === 'need_rows'
        ? 'الملف لا يحوي صفوفاً صالحة (يلزم صف عناوين + صف بيانات على الأقل).'
        : 'تعذّرت قراءة الملف. جرّب حفظه بصيغة xlsx أو CSV UTF-8.')
    } finally { setBusy('') }
  }

  async function run(dry: boolean) {
    if (isOwner && !managerId) { setErr('اختر الحساب المالك للمشتركين'); return }
    setErr(''); setBusy(dry ? 'preview' : 'import')
    try {
      const r = await api.post('/subscribers/import', {
        rows, manager_id: managerId || undefined, activation, on_duplicate: onDuplicate, dry_run: dry,
      })
      setReport(r.data)
      if (!dry) onDone()
    } catch (e: any) {
      setErr(e?.response?.data?.message || 'فشل الاستيراد')
    } finally { setBusy('') }
  }

  const V: Record<string, { cls: string; label: string }> = {
    create: { cls: 'ok', label: 'جديد' },
    update: { cls: 'upd', label: 'تحديث' },
    skip: { cls: 'skip', label: 'تجاوز' },
    error: { cls: 'bad', label: 'خطأ' },
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()}>
        <h2>استيراد مشتركين</h2>

        {/* Most ISPs arriving here have no spreadsheet — their subscribers are `/ppp secret` entries
            on their own router, and that is the list that has to match the panel exactly. */}
        {nasList.length > 0 && (
          <div className="imp-router">
            <p className="muted" style={{ margin: '0 0 8px' }}>
              <b>من الراوتر مباشرة</b> — يقرأ حسابات <span dir="ltr">/ppp secret</span> بأسمائها
              وكلمات مرورها كما هي، فلا خطأ مطبعي يقطع مشتركاً.
            </p>
            <div className="onb-actions">
              {nasList.map((n) => (
                <button key={n.id} className="btn sm" disabled={!!pulling || !!busy}
                  onClick={() => pullFromRouter(n.id)}>
                  {pulling === n.id ? 'جارٍ القراءة…' : `⇩ ${n.shortname || n.nasname}`}
                </button>
              ))}
            </div>

            {routerRows && (
              <div className="imp-map">
                <p style={{ margin: '10px 0 6px', fontSize: 13.5 }}>
                  <b>{routerRows.length}</b> حساباً على الراوتر
                  {routerRows.some((r) => r.state === 'other_tenant') && (
                    <span className="imp-warn"> — {routerRows.filter((r) => r.state === 'other_tenant').length} منها
                      مملوك لحساب آخر وسيُستثنى</span>
                  )}
                </p>
                <p className="muted" style={{ margin: '0 0 8px', fontSize: 12.5, lineHeight: 1.8 }}>
                  اختر الباقة المقابلة لكل ملف تعريف على الراوتر. لا نُخمّنها: تخمين خاطئ يعني
                  سرعة وحصّة خاطئتين لمشترك يدفع.
                </p>
                {[...new Set(routerRows.map((r) => r.profile))].map((prof) => (
                  <div key={prof} className="imp-map-row">
                    <span dir="ltr" className="imp-prof">{prof}</span>
                    <span className="imp-arrow">←</span>
                    <select value={profileMap[prof] || ''}
                      onChange={(e) => setProfileMap({ ...profileMap, [prof]: e.target.value })}>
                      <option value="">— اختر باقة —</option>
                      {planNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <span className="muted imp-count">
                      {routerRows.filter((r) => r.profile === prof).length} حساباً
                    </span>
                  </div>
                ))}
                <button className="btn sm" style={{ marginTop: 10 }}
                  disabled={[...new Set(routerRows.map((r) => r.profile))].some((p) => !profileMap[p])}
                  onClick={applyRouterRows}>
                  جهّز للاستيراد
                </button>
              </div>
            )}
          </div>
        )}

        <label>أو من ملف (xlsx أو CSV أو تصدير راوتر rsc.)</label>
        <input type="file" accept=".xlsx,.xls,.csv,.rsc" disabled={!!busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f) }} />
        <p className="muted imp-hint">
          الصف الأول عناوين. الإلزامي: <b>اسم المستخدم</b> و<b>كلمة المرور</b>.
          الاختياري: الاسم الكامل · الهاتف · العنوان · الباقة · تاريخ الإنشاء.
        </p>
        {fileName && <p className="imp-file">{fileName} — <b>{rows.length}</b> صفاً صالحاً</p>}

        {rows.length > 0 && (
          <>
            {isOwner && (
              <>
                <label>الحساب المالك *</label>
                <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
                  <option value="">— اختر —</option>
                  {managers.filter((m) => m.role !== 'owner').map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name || m.username}</option>
                  ))}
                </select>
              </>
            )}

            <label>التفعيل</label>
            <select value={activation} onChange={(e) => setActivation(e.target.value as typeof activation)}>
              <option value="from_today">فعّل الآن — الانتهاء = اليوم + مدة الباقة (الأنسب للنقل)</option>
              <option value="from_created">احسب من تاريخ الإنشاء في الملف</option>
              <option value="inactive">استورد غير مفعّل — أفعّلهم لاحقاً</option>
            </select>
            {activation === 'from_created' && (
              <p className="muted imp-hint">تنبيه: من انقضت مدّته سيُستورد <b>منتهياً</b> ولن يتصل حتى التجديد.</p>
            )}

            <label>إذا كان الاسم موجوداً</label>
            <select value={onDuplicate} onChange={(e) => setOnDuplicate(e.target.value as typeof onDuplicate)}>
              <option value="update">حدّث بياناته من الملف</option>
              <option value="skip">تجاوزه ولا تمسّه</option>
            </select>
          </>
        )}

        {err && <div className="error" style={{ whiteSpace: 'pre-line' }}>{err}</div>}

        {/* The fix is one line on the router, so it is printed ready to copy rather than described.
            Shown for both cases: nothing readable at all (409) and a partial read. */}
        {!!fix && (
          <div className="imp-fix">
            <b>كلمات المرور مخفيّة على الراوتر</b>
            {masked > 0 && <span> — {masked} حساباً</span>}
            <p className="muted">
              حساب القراءة يفتقد صلاحية <span dir="ltr">sensitive</span>، فيُرجع الراوتر نجوماً بدل
              كلمات المرور. نفّذ هذا السطر في طرفية الراوتر ثم أعِد القراءة:
            </p>
            <pre dir="ltr">{fix}</pre>
          </div>
        )}

        {report && (
          <div className="imp-report">
            <div className="imp-sum">
              <span className="ok">جديد {report.created}</span>
              <span className="upd">تحديث {report.updated}</span>
              <span className="skip">تجاوز {report.skipped}</span>
              <span className="bad">خطأ {report.errors}</span>
              {report.headroom != null && <span className="muted">المتبقّي من الحصّة {report.headroom}</span>}
            </div>
            <p className="muted imp-hint">
              {report.dry_run ? 'معاينة فقط — لم يُكتب أي شيء بعد.' : 'تم الاستيراد.'}
            </p>
            <div className="imp-rows">
              {report.results.map((r) => (
                <div className={'imp-row ' + V[r.verdict]!.cls} key={r.row}>
                  <span className="imp-badge">{V[r.verdict]!.label}</span>
                  <b dir="ltr">{r.username}</b>
                  {r.plan_name && <em>{r.plan_name}</em>}
                  {r.reason && <small>{r.reason}</small>}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>إغلاق</button>
          <button className="btn" disabled={!rows.length || !!busy} onClick={() => run(true)}>
            {busy === 'preview' ? '…' : 'معاينة'}
          </button>
          <button className="btn-primary inline" disabled={!rows.length || !!busy || !report || !report.dry_run}
            onClick={() => run(false)} title={!report?.dry_run ? 'شغّل المعاينة أولاً' : ''}>
            {busy === 'import' ? '…' : 'تنفيذ الاستيراد'}
          </button>
        </div>
      </div>
    </div>
  )
}
