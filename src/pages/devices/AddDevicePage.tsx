import { useState, type FormEvent } from 'react'
import DeviceSectionNav from '../../components/layout/DeviceSectionNav'
import { useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, FormControlLabel, Radio, RadioGroup, Stack, Tab, Tabs } from '@mui/material'
import { CloudUploadOutlined } from '@mui/icons-material'
import { createDevice, getAccessToken } from '../../services/api'

export default function AddDevicePage() {
  const [params] = useSearchParams()
  const [tab, setTab] = useState(() => params.get('method') === 'excel' ? 1 : 0)
  const [imei, setImei] = useState('')
  const [excelImeis, setExcelImeis] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [model, setModel] = useState('2GSG加密')
  const [offset, setOffset] = useState('yes')
  const [lockCard, setLockCard] = useState('no')
  const [rangeStart, setRangeStart] = useState('')
  const [deviceQty, setDeviceQty] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const row = { display: 'flex', alignItems: 'center', border: '1px solid #e3e3e3', minHeight: 39 }
  const label = { width: 110, flexShrink: 0, alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#fafafa', borderRight: '1px solid #e3e3e3', fontSize: 14 }

  const importExcel = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setSuccess('')
    setExcelImeis([])
    setFileName('')
    setBusy(true)
    try {
      const { read, utils } = await import('xlsx')
      const workbook = read(await file.arrayBuffer(), { type: 'array' })
      const rows = utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: false })
      const index = rows[0]?.findIndex(value => String(value).trim().toLowerCase() === 'imei') ?? -1
      const values = (index >= 0 ? rows.slice(1) : rows).map(row => String(row[index >= 0 ? index : 0] ?? '').trim()).filter(Boolean)
      if (!values.length) throw new Error('The spreadsheet has no IMEI values.')
      if (values.length > 500 || values.some(value => !/^\d{15}$/.test(value))) throw new Error('Select a spreadsheet with up to 500 valid 15-digit IMEI numbers.')
      setExcelImeis(values)
      setFileName(file.name)
      setSuccess(`${values.length} IMEI values imported. Select OK to continue.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to read this spreadsheet.') }
    finally { setBusy(false) }
  }

  const downloadTemplate = async () => {
    setBusy(true)
    setError('')
    try {
      const { utils, writeFile } = await import('xlsx')
      const sheet = utils.aoa_to_sheet([['Imei']])
      sheet['!cols'] = [{ wch: 24 }]
      const workbook = utils.book_new()
      utils.book_append_sheet(workbook, sheet, 'Sheet1')
      writeFile(workbook, 'Device import template.xls', { bookType: 'biff8' })
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to download the template.') }
    finally { setBusy(false) }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setSuccess('')
    let values = tab === 1 ? excelImeis : imei.split(/[\s,;]+/).filter(Boolean)
    if (tab === 1 && !values.length) { setError('Select an Excel file containing IMEI values.'); return }
    if (tab === 2) {
      const startNumber = rangeStart.trim()
      const quantity = deviceQty.trim()
      if (!/^\d{15}$/.test(startNumber)) { setError('Enter a 15-digit start number.'); return }
      if (!/^\d+$/.test(quantity) || Number(quantity) < 1 || Number(quantity) > 500) { setError('Device Qty must be a whole number between 1 and 500.'); return }
      const start = BigInt(startNumber)
      const count = Number(quantity)
      if (start + BigInt(count - 1) > 999999999999999n) { setError('The generated device numbers must stay within 15 digits.'); return }
      values = Array.from({ length: count }, (_, index) => String(start + BigInt(index)).padStart(15, '0'))
    }
    values = [...new Set(values)]
    if (!values.length || values.some(value => !/^\d{15}$/.test(value))) { setError('Enter valid 15-digit IMEI numbers, one per line.'); return }
    if (values.length > 500) { setError('Add at most 500 devices at a time.'); return }
    if (!getAccessToken()) { setSuccess(`${values.length} device entries are ready. Sign in to register them.`); return }
    setBusy(true)
    let saved = 0
    try {
      for (const value of values) { await createDevice(value, value); saved++ }
      setSuccess(`${saved} devices registered. Model, offset and lock-card settings have not been saved.`)
      setImei('')
      setExcelImeis([])
      setFileName('')
      setRangeStart('')
      setDeviceQty('')
    } catch (reason) {
      setImei(values.slice(saved).join('\n'))
      setTab(0)
      setError(`${saved} devices registered. ${reason instanceof Error ? reason.message : 'Unable to register the remaining devices.'}`)
    } finally { setBusy(false) }
  }

  return <Stack spacing={2} sx={{ bgcolor: '#fff', p: 1.5, minHeight: 'calc(100vh - 180px)', color: '#222', fontFamily: 'Arial, sans-serif', '& .MuiButton-root, & .MuiOutlinedInput-root': { borderRadius: .3 } }}>
    <DeviceSectionNav />
    <Tabs value={tab} onChange={(_, value: number) => { setTab(value); setError(''); setSuccess('') }} aria-label="Device import method" sx={{ minHeight: 36, borderBottom: '1px solid #ddd', '& .MuiTab-root': { minHeight: 36, fontSize: 14, color: '#222', px: 2 }, '& .Mui-selected': { color: '#00998c !important' }, '& .MuiTabs-indicator': { bgcolor: '#5cb879' } }}>
      <Tab id="add-text-tab" aria-controls="device-import-panel" label="Add text" disabled={busy} /><Tab id="excel-import-tab" aria-controls="device-import-panel" label="Excel import" disabled={busy} /><Tab id="number-import-tab" aria-controls="device-import-panel" label="Import by number section" disabled={busy} />
    </Tabs>
    <Stack component="form" onSubmit={handleSubmit} spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}{success && <Alert severity="success">{success}</Alert>}
      {tab === 1 && <Box sx={row}><Box sx={label}>Load download</Box><Button type="button" onClick={() => void downloadTemplate()} disabled={busy} sx={{ flex: 1, minHeight: 37, color: '#365675', fontWeight: 400 }}>Download</Button></Box>}
      <Box sx={row}><Box component="label" htmlFor="device-model" sx={label}>Device Model</Box><Box component="select" id="device-model" value={model} onChange={event => setModel(event.target.value)} disabled={busy} sx={{ flex: 1, p: 1, minWidth: 0, border: 0, bgcolor: '#fff', fontSize: 14 }}><option value="2GSG加密">2GSG加密</option></Box></Box>
      <Box id="device-import-panel" role="tabpanel" aria-labelledby={['add-text-tab', 'excel-import-tab', 'number-import-tab'][tab]}>
        {tab === 1 && <Box sx={row}><Box sx={label}>Select file</Box><Button component="label" role="button" tabIndex={0} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.querySelector('input')?.click() } }} disabled={busy} aria-label="Select Excel import file" sx={{ flex: 1, minHeight: 37, color: '#52616c', fontWeight: 400, gap: 1 }}><CloudUploadOutlined sx={{ fontSize: 18 }} />{fileName}<input type="file" accept=".xls,.xlsx" hidden disabled={busy} onChange={event => { void importExcel(event.target.files?.[0]); event.target.value = '' }} /></Button></Box>}
        {tab === 2 && <Stack spacing={2}>
          <Box sx={row}><Box component="label" htmlFor="start-number" sx={label}>Start number</Box><Box component="input" id="start-number" type="text" inputMode="numeric" placeholder="Start number" value={rangeStart} onChange={event => setRangeStart(event.target.value)} disabled={busy} sx={{ flex: 1, width: 0, minHeight: 37, border: 0, px: 1.25, font: '14px Arial, sans-serif' }} /></Box>
          <Box sx={row}><Box component="label" htmlFor="device-qty" sx={label}>Device Qty</Box><Box component="input" id="device-qty" type="number" min={1} max={500} step={1} placeholder="Device Qty" value={deviceQty} onChange={event => setDeviceQty(event.target.value)} disabled={busy} sx={{ flex: 1, width: 0, minHeight: 37, border: 0, px: 1.25, font: '14px Arial, sans-serif' }} /></Box>
        </Stack>}
        {tab === 0 && <Box sx={{ border: '1px solid #ddd' }}><Box component="label" htmlFor="device-imeis" sx={{ display: 'block', p: 1.5, bgcolor: '#fafafa', borderBottom: '1px solid #ddd', fontSize: 14 }}>Imei</Box><Box component="textarea" id="device-imeis" value={imei} onChange={event => setImei(event.target.value)} placeholder="Imei" disabled={busy} sx={{ width: '100%', height: 100, display: 'block', border: 0, p: 1.25, resize: 'vertical', font: '14px Arial, sans-serif' }} /></Box>}
      </Box>
      <Box sx={row}><Box id="offset-label" sx={label}>Is Offset</Box><RadioGroup row aria-labelledby="offset-label" value={offset} onChange={event => setOffset(event.target.value)} sx={{ pl: 1 }}><FormControlLabel value="yes" control={<Radio size="small" color="success" disabled={busy} />} label="Yes" /><FormControlLabel value="no" control={<Radio size="small" color="success" disabled={busy} />} label="No" /></RadioGroup></Box>
      <Box sx={row}><Box id="lock-label" sx={label}>Lock Card</Box><RadioGroup row aria-labelledby="lock-label" value={lockCard} onChange={event => setLockCard(event.target.value)} sx={{ pl: 1 }}><FormControlLabel value="no" control={<Radio size="small" color="success" disabled={busy} />} label="No" /><FormControlLabel value="yes" control={<Radio size="small" color="success" disabled={busy} />} label="Yes" /></RadioGroup></Box>
      <Box sx={{ pl: { xs: 0, sm: '110px' } }}><Button type="submit" variant="contained" disabled={busy} sx={{ bgcolor: '#00998c', minWidth: 56 }}>{busy ? 'Processing...' : 'OK'}</Button></Box>
    </Stack>
  </Stack>
}

