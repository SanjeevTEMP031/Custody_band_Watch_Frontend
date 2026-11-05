import { useState, useMemo } from 'react'
import DeviceSectionNav from '../../components/layout/DeviceSectionNav'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import {
  Download,
  Plus,
  Search,
  Lock,
  Unlock,
} from 'lucide-react'

export interface SimCardRecord {
  id: number
  iccid: string
  phone_number: string
  imei: string
  device_name: string
  company: string
  carrier: string
  plan_data_gb: number
  used_data_gb: number
  activation_date: string
  expiration_date: string
  status: 'Normal' | 'Expired' | 'Suspended' | 'Not Activated'
  locked: boolean
}

const initialSimCards: SimCardRecord[] = []

export default function SimCardManagementPage() {
  const [simCards, setSimCards] = useState<SimCardRecord[]>(initialSimCards)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('All')
  const [companyFilter, setCompanyFilter] = useState<string>('All')
  const [selectedSim, setSelectedSim] = useState<SimCardRecord | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [isRechargeOpen, setIsRechargeOpen] = useState(false)
  const [isApnOpen, setIsApnOpen] = useState(false)
  const [notice, setNotice] = useState('')

  // New SIM form state
  const [newIccid, setNewIccid] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newImei, setNewImei] = useState('')
  const [newCarrier, setNewCarrier] = useState('Airtel IoT Enterprise')
  const [newPlan, setNewPlan] = useState('10')
  const [rechargeGb, setRechargeGb] = useState('5')

  const companies = useMemo(() => {
    return ['All', ...new Set(simCards.map(s => s.company))]
  }, [simCards])

  const filteredSims = useMemo(() => {
    return simCards.filter(sim => {
      const q = search.trim().toLowerCase()
      const matchesSearch =
        !q ||
        sim.iccid.toLowerCase().includes(q) ||
        sim.phone_number.toLowerCase().includes(q) ||
        sim.imei.toLowerCase().includes(q) ||
        sim.device_name.toLowerCase().includes(q)

      const matchesStatus = statusFilter === 'All' || sim.status === statusFilter
      const matchesCompany = companyFilter === 'All' || sim.company === companyFilter

      return matchesSearch && matchesStatus && matchesCompany
    })
  }, [simCards, search, statusFilter, companyFilter])

  // KPI Metrics
  const totalSims = simCards.length
  const activeSims = simCards.filter(s => s.status === 'Normal').length
  const expiredSims = simCards.filter(s => s.status === 'Expired').length

  // Toggle card lock
  const toggleLock = (id: number) => {
    setSimCards(curr =>
      curr.map(s => (s.id === id ? { ...s, locked: !s.locked } : s))
    )
    const card = simCards.find(s => s.id === id)
    setNotice('SIM Card ' + (card?.iccid || '') + ' lock state toggled.')
  }

  // Handle Add SIM
  const handleAddSim = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newIccid) return
    const newRecord: SimCardRecord = {
      id: Date.now(),
      iccid: newIccid,
      phone_number: newPhone || '+91 98000 00000',
      imei: newImei,
      device_name: newImei ? ('Band #' + newImei) : 'Unassigned SIM',
      company: 'Trackin360 Global',
      carrier: newCarrier,
      plan_data_gb: Number(newPlan) || 10,
      used_data_gb: 0,
      activation_date: new Date().toISOString().split('T')[0],
      expiration_date: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0],
      status: 'Normal',
      locked: false,
    }
    setSimCards(curr => [newRecord, ...curr])
    setIsAddOpen(false)
    setNewIccid('')
    setNewPhone('')
    setNewImei('')
    setNotice('Successfully added SIM Card ' + newRecord.iccid + ' to inventory.')
  }

  // Handle Recharge
  const handleRecharge = () => {
    if (!selectedSim) return
    const addGb = Number(rechargeGb) || 5
    setSimCards(curr =>
      curr.map(s =>
        s.id === selectedSim.id
          ? {
              ...s,
              plan_data_gb: s.plan_data_gb + addGb,
              status: 'Normal',
              expiration_date: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().split('T')[0],
            }
          : s
      )
    )
    setIsRechargeOpen(false)
    setNotice('Added ' + addGb + ' GB data package to ' + selectedSim.iccid + '.')
  }

  // Export to Excel
  const exportSims = async () => {
    try {
      const { utils, writeFile } = await import('xlsx')
      const rows = filteredSims.map(s => ({
        'ICCID': s.iccid,
        'Phone Number': s.phone_number,
        'Bound IMEI': s.imei || 'Unassigned',
        'Device Name': s.device_name,
        'Company': s.company,
        'Carrier': s.carrier,
        'Total Data (GB)': s.plan_data_gb,
        'Used Data (GB)': s.used_data_gb,
        'Activation Date': s.activation_date,
        'Expiration Date': s.expiration_date,
        'Status': s.status,
        'Card Locked': s.locked ? 'Yes' : 'No',
      }))
      const ws = utils.json_to_sheet(rows)
      const wb = utils.book_new()
      utils.book_append_sheet(wb, ws, 'SIM Cards')
      writeFile(wb, 'Trackin360_SIM_Cards_Inventory.xlsx')
      setNotice('SIM card inventory exported to Excel.')
    } catch {
      setNotice('Unable to export Excel spreadsheet.')
    }
  }

  return (
    <Stack spacing={2} sx={{ bgcolor: '#fff', p: 2, minHeight: 'calc(100vh - 120px)', borderRadius: 2 }}>
      {/* Device Section Tabs */}
      <DeviceSectionNav />

      {/* Page Heading & Notice */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, color: '#071a2e' }}>
            SIM Card Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            For distributors to manage IoT SIM cards bound to custody tracking bands.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<Download size={16} />}
            onClick={exportSims}
            sx={{ borderRadius: 1 }}
          >
            Export Excel
          </Button>
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            onClick={() => setIsAddOpen(true)}
            sx={{ bgcolor: '#0284c7', borderRadius: 1, '&:hover': { bgcolor: '#0369a1' } }}
          >
            Add SIM Card
          </Button>
        </Stack>
      </Box>

      {notice && (
        <Alert severity="success" onClose={() => setNotice('')} sx={{ borderRadius: 1.5 }}>
          {notice}
        </Alert>
      )}

      {/* KPI Cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
        <Card sx={{ bgcolor: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 2, boxShadow: 'none' }}>
          <CardContent sx={{ py: 1.5 }}>
            <Typography variant="caption" sx={{ color: '#0369a1', fontWeight: 600 }}>TOTAL SIM CARDS</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#071a2e', mt: 0.5 }}>{totalSims}</Typography>
            <Typography variant="body2" sx={{ color: '#64748b', fontSize: 12 }}>Bound &amp; Stock SIMs</Typography>
          </CardContent>
        </Card>
        <Card sx={{ bgcolor: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 2, boxShadow: 'none' }}>
          <CardContent sx={{ py: 1.5 }}>
            <Typography variant="caption" sx={{ color: '#047857', fontWeight: 600 }}>NORMAL / ACTIVE</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#059669', mt: 0.5 }}>{activeSims}</Typography>
            <Typography variant="body2" sx={{ color: '#64748b', fontSize: 12 }}>Live 4G LTE Telemetry</Typography>
          </CardContent>
        </Card>
        <Card sx={{ bgcolor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 2, boxShadow: 'none' }}>
          <CardContent sx={{ py: 1.5 }}>
            <Typography variant="caption" sx={{ color: '#b91c1c', fontWeight: 600 }}>EXPIRED / ATTENTION</Typography>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#dc2626', mt: 0.5 }}>{expiredSims}</Typography>
            <Typography variant="body2" sx={{ color: '#64748b', fontSize: 12 }}>Require Data Renewal</Typography>
          </CardContent>
        </Card>
      </Box>

      {/* Filter / Search Bar */}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search by ICCID, Phone, or IMEI..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{ minWidth: 260 }}
          slotProps={{
            input: {
              startAdornment: <Search size={16} style={{ marginRight: 8, color: '#64748b' }} />,
            },
          }}
        />

        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Status</InputLabel>
          <Select
            value={statusFilter}
            label="Status"
            onChange={e => setStatusFilter(e.target.value)}
          >
            <MenuItem value="All">All Statuses</MenuItem>
            <MenuItem value="Normal">Normal (Active)</MenuItem>
            <MenuItem value="Not Activated">Not Activated</MenuItem>
            <MenuItem value="Expired">Expired</MenuItem>
            <MenuItem value="Suspended">Suspended</MenuItem>
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Belongs Company</InputLabel>
          <Select
            value={companyFilter}
            label="Belongs Company"
            onChange={e => setCompanyFilter(e.target.value)}
          >
            {companies.map(c => (
              <MenuItem key={c} value={c}>{c}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <Button
          variant="outlined"
          onClick={() => { setSearch(''); setStatusFilter('All'); setCompanyFilter('All') }}
          sx={{ borderRadius: 1 }}
        >
          Reset Filters
        </Button>
      </Box>

      {/* Main SIM Cards Table */}
      <Card sx={{ border: '1px solid #e2e8f0', borderRadius: 2, boxShadow: 'none', overflowX: 'auto' }}>
        <Table sx={{ minWidth: 1100 }}>
          <TableHead sx={{ bgcolor: '#f8fafc' }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, fontSize: 12, color: '#64748b' }}>SIM ICCID</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: 12, color: '#64748b' }}>PHONE NUMBER</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: 12, color: '#64748b' }}>BOUND DEVICE / IMEI</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: 12, color: '#64748b' }}>CARRIER</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: 12, color: '#64748b', width: 170 }}>DATA USAGE (GB)</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: 12, color: '#64748b' }}>ACTIVATION</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: 12, color: '#64748b' }}>EXPIRATION</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: 12, color: '#64748b' }}>STATUS</TableCell>
              <TableCell sx={{ fontWeight: 700, fontSize: 12, color: '#64748b', textAlign: 'right' }}>OPERATIONS</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredSims.map(sim => {
              const usagePct = Math.min(100, Math.round((sim.used_data_gb / sim.plan_data_gb) * 100))
              const isExpired = sim.status === 'Expired'

              return (
                <TableRow key={sim.id} hover>
                  <TableCell sx={{ fontWeight: 600, fontSize: 13, fontFamily: 'monospace' }}>
                    {sim.iccid}
                  </TableCell>
                  <TableCell sx={{ fontSize: 13, color: '#334155' }}>
                    {sim.phone_number}
                  </TableCell>
                  <TableCell sx={{ fontSize: 13 }}>
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>{sim.device_name}</div>
                    <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{sim.imei || '—'}</div>
                  </TableCell>
                  <TableCell sx={{ fontSize: 13, color: '#334155' }}>
                    {sim.carrier}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ width: '100%' }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, mb: 0.5 }}>
                        <span>{sim.used_data_gb} GB</span>
                        <span style={{ color: '#64748b' }}>{sim.plan_data_gb} GB</span>
                      </Box>
                      <LinearProgress
                        variant="determinate"
                        value={usagePct}
                        sx={{
                          height: 6,
                          borderRadius: 3,
                          bgcolor: '#e2e8f0',
                          '& .MuiLinearProgress-bar': {
                            bgcolor: usagePct > 90 ? '#ef4444' : usagePct > 70 ? '#f59e0b' : '#10b981',
                          },
                        }}
                      />
                    </Box>
                  </TableCell>
                  <TableCell sx={{ fontSize: 12, color: '#64748b' }}>{sim.activation_date}</TableCell>
                  <TableCell sx={{ fontSize: 12, color: isExpired ? '#ef4444' : '#64748b', fontWeight: isExpired ? 700 : 400 }}>
                    {sim.expiration_date}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={sim.status}
                      size="small"
                      color={sim.status === 'Normal' ? 'success' : sim.status === 'Expired' ? 'error' : 'default'}
                      sx={{ fontWeight: 600, fontSize: 11 }}
                    />
                  </TableCell>
                  <TableCell sx={{ textAlign: 'right' }}>
                    <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => { setSelectedSim(sim); setIsRechargeOpen(true) }}
                        sx={{ fontSize: 11, py: 0.2, px: 1, minWidth: 0 }}
                      >
                        Renew
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color={sim.locked ? 'warning' : 'primary'}
                        onClick={() => toggleLock(sim.id)}
                        sx={{ fontSize: 11, py: 0.2, px: 1, minWidth: 0 }}
                        title={sim.locked ? 'Unlock Card' : 'Lock Card'}
                      >
                        {sim.locked ? <Lock size={12} /> : <Unlock size={12} />}
                      </Button>
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => { setSelectedSim(sim); setIsApnOpen(true) }}
                        sx={{ fontSize: 11, py: 0.2, px: 0.8, minWidth: 0, color: '#64748b' }}
                      >
                        APN
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              )
            })}

            {filteredSims.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} sx={{ textAlign: 'center', py: 4, color: '#64748b' }}>
                  No SIM cards match the selected query.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Add SIM Dialog */}
      <Dialog open={isAddOpen} onClose={() => setIsAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Add SIM Card to Inventory</DialogTitle>
        <Box component="form" onSubmit={handleAddSim}>
          <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              required
              fullWidth
              size="small"
              label="SIM ICCID Number"
              placeholder="e.g. 8991404018309550012F"
              value={newIccid}
              onChange={e => setNewIccid(e.target.value)}
            />
            <TextField
              fullWidth
              size="small"
              label="Mobile Phone Number (MSISDN)"
              placeholder="e.g. +91 98765 43210"
              value={newPhone}
              onChange={e => setNewPhone(e.target.value)}
            />
            <TextField
              fullWidth
              size="small"
              label="Bound Device IMEI (Optional)"
              placeholder="15-digit hardware band IMEI"
              value={newImei}
              onChange={e => setNewImei(e.target.value)}
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Telecom Carrier</InputLabel>
              <Select
                value={newCarrier}
                label="Telecom Carrier"
                onChange={e => setNewCarrier(e.target.value)}
              >
                <MenuItem value="Airtel IoT Enterprise">Airtel IoT Enterprise</MenuItem>
                <MenuItem value="Jio Enterprise IoT">Jio Enterprise IoT</MenuItem>
                <MenuItem value="Vodafone Idea IoT">Vodafone Idea IoT</MenuItem>
                <MenuItem value="China Mobile IoT">China Mobile IoT</MenuItem>
              </Select>
            </FormControl>
            <TextField
              fullWidth
              size="small"
              label="Data Plan (GB)"
              type="number"
              value={newPlan}
              onChange={e => setNewPlan(e.target.value)}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" sx={{ bgcolor: '#0284c7' }}>
              Add SIM
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Renew / Recharge Plan Dialog */}
      <Dialog open={isRechargeOpen} onClose={() => setIsRechargeOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Renew Data Package</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="body2">
            Target ICCID: <strong>{selectedSim?.iccid}</strong>
          </Typography>
          <Typography variant="body2">
            Current Plan: <strong>{selectedSim?.plan_data_gb} GB</strong> ({selectedSim?.status})
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="Additional Data (GB)"
            type="number"
            value={rechargeGb}
            onChange={e => setRechargeGb(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsRechargeOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleRecharge} sx={{ bgcolor: '#0284c7' }}>
            Confirm Renewal
          </Button>
        </DialogActions>
      </Dialog>

      {/* APN Details Dialog */}
      <Dialog open={isApnOpen} onClose={() => setIsApnOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>SIM Card &amp; APN Profile</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="body2"><strong>ICCID:</strong> {selectedSim?.iccid}</Typography>
          <Typography variant="body2"><strong>MSISDN:</strong> {selectedSim?.phone_number}</Typography>
          <Typography variant="body2"><strong>Operator:</strong> {selectedSim?.carrier}</Typography>
          <Typography variant="body2"><strong>APN:</strong> iot.airtel.in / jionet (Auto-detected)</Typography>
          <Typography variant="body2"><strong>IP Protocol:</strong> IPv4 / IPv6 Dual Stack</Typography>
          <Typography variant="body2"><strong>Roaming:</strong> Domestic Enabled</Typography>
          <Typography variant="body2"><strong>Card Lock:</strong> {selectedSim?.locked ? 'Locked to IMEI' : 'Unlocked'}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsApnOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
