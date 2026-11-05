import { Box, Button } from '@mui/material'
import { Link, useLocation } from 'react-router-dom'

export default function DeviceSectionNav() {
  const { pathname } = useLocation()
  return (
    <Box
      component="nav"
      aria-label="Device sections"
      sx={{ display: 'flex', gap: 2, borderBottom: '1px solid #ddd', flexWrap: 'wrap', mb: 1 }}
    >
      {[
        ['Device', '/admin/device-management'],
        ['Add Device', '/admin/add-device'],
        ['Managing user list', '/admin/users'],
        ['Bulk Sell', '/admin/bulk-sell'],
        ['SIM Card Management', '/admin/sim-cards'],
      ].map(([label, to]) => (
        <Button
          key={to}
          component={Link}
          to={to}
          aria-current={pathname === to ? 'page' : undefined}
          sx={{
            color: pathname === to ? '#0284c7' : '#475569',
            borderBottom: pathname === to ? '2px solid #0284c7' : '2px solid transparent',
            borderRadius: 0,
            fontWeight: pathname === to ? 700 : 500,
            fontSize: 14,
            pb: 1,
            textTransform: 'none',
          }}
        >
          {label}
        </Button>
      ))}
    </Box>
  )
}
