import blue from '../assets/logo-blue.png'
import white from '../assets/logo-white.png'

/**
 * RadNas logo mark. Auto-swaps with the theme:
 *  - light theme → electric-blue mark
 *  - dark theme  → white mark
 * Size follows the parent `.brand` font-size (see .logo-img in styles.css).
 */
export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={'logo ' + className} aria-hidden="true">
      <img src={blue} className="logo-img logo-light" alt="" />
      <img src={white} className="logo-img logo-dark" alt="" />
    </span>
  )
}
