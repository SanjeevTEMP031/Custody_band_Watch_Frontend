import { useState, type FormEvent } from 'react'
import { Alert, Box, Button, Dialog, DialogContent, DialogTitle, IconButton, MenuItem, Stack, Tab, Tabs, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import { Add, Close } from '@mui/icons-material'

export default function RedeemVoucherPage() {
  const [tab, setTab] = useState(0)
  const [start, setStart] = useState(''), [end, setEnd] = useState('')
  const [orderId, setOrderId] = useState(''), [imei, setImei] = useState('')
  const [cardType, setCardType] = useState('All'), [cardState, setCardState] = useState('All')
  const [error, setError] = useState(''), [searched, setSearched] = useState(false)
  const [open, setOpen] = useState(false), [yearCards, setYearCards] = useState(''), [lifeCards, setLifeCards] = useState(''), [voucherMessage, setVoucherMessage] = useState('')
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (start && end && start > end) { setError('Choose an end date on or after the start date.'); return }
    if (tab === 1 && imei.trim() && !/^\d{15}$/.test(imei.trim())) { setError('Enter a valid 15-digit IMEI.'); return }
    setSearched(true)
  }
  const submitVoucher = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const quantities = [yearCards.trim(), lifeCards.trim()]
    if (quantities.some(value => value && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 10000))) { setVoucherMessage('Enter whole-number quantities between 0 and 10,000.'); return }
    if (!quantities.some(value => Number(value) > 0)) { setVoucherMessage('Enter a quantity for Year Card or Life Card.'); return }
    setVoucherMessage('Prepaid card purchases are not connected yet. No order or payment has been submitted.')
  }
  const field = { width: 182, '& .MuiOutlinedInput-root': { bgcolor: '#fff', borderRadius: 0, font: '14px Arial, sans-serif' } }
  const menuProps = { slotProps: { paper: { sx: { borderRadius: 0, '& .MuiMenuItem-root.Mui-selected, & .MuiMenuItem-root.Mui-selected:hover, & .MuiMenuItem-root.Mui-selected.Mui-focusVisible': { bgcolor: '#d9f0ff', color: '#123047' } } } } }
  const cell = { border: '1px solid #e3e3e3', px: 2, py: 1.25, color: '#666', font: '14px Arial, sans-serif', whiteSpace: 'nowrap' }
  return <Stack spacing={0} sx={{ bgcolor: '#fff', minWidth: 0, minHeight: 'calc(100vh - 180px)' }}>
    <Box sx={{ p: 2, bgcolor: '#f2f2f2', borderLeft: '4px solid #00998c' }}><Button aria-label="Buy prepaid cards" onClick={() => { setOpen(true); setVoucherMessage(''); setYearCards(''); setLifeCards('') }} variant="contained" sx={{ bgcolor: '#2196ff', borderRadius: .3, height: 38, minWidth: 55 }}><Add /></Button></Box>
    <Tabs value={tab} onChange={(_, value: number) => { setTab(value); setError(''); setSearched(false) }} aria-label="Voucher sections" sx={{ mt: 1, borderBottom: '1px solid #ddd', '& .MuiTab-root': { font: '14px Arial, sans-serif', minHeight: 42, color: '#222' }, '& .Mui-selected': { color: '#00998c !important' }, '& .MuiTabs-indicator': { bgcolor: '#5cb879' } }}>
      <Tab id="recharge-record-tab" aria-controls="recharge-panel" label="Recharge Record" /><Tab id="recharge-card-tab" aria-controls="recharge-panel" label="Recharge card" />
    </Tabs>
    <Box id="recharge-panel" role="tabpanel" aria-labelledby={tab === 0 ? 'recharge-record-tab' : 'recharge-card-tab'} sx={{ p: 1.25 }}>
      <Box component="form" onSubmit={search} sx={{ display: 'flex', gap: .5, flexWrap: 'wrap', alignItems: 'flex-start', bgcolor: '#f2f2f2', borderLeft: '4px solid #00998c', p: 2, minHeight: 88 }}>
        <Typography sx={{ width: 110, textAlign: 'right', pr: 1.5, pt: 1, font: '14px Arial, sans-serif' }}>Recharge<br />Time</Typography>
        <TextField type="date" size="small" value={start} onChange={event => setStart(event.target.value)} slotProps={{ htmlInput: { 'aria-label': 'Recharge start date' } }} sx={field} />
        <TextField type="date" size="small" value={end} onChange={event => setEnd(event.target.value)} slotProps={{ htmlInput: { 'aria-label': 'Recharge end date', min: start || undefined } }} sx={field} />
        {tab === 0 ? <TextField size="small" placeholder="Order ID" value={orderId} onChange={event => setOrderId(event.target.value)} slotProps={{ htmlInput: { 'aria-label': 'Order ID' } }} sx={field} /> : <>
          <TextField select size="small" value={cardState} onChange={event => { setCardState(event.target.value); setSearched(false) }} slotProps={{ select: { inputProps: { 'aria-label': 'Recharge card state' }, MenuProps: menuProps } }} sx={{ ...field, width: 212 }}>{['All', 'No User', 'Used'].map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>
          <TextField select size="small" value={cardType} onChange={event => { setCardType(event.target.value); setSearched(false) }} slotProps={{ select: { inputProps: { 'aria-label': 'Recharge card type' }, MenuProps: menuProps } }} sx={{ ...field, width: 212 }}>{['All', 'Year Card', 'Life Card'].map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>
          <TextField size="small" placeholder="Imei" value={imei} onChange={event => setImei(event.target.value)} slotProps={{ htmlInput: { 'aria-label': 'Device IMEI' } }} sx={field} />
        </>}
        <Button type="submit" variant="contained" sx={{ bgcolor: '#00998c', borderRadius: .3, height: 38 }}>Search</Button>
      </Box>
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      {tab === 0 && <Box sx={{ overflow: 'auto', mt: 3.5, minHeight: 260 }}><Table sx={{ minWidth: 1100, tableLayout: 'fixed' }}><TableHead><TableRow>{['Order ID', 'Company Name', 'UserName', 'Bill NO', 'Total Price', 'Currency', 'State', 'Create Time'].map(label => <TableCell key={label} sx={{ ...cell, bgcolor: '#f2f2f2' }}>{label}</TableCell>)}</TableRow></TableHead><TableBody><TableRow><TableCell colSpan={8} sx={{ ...cell, textAlign: 'center', border: 0, color: '#999' }}>No Data</TableCell></TableRow></TableBody></Table></Box>}
      {tab === 1 && searched && <Typography role="status" sx={{ textAlign: 'center', mt: 4, color: '#999', fontSize: 14 }}>No Data</Typography>}
    </Box>
    <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby="buy-prepaid-title" fullWidth maxWidth="sm" slotProps={{ paper: { sx: { borderRadius: .3, minHeight: 400, width: 600, maxWidth: 'calc(100vw - 32px)' } } }}><Box component="form" onSubmit={submitVoucher}>
      <DialogTitle id="buy-prepaid-title" sx={{ bgcolor: '#f8f8f8', borderBottom: '1px solid #eee', py: 1.5, px: 2.5, font: '14px Arial, sans-serif', color: '#16314a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>Buy Prepaid Cards<IconButton type="button" aria-label="Close prepaid card form" onClick={() => setOpen(false)} size="small" sx={{ p: 0 }}><Close sx={{ fontSize: 18 }} /></IconButton></DialogTitle>
      <DialogContent sx={{ p: 2, '&:first-of-type': { pt: 2 } }}>
        {voucherMessage && <Alert severity="info" sx={{ mb: 2 }}>{voucherMessage}</Alert>}
        <Stack spacing={2}>
          {[{ id: 'year-card-qty', label: 'Year Card', value: yearCards, set: setYearCards }, { id: 'life-card-qty', label: 'Life Card', value: lifeCards, set: setLifeCards }].map(card => <Box key={card.id} sx={{ display: 'flex', border: '1px solid #e3e3e3', minHeight: 38 }}>
            <Box component="label" htmlFor={card.id} sx={{ width: 110, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#fafafa', borderRight: '1px solid #e3e3e3', font: '14px Arial, sans-serif' }}>{card.label}</Box>
            <Box component="input" id={card.id} type="number" min={0} max={10000} step={1} placeholder="Sheets" value={card.value} onChange={event => { card.set(event.target.value); setVoucherMessage('') }} sx={{ flex: 1, minWidth: 0, border: 0, px: 1.25, font: '14px Arial, sans-serif' }} />
          </Box>)}
        </Stack>
        <Box sx={{ pl: '110px', mt: 2 }}><Button type="submit" variant="contained" sx={{ bgcolor: '#00998c', borderRadius: .3, minWidth: 56, height: 38 }}>OK</Button></Box>
      </DialogContent>
    </Box></Dialog>
  </Stack>
}
