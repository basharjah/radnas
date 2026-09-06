import { useEffect } from 'react'

/**
 * Makes every `.tbl` table responsive on mobile without touching each page:
 * it copies each column header onto its body cells as `data-label`, which the
 * CSS then shows (label : value) when the table is rendered as stacked cards.
 * A MutationObserver keeps labels in sync as data loads / changes.
 */
export default function ResponsiveTables() {
  useEffect(() => {
    const label = () => {
      document.querySelectorAll('table.tbl').forEach((tbl) => {
        const heads = Array.from(tbl.querySelectorAll('thead th')).map((th) => th.textContent?.trim() || '')
        tbl.querySelectorAll('tbody tr').forEach((tr) => {
          Array.from(tr.children).forEach((td, i) => {
            if (heads[i]) (td as HTMLElement).setAttribute('data-label', heads[i])
          })
        })
      })
    }
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => { clearTimeout(timer); timer = setTimeout(label, 60) }
    schedule()
    const obs = new MutationObserver(schedule)
    obs.observe(document.body, { childList: true, subtree: true })
    return () => { obs.disconnect(); clearTimeout(timer) }
  }, [])
  return null
}
