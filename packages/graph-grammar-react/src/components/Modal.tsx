import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

/** A minimal centered modal dialog. Click the backdrop or press Escape to close. */
export function Modal ({
  title,
  onClose,
  children,
  footer,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className='modal-overlay' onClick={onClose}>
      <div className='modal' role='dialog' aria-modal='true' onClick={(e) => e.stopPropagation()}>
        <div className='modal-head'>
          <h3>{title}</h3>
          <button className='icon-btn' title='Close' onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className='modal-body'>{children}</div>
        {footer && <div className='modal-foot'>{footer}</div>}
      </div>
    </div>
  )
}
