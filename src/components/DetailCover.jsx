import { createPortal } from 'react-dom'
import { ArrowLeft, ChevronUp } from 'lucide-react'
import { markCoverSettled } from '../utils/detailCover'

// Whether a cover should open as a page of its own rather than over its card.
// The connected layout takes the card surfaces away (see "Connected layout" in
// App.css), so a cover growing to fill the card would bring back a panel the
// layout no longer has. There it opens as a full-screen page over the same sky
// instead. Read when a cover opens, not on every render: the layout can't
// change while one is up (Settings covers the forecast).
export const coverAsPage = () =>
  document.documentElement.getAttribute('data-layout') === 'connected'

// An open day or detail, as one of two shells around the same body:
//
//   card  the rectangle that grows out of the tapped row or tile to fill the
//         card (.detail-cover in App.css), closed by tapping its header
//   page  a full-screen page, drawn into .app so it sits on the phone's sky
//         with the rest of the forecast faded out under it, closed by its
//         back button
//
// Either way every exit goes through `onClose`, the caller's useCoverHistory
// dismiss, so the back gesture and Esc behave the same in both.
export function DetailCover({
  page, closing, from, title, icon, iconStyle, onClose, bodyClass = '', variant, coverRef, children,
}) {
  if (page) {
    const host = document.querySelector('.app') ?? document.body
    return createPortal(
      <div
        ref={coverRef}
        // The plain `closing` is for predictive back, whose [data-pb-done]
        // rule (App.css) lets a page's close animation run only with it.
        className={`detail-page detail-page--${variant}${closing ? ' detail-page--closing closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="detail-page-bar">
          <button className="header-icon-btn detail-page-back" onClick={onClose} aria-label="Back">
            <ArrowLeft size={20} />
          </button>
        </div>
        <div className="detail-page-scroll">
          <h2 className="detail-page-title">
            <span className="detail-cover-icon" style={iconStyle}>{icon}</span>
            {title}
          </h2>
          <div className={`detail-cover-body ${bodyClass}`}>
            {children}
          </div>
        </div>
      </div>,
      host,
    )
  }

  return (
    <div
      ref={coverRef}
      className={`detail-cover${closing ? ' detail-cover--closing' : ''}`}
      style={from}
      role="dialog"
      aria-label={title}
      onAnimationEnd={markCoverSettled}
    >
      <div className="detail-cover-fill" />
      {/* The header is the close control: tap the title to fold the cover
          back, the way its row or tile was tapped open. */}
      <button className="detail-cover-head" onClick={onClose} aria-label={`Close ${title}`}>
        <span className="detail-cover-title">
          <span className="detail-cover-icon" style={iconStyle}>{icon}</span>
          {title}
        </span>
        <ChevronUp size={20} className="detail-cover-chevron" aria-hidden="true" />
      </button>
      <div className={`detail-cover-body ${bodyClass}`}>
        {children}
      </div>
    </div>
  )
}
