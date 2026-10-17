import { Link } from '@tanstack/react-router'
import { Feather, Sparkles } from 'lucide-react'

export default function Header() {
  return (
    <header className="site-header">
      <nav aria-label="Main navigation" className="site-nav">
        <Link aria-label="Book Studio home" className="brand-lockup" to="/">
          <span aria-hidden="true" className="brand-mark">
            <Sparkles size={18} strokeWidth={1.8} />
          </span>
          <span className="brand-name">commonplace</span>
          <span className="brand-divider" />
          <span className="brand-product">BOOK STUDIO</span>
        </Link>
        <div className="nav-right">
          <span className="nav-note"><Feather size={14} /> A little room to write</span>
          <span className="profile-mark" aria-label="Your writing space">Y</span>
        </div>
      </nav>
    </header>
  )
}
