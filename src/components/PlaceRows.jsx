import { X } from 'lucide-react'

// The rows and grouped panels the phone search sheet is built from, shared
// with the Saved Cities page so the two read as one design. Styles are the
// .ss-* rules in App.css.

export function PlaceRow({ icon: Icon, tone, name, sub, badge, onSelect, onRemove, removeLabel }) {
  return (
    <div className="ss-row">
      <button className="ss-row-main" onClick={onSelect}>
        <span className={`ss-tile${tone ? ` ss-tile--${tone}` : ''}`}><Icon size={17} aria-hidden="true" /></span>
        <span className="ss-row-text">
          <span className="ss-row-name">{name}</span>
          {sub && <span className="ss-row-sub">{sub}</span>}
        </span>
        {badge}
      </button>
      {onRemove && (
        <button className="ss-row-remove" onClick={onRemove} aria-label={removeLabel}>
          <X size={16} />
        </button>
      )}
    </div>
  )
}

export function PlaceSection({ title, children }) {
  return (
    <section className="ss-section">
      <h3 className="ss-section-title">{title}</h3>
      <div className="ss-group">{children}</div>
    </section>
  )
}
