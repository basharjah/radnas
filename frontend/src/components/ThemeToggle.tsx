import { useTheme } from '../theme'
import { NavIcon } from './NavIcon'

export default function ThemeToggle({ labeled = false }: { labeled?: boolean }) {
  const { theme, toggle } = useTheme()
  return (
    <button type="button" className="theme-toggle" onClick={toggle} aria-label="تبديل السمة"
      title={theme === 'dark' ? 'التبديل للوضع الفاتح' : 'التبديل للوضع الداكن'}>
      <span className="tt-ico"><NavIcon name={theme === 'dark' ? 'sun' : 'moon'} size={17} /></span>
      {labeled && <span>{theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}</span>}
    </button>
  )
}
