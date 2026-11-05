import { useState, type ReactNode } from 'react'
import { Menu, MenuItem } from '@mui/material'
import { ExpandMore } from '@mui/icons-material'
import { Link } from 'react-router-dom'
import './header-dropdown.css'

interface DropdownItem {
  label: string
  icon: ReactNode
  to?: string
  onClick?: () => void
}

export default function HeaderDropdown({ id, label, icon, items, width = 208 }: {
  id: string
  label: string
  icon?: ReactNode
  items: DropdownItem[]
  width?: number
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return <>
    <button id={`${id}-button`} className={`header-dropdown-trigger manage-button ${anchor ? 'is-open' : ''}`} aria-haspopup="menu" aria-expanded={Boolean(anchor)} aria-controls={anchor ? `${id}-menu` : undefined} onClick={event => setAnchor(event.currentTarget)}>
      {icon}{label}<ExpandMore />
    </button>
    <Menu id={`${id}-menu`} anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} slotProps={{
      list: { 'aria-labelledby': `${id}-button`, sx: { py: .5 } },
      paper: { sx: { width, borderRadius: 1, border: '1px solid #e5ebf1', bgcolor: '#fff', color: '#182b3d', boxShadow: '0 8px 24px rgba(7, 26, 46, .16)' } },
    }}>
      {items.map(item => {
        const props = {
          onClick: () => { setAnchor(null); item.onClick?.() },
          sx: { gap: 1, minHeight: 37, font: '14px Arial, sans-serif', '& svg': { fontSize: 17, color: '#168cc9' }, '&:hover, &.Mui-focusVisible': { bgcolor: '#eaf7ff' } },
        }
        return item.to
          ? <MenuItem key={item.label} component={Link} to={item.to} {...props}>{item.icon}{item.label}</MenuItem>
          : <MenuItem key={item.label} {...props}>{item.icon}{item.label}</MenuItem>
      })}
    </Menu>
  </>
}
