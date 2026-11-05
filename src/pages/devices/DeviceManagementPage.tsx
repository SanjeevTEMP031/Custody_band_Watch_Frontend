import { useCallback, useState } from 'react'
import DeviceSectionNav from '../../components/layout/DeviceSectionNav'
import { Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from '@mui/material'
import DeviceTable from './DeviceTable'
import ApiFeedback from '../../components/common/ApiFeedback'
import { useApiData } from '../../hooks/useApiData'
import { assignDevice, getAccessToken, listDevices, listPeople, unassignDevice } from '../../services/api'

function DeviceManagementPage() {
  const [exporting, setExporting] = useState(false)
  const [search, setSearch] = useState('')
  const [lookup, setLookup] = useState('')
  const [status, setStatus] = useState('All')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [actionError, setActionError] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null)
  const [selectedPersonId, setSelectedPersonId] = useState('')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [singleDeleteDevice, setSingleDeleteDevice] = useState<any>(null)
  const loadData = useCallback(async () => {
    if (!getAccessToken()) return { devices: [], people: [] }
    const [devices, people] = await Promise.all([listDevices(0, 500), listPeople(0, 500)])
    return { devices, people }
  }, [])
  const { data, loading, error, reload } = useApiData(loadData)
  const filteredDevices = (data?.devices ?? []).filter(device =>
    (status === 'All' || device.status === status) &&
    (!lookup || `${device.imei ?? ''} ${device.serial_number}`.toLowerCase().includes(lookup.toLowerCase())),
  )
  const pageCount = Math.max(1, Math.ceil(filteredDevices.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const exportDevices = async () => {
    setExporting(true)
    setActionError('')
    try {
      const { downloadDeviceWorkbook } = await import('./deviceExport')
      downloadDeviceWorkbook(filteredDevices)
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to export devices.')
    } finally {
      setExporting(false)
    }
  }

  const handleUnassign = async (deviceId: number) => {
    setActionError('')
    try {
      await unassignDevice(deviceId)
      reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to unassign device.')
    }
  }

  const handleAssign = async () => {
    if (selectedDeviceId === null || !selectedPersonId) return
    setActionError('')
    try {
      await assignDevice(selectedDeviceId, Number(selectedPersonId))
      setSelectedDeviceId(null)
      setSelectedPersonId('')
      reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Unable to assign device.')
    }
  }

  return (
    <Stack spacing={1.5} sx={{ bgcolor: '#fff', p: 1.5, minWidth: 0, minHeight: 'calc(100vh - 180px)', '& .MuiButton-root': { borderRadius: .3 }, '& .MuiOutlinedInput-root': { borderRadius: .3 } }}>
      {actionError && <Alert severity="error" onClose={() => setActionError('')}>{actionError}</Alert>}
      {actionNotice && <Alert severity="success" onClose={() => setActionNotice('')}>{actionNotice}</Alert>}
      <DeviceSectionNav />
      <Box component="form" onSubmit={event => { event.preventDefault(); setLookup(search.trim()); setPage(0) }} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <TextField size="small" label="IMEI / Device Name" value={search} onChange={event => setSearch(event.target.value)} />
        <TextField select size="small" label="Status" value={status} onChange={event => { setStatus(event.target.value); setPage(0) }} sx={{ minWidth: 180 }}>
          <MenuItem value="All">All</MenuItem>
          {[...new Set(data?.devices.map(device => device.status))].map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
        </TextField>
        <Button type="submit" variant="contained" sx={{ bgcolor: '#00998c', borderRadius: 0.5 }}>Lookup</Button>
                <Button
          type="button"
          variant="contained"
          color="error"
          onClick={() => setBulkDeleteOpen(true)}
          disabled={selectedIds.length === 0}
          sx={{ borderRadius: 0.5 }}
        >
          Bulk Delete Device ({selectedIds.length})
        </Button>
        <Button type="button" variant="contained" onClick={() => void exportDevices()} disabled={exporting || loading} sx={{ bgcolor: '#00998c', borderRadius: 0.5 }}>{exporting ? 'Exporting...' : 'Export'}</Button>
      </Box>
      <Card sx={{ borderRadius: 0, boxShadow: 'none', border: '1px solid #e3e3e3' }}>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 }, overflowX: 'auto' }}>
          <DeviceTable
            devices={filteredDevices.slice(currentPage * pageSize, (currentPage + 1) * pageSize)}
            onAssign={setSelectedDeviceId}
            onUnassign={id => void handleUnassign(id)}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onDeleteSingle={dev => setSingleDeleteDevice(dev)}
          />
          {(loading || error) && <Box sx={{ p: 1 }}><ApiFeedback loading={loading} error={error} empty={false} emptyMessage="" /></Box>}
        </CardContent>
      </Card>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button>
        <Typography variant="body2">{currentPage + 1} / {pageCount}</Typography>
        <Button disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</Button>
        <Button onClick={reload} disabled={loading}>Refresh</Button>
        <Typography variant="body2">Sum {filteredDevices.length} Rows</Typography>
        <TextField select size="small" label="Rows / Page" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(0) }} sx={{ minWidth: 130 }}>
          {[20, 50, 100].map(value => <MenuItem key={value} value={value}>{value} Rows/Page</MenuItem>)}
        </TextField>
      </Box>
      <Dialog open={selectedDeviceId !== null} onClose={() => setSelectedDeviceId(null)} fullWidth maxWidth="sm">
        <DialogTitle>Assign Device</DialogTitle>
        <DialogContent>
          <TextField
            select
            fullWidth
            label="Person"
            value={selectedPersonId}
            onChange={(event) => setSelectedPersonId(event.target.value)}
            sx={{ mt: 1 }}
          >
            {data?.people.map((person) => (
              <MenuItem key={person.id} value={String(person.id)}>
                {person.full_name} Â· {person.reference_no}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedDeviceId(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => void handleAssign()} disabled={!selectedPersonId}>Assign</Button>
        </DialogActions>
      </Dialog>
    
      {/* 3.1.5 Bulk Delete Device Confirmation Modal */}
      <Dialog open={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, color: '#dc2626' }}>Bulk Delete Device</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2}>
            <Alert severity="warning">
              Are you sure you want to remove the <strong>{selectedIds.length}</strong> selected device(s) from the platform? This operation cannot be undone.
            </Alert>
            <Typography variant="body2" color="text.secondary">
              Please enter <strong>CONFIRM</strong> to delete:
            </Typography>
            <TextField
              size="small"
              placeholder="CONFIRM"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => { setBulkDeleteOpen(false); setDeleteConfirmText('') }}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={deleteConfirmText !== 'CONFIRM'}
            onClick={() => {
              setActionNotice(`Successfully deleted ${selectedIds.length} device(s) in bulk.`)
              setSelectedIds([])
              setBulkDeleteOpen(false)
              setDeleteConfirmText('')
              reload()
            }}
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {/* Single Delete Device Confirmation */}
      <Dialog open={Boolean(singleDeleteDevice)} onClose={() => setSingleDeleteDevice(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, color: '#dc2626' }}>Delete Device</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Typography variant="body2">
            Are you sure you want to delete device <strong>{singleDeleteDevice?.device_name ?? singleDeleteDevice?.serial_number}</strong> (IMEI: {singleDeleteDevice?.imei})?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setSingleDeleteDevice(null)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              setActionNotice(`Successfully deleted device ${singleDeleteDevice?.device_name ?? singleDeleteDevice?.serial_number}.`)
              setSingleDeleteDevice(null)
              reload()
            }}
          >
            Confirm Delete
          </Button>
        </DialogActions>
      </Dialog>
</Stack>
  )
}

export default DeviceManagementPage


