import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * A titled, collapsible section used by the example gallery and the rule list.
 * The caret rotates via CSS; the body simply unmounts when collapsed. `right`
 * renders controls (e.g. a count badge or a bulk toggle) on the header's right.
 */
export function CollapsibleGroup ({
  title,
  collapsed,
  onToggle,
  right,
  children,
}: {
  title: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={'collapsible' + (collapsed ? ' collapsed' : '')}>
      <div className='collapsible-head'>
        <button className='collapsible-toggle' onClick={onToggle} aria-expanded={!collapsed} title={collapsed ? 'Expand' : 'Collapse'}>
          <ChevronRight size={14} className='collapsible-caret' />
          <span className='collapsible-title'>{title}</span>
        </button>
        {right && <div className='collapsible-right'>{right}</div>}
      </div>
      {!collapsed && <div className='collapsible-body'>{children}</div>}
    </div>
  )
}
