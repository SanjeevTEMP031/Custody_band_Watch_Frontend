import { useCallback, useState } from 'react'
import { Alert, Box, Button, Stack, Switch, TextField } from '@mui/material'
import { useApiData } from '../../hooks/useApiData'
import { getAccessToken, listDevices } from '../../services/api'

export default function SelfHelpIntegrationPage() {
  const [imei, setImei] = useState('')
  const [command, setCommand] = useState('')
  const [hexView, setHexView] = useState(false)
  const [error, setError] = useState('')
  const [output, setOutput] = useState<string[]>([])
  const loadDevices = useCallback(() => getAccessToken() ? listDevices(0, 500) : Promise.resolve([]), [])
  const { data: devices, loading, error: devicesError } = useApiData(loadDevices)
  const append = (message: string) => setOutput(current => [...current.slice(-199), message])
  const startDebug = () => {
    setError('')
    const normalizedImei = imei.trim()
    if (!/^\d{15}$/.test(normalizedImei)) { setError('Enter a valid 15-digit IMEI.'); return }
    if (!devices?.some(device => device.imei === normalizedImei)) {
      setError(loading ? 'Wait for the device list to finish loading.' : devicesError || 'No registered device was found with this IMEI.')
      return
    }
    const message = `Debug session not started for ${normalizedImei}: the backend does not provide a device-debug session endpoint.`
    setError(message)
    append(message)
  }
  const send = () => {
    setError('')
    const normalizedImei = imei.trim()
    if (!/^\d{15}$/.test(normalizedImei)) { setError('Enter a valid 15-digit IMEI before sending a command.'); return }
    if (!devices?.some(device => device.imei === normalizedImei)) {
      setError(loading ? 'Wait for the device list to finish loading.' : devicesError || 'No registered device was found with this IMEI.')
      return
    }
    const hex = command.replace(/\s/g, '').toUpperCase()
    if (!hex || !/^[0-9A-F]+$/.test(hex) || hex.length % 2 !== 0) { setError('Enter a hexadecimal command with complete byte pairs, such as 01 AF 20.'); return }
    const message = `Command ${hex.match(/.{2}/g)?.join(' ')} was not sent to ${normalizedImei}: the backend does not provide a device-command endpoint.`
    setError(message)
    append(message)
  }
  const outputText = output.join('\n')
  const displayOutput = hexView ? Array.from(new TextEncoder().encode(outputText), byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ') : outputText
  const field = { '& .MuiOutlinedInput-root': { bgcolor: '#fff', borderRadius: 0, font: '14px Arial, sans-serif' } }
  return <Stack spacing={0} sx={{ bgcolor: '#fff', minWidth: 0, minHeight: 'calc(100vh - 180px)' }}>
    <Alert severity="info" sx={{ borderRadius: 0 }}>
      Device debugging and command sending require backend endpoints that are not available in the current API. This screen validates registered IMEIs and command format, but cannot start a remote session or send commands.
    </Alert>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: .5, p: 2, bgcolor: '#f2f2f2', borderLeft: '4px solid #00998c' }}>
      <Box component="label" sx={{ display: 'flex', alignItems: 'center', bgcolor: hexView ? '#00998c' : '#d5d5d5', color: '#fff', font: '14px Arial, sans-serif', pl: 1, mr: 1 }}>Hex View<Switch size="small" checked={hexView} onChange={event => setHexView(event.target.checked)} slotProps={{ input: { 'aria-label': 'Hex View' } }} /></Box>
      <TextField size="small" placeholder="IMEI" value={imei} onChange={event => setImei(event.target.value)} slotProps={{ htmlInput: { 'aria-label': 'Device IMEI', inputMode: 'numeric', maxLength: 15 } }} sx={{ ...field, width: 182 }} />
      <Button type="button" variant="contained" disabled={loading || Boolean(devicesError)} onClick={startDebug} sx={{ bgcolor: '#00998c', borderRadius: .3, height: 38 }}>Start Debug</Button>
      <Button type="button" variant="outlined" disabled sx={{ bgcolor: '#fff', borderRadius: .3, height: 38, ml: 1.25 }}>End Debug</Button>
      <TextField size="small" placeholder="send command, hex string only" value={command} onChange={event => setCommand(event.target.value)} slotProps={{ htmlInput: { 'aria-label': 'Hexadecimal command' } }} sx={{ ...field, width: { xs: '100%', sm: 400 } }} />
      <Button type="button" variant="contained" onClick={send} sx={{ bgcolor: '#2196ff', borderRadius: .3, height: 38 }}>Send</Button>
    </Box>
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    {devicesError && <Alert severity="error">{devicesError}</Alert>}
    <Box sx={{ mt: 1.25, bgcolor: '#f2f2f2', borderLeft: '4px solid #00998c', p: 2, display: 'flex', alignItems: 'center', gap: .5, font: '14px Arial, sans-serif' }}>Output<Button type="button" onClick={() => { setOutput([]); setError('') }} sx={{ minWidth: 0, px: .5, py: .25, color: '#fff', bgcolor: '#ff5722', borderRadius: .2, font: '12px Arial, sans-serif', '&:hover': { bgcolor: '#e64a19' } }}>Clear</Button></Box>
    <Box component="textarea" aria-label="Debug output" placeholder="No debug output yet." readOnly value={displayOutput} sx={{ mt: 1.25, width: '100%', minHeight: 'max(330px, calc(100dvh - 380px))', resize: 'vertical', border: '1px solid #e3e3e3', p: 1.5, bgcolor: '#fff', color: '#333', font: '14px monospace' }} />
  </Stack>
}
