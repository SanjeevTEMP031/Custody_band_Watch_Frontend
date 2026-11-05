import { useState, type FormEvent } from 'react'
import { Alert, Box, Button, Stack } from '@mui/material'
import DeviceSectionNav from '../../components/layout/DeviceSectionNav'

export default function BulkSellPage() {
  const [company, setCompany] = useState('')
  const [imeis, setImeis] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setNotice('')
    if (!company.trim()) { setError('Enter the destination company name.'); return }
    const numbers = imeis.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
    if (!numbers.length || numbers.some(value => !/^\d{15}$/.test(value))) { setError('Enter valid 15-digit IMEI numbers, one per line.'); return }
    if (new Set(numbers).size !== numbers.length) { setError('Remove duplicate IMEI numbers.'); return }
    setNotice(`${numbers.length} devices selected for ${company.trim()}. Bulk Sell is not connected yet; no devices have been transferred.`)
  }
  return <Stack spacing={2} sx={{ bgcolor: '#fff', p: 1.5, minHeight: 'calc(100vh - 180px)', color: '#222', fontFamily: 'Arial, sans-serif' }}>
    <DeviceSectionNav />
    <Stack component="form" spacing={2} onSubmit={submit}>
      {error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="info">{notice}</Alert>}
      <Box sx={{ display: 'flex', alignItems: 'center', border: '1px solid #e3e3e3', minHeight: 39 }}>
        <Box component="label" htmlFor="bulk-company" sx={{ width: 110, flexShrink: 0, bgcolor: '#fafafa', borderRight: '1px solid #e3e3e3', alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>Company Name</Box>
        <Box component="input" id="bulk-company" list="bulk-company-options" placeholder="Company Name" value={company} onChange={event => setCompany(event.target.value)} sx={{ flex: 1, minWidth: 0, border: 0, px: 1.25, minHeight: 37, font: '14px Arial, sans-serif' }} />
        <datalist id="bulk-company-options" />
      </Box>
      <Box sx={{ border: '1px solid #e3e3e3' }}>
        <Box component="label" htmlFor="bulk-imeis" sx={{ display: 'block', p: 1.25, bgcolor: '#fafafa', borderBottom: '1px solid #e3e3e3', fontSize: 14 }}>Imei</Box>
        <Box component="textarea" id="bulk-imeis" value={imeis} onChange={event => setImeis(event.target.value)} placeholder="Multiple lines are separated by line breaks, and must be the IMEI of the current company and on the platform" sx={{ display: 'block', width: '100%', height: 100, border: 0, p: 1.25, resize: 'vertical', font: '14px Arial, sans-serif' }} />
      </Box>
      <Box sx={{ pl: { xs: 0, sm: '110px' } }}><Button type="submit" variant="contained" sx={{ bgcolor: '#00998c', borderRadius: .3, minWidth: 56 }}>OK</Button></Box>
    </Stack>
  </Stack>
}
