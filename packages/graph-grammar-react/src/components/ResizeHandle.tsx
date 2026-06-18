import { useRef } from 'react'

/**
 * A thin vertical drag handle that resizes the panel to its LEFT. Dragging right
 * widens it, left narrows it; the new width is clamped to [min, max] and pushed
 * up via `onChange`. Pointer capture keeps the drag alive over the canvas.
 */
export function ResizeHandle ({
  value,
  min,
  max,
  onChange,
  hidden,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  hidden?: boolean;
}) {
  const drag = useRef<{ startX: number; startW: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { startX: e.clientX, startW: value }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* capture is best-effort */ }
    e.preventDefault()
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const next = drag.current.startW + (e.clientX - drag.current.startX)
    onChange(Math.max(min, Math.min(max, next)))
  }
  const end = (e: React.PointerEvent) => {
    if (!drag.current) return
    drag.current = null
    try { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* best-effort */ }
  }

  return (
    <div
      className='resize-handle'
      role='separator'
      aria-orientation='vertical'
      title='Drag to resize'
      style={hidden ? { display: 'none' } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onChange(Math.max(min, Math.min(max, value)))}
    />
  )
}
