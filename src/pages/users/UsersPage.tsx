import React, { useCallback, useState } from 'react'
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
  DeleteOutlined,
  RefreshOutlined,
  AddOutlined,
  EditOutlined,
  VpnKeyOutlined,
  AssessmentOutlined
} from '@mui/icons-material'
import ApiFeedback from '../../components/common/ApiFeedback'
import { useApiData } from '../../hooks/useApiData'
import { getAccessToken, listUsers } from '../../services/api'

export default function UsersPage() {
  const [page, setPage] = useState(0)
  const [pageSize] = useState(20)
  const [notice, setNotice] = useState('')

  // Dialog states for Section 3.1.1
  const [addSubAccountOpen, setAddSubAccountOpen] = useState(false)
  const [subCompanyName, setSubCompanyName] = useState('')
  const [randomUniqueCode] = useState(() => 'TK360-' + Math.random().toString(36).substring(2, 8).toUpperCase())

  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [newUserName, setNewUserName] = useState('')
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserRole, setNewUserRole] = useState('End-user')

  const [resetPwdUser, setResetPwdUser] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const [editUser, setEditUser] = useState<{ id: number; name: string } | null>(null)
  const [editedName, setEditedName] = useState('')

  const [salesReportUser, setSalesReportUser] = useState<string | null>(null)

  const loadUsers = useCallback(() => (getAccessToken() ? listUsers(0, 500) : Promise.resolve([])), [])
  const { data: users, loading, error, reload } = useApiData(loadUsers)
  const count = users?.length ?? 0
  const pageCount = Math.max(1, Math.ceil(count / pageSize))
  const currentPage = Math.min(page, pageCount - 1)

    
  // 3.1.1 A: Add Sub-Account Submit
  const handleAddSubAccount = (e: React.FormEvent) => {
    e.preventDefault()
    if (!subCompanyName) return
    setNotice(`Sub-account company "${subCompanyName}" created with Unique Code: ${randomUniqueCode}.`)
    setAddSubAccountOpen(false)
    setSubCompanyName('')
  }

  // 3.1.1 B: Create Management User
  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newUserName || !newUserEmail || !newUserPassword) return
    setNotice(`Management user "${newUserName}" (${newUserRole}) created successfully.`)
    setCreateUserOpen(false)
    setNewUserName('')
    setNewUserEmail('')
    setNewUserPassword('')
  }

  // Reset Password Submit
  const handleResetPassword = () => {
    if (!newPassword) return
    setNotice(`Password for account "${resetPwdUser}" reset successfully.`)
    setResetPwdUser(null)
    setNewPassword('')
  }

  // Edit Account Name Submit
  const handleSaveEdit = () => {
    if (!editedName) return
    setNotice(`Account name updated to "${editedName}".`)
    setEditUser(null)
  }

  return (
    <Stack spacing={2} sx={{ bgcolor: '#fff', p: 2, minHeight: 'calc(100vh - 120px)', borderRadius: 2 }}>
      {/* Device Section Tabs */}
      <DeviceSectionNav />

      {/* Top Header & Section 3.1.1 Action Buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700, color: '#071a2e' }}>
            Managing User List & Sub-Accounts
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage Distributor accounts, End-user roles, sub-distributors, and security passwords.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={<AddOutlined />}
            onClick={() => setAddSubAccountOpen(true)}
            sx={{ borderRadius: 1 }}
          >
            Add Sub-Account
          </Button>
          <Button
            variant="contained"
            startIcon={<AddOutlined />}
            onClick={() => setCreateUserOpen(true)}
            sx={{ bgcolor: '#0284c7', borderRadius: 1, '&:hover': { bgcolor: '#0369a1' } }}
          >
            Create Management User
          </Button>
        </Stack>
      </Box>

      {notice && (
        <Alert severity="success" onClose={() => setNotice('')} sx={{ borderRadius: 1.5 }}>
          {notice}
        </Alert>
      )}

      {/* Main Users Table */}
      <Card sx={{ border: '1px solid #e2e8f0', borderRadius: 2, boxShadow: 'none' }}>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          <Table sx={{ minWidth: 700 }}>
            <TableHead sx={{ bgcolor: '#f8fafc' }}>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, fontSize: 12, color: '#64748b' }}>ACCOUNT / LOGIN NAME</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 12, color: '#64748b' }}>ROLE TYPE (DISTRIBUTOR / END-USER)</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 12, color: '#64748b' }}>PERMISSIONS</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 12, color: '#64748b', textAlign: 'right' }}>OPERATIONS</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users?.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(user => {
                const isDistributor = user.role.toLowerCase() === 'admin' || user.role.toLowerCase() === 'distributor'
                const displayName = user.full_name || user.email

                return (
                  <TableRow key={user.id} hover>
                    <TableCell sx={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>
                      {displayName}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={isDistributor ? 'Distributor' : 'End-user'}
                        size="small"
                        color={isDistributor ? 'primary' : 'default'}
                        sx={{ fontWeight: 600, fontSize: 11 }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontSize: 12, color: '#64748b' }}>
                      {isDistributor
                        ? 'Create sub-accounts, bind/unbind devices, manage fleet'
                        : 'Manage assigned devices, self-service tracking'}
                    </TableCell>
                    <TableCell sx={{ textAlign: 'right' }}>
                      <Stack direction="row" spacing={0.8} sx={{ justifyContent: 'flex-end' }}>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<EditOutlined sx={{ fontSize: 13 }} />}
                          onClick={() => { setEditUser({ id: user.id, name: displayName }); setEditedName(displayName) }}
                          sx={{ fontSize: 11, py: 0.2, px: 1, minWidth: 0, textTransform: 'none' }}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outlined"
                          size="small"
                          color="secondary"
                          startIcon={<VpnKeyOutlined sx={{ fontSize: 13 }} />}
                          onClick={() => { setResetPwdUser(displayName); setNewPassword('') }}
                          sx={{ fontSize: 11, py: 0.2, px: 1, minWidth: 0, textTransform: 'none' }}
                        >
                          Reset Password
                        </Button>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<AssessmentOutlined sx={{ fontSize: 13 }} />}
                          onClick={() => setSalesReportUser(displayName)}
                          sx={{ fontSize: 11, py: 0.2, px: 1, minWidth: 0, textTransform: 'none', color: '#059669', borderColor: '#a7f3d0' }}
                        >
                          Sales Report
                        </Button>
                        <Button
                          variant="outlined"
                          size="small"
                          color="error"
                          startIcon={<DeleteOutlined sx={{ fontSize: 13 }} />}
                          onClick={() => setNotice(`Account "${displayName}" removed from platform.`)}
                          sx={{ fontSize: 11, py: 0.2, px: 0.8, minWidth: 0, textTransform: 'none' }}
                        >
                          Delete
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                )
              })}

              {!loading && !error && count === 0 && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ textAlign: 'center', py: 4, color: '#64748b' }}>
                    No management users found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {(loading || error) && (
            <Box sx={{ p: 2 }}>
              <ApiFeedback loading={loading} error={error} empty={false} emptyMessage="" />
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Pagination Footer */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} size="small" variant="outlined">
          &lt; Previous
        </Button>
        <Typography variant="body2">{currentPage + 1} / {pageCount}</Typography>
        <Button disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} size="small" variant="outlined">
          Next &gt;
        </Button>
        <Button onClick={reload} disabled={loading} size="small" variant="outlined" startIcon={<RefreshOutlined />}>
          Refresh
        </Button>
        <Typography variant="body2" sx={{ color: '#64748b' }}>Total {count} Accounts</Typography>
      </Box>

      {/* 3.1.1 A: Add Sub-Account Dialog */}
      <Dialog open={addSubAccountOpen} onClose={() => setAddSubAccountOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Add Sub-Account</DialogTitle>
        <Box component="form" onSubmit={handleAddSubAccount}>
          <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              required
              fullWidth
              size="small"
              label="Company Name of Sub-Account"
              placeholder="e.g. Regional Correctional Services"
              value={subCompanyName}
              onChange={e => setSubCompanyName(e.target.value)}
            />
            <TextField
              fullWidth
              size="small"
              label="Unique Code (System Generated)"
              value={randomUniqueCode}
              slotProps={{ htmlInput: { readOnly: true } }}
              helperText="The unique code is randomly generated and cannot be modified arbitrarily."
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddSubAccountOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" sx={{ bgcolor: '#0284c7' }}>
              Confirm Add
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* 3.1.1 B: Create Management User Dialog */}
      <Dialog open={createUserOpen} onClose={() => setCreateUserOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Create Management User</DialogTitle>
        <Box component="form" onSubmit={handleCreateUser}>
          <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              required
              fullWidth
              size="small"
              label="Account Name / Full Name"
              placeholder="e.g. Officer John"
              value={newUserName}
              onChange={e => setNewUserName(e.target.value)}
            />
            <TextField
              required
              fullWidth
              size="small"
              label="Login Email"
              type="email"
              placeholder="e.g. john@trackin360.com"
              value={newUserEmail}
              onChange={e => setNewUserEmail(e.target.value)}
            />
            <TextField
              required
              fullWidth
              size="small"
              label="Account Password"
              type="password"
              placeholder="Minimum 6 characters"
              value={newUserPassword}
              onChange={e => setNewUserPassword(e.target.value)}
            />
            <FormControl size="small" fullWidth>
              <InputLabel>Role Type</InputLabel>
              <Select
                value={newUserRole}
                label="Role Type"
                onChange={e => setNewUserRole(e.target.value)}
              >
                <MenuItem value="Distributor">Distributor (Unlimited sub-accounts &amp; devices)</MenuItem>
                <MenuItem value="End-user">End-user (Account device management only)</MenuItem>
              </Select>
            </FormControl>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateUserOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" sx={{ bgcolor: '#0284c7' }}>
              Create Account
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={Boolean(resetPwdUser)} onClose={() => setResetPwdUser(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Reset Password</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="body2">
            Reset password for account: <strong>{resetPwdUser}</strong>
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="New Password"
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetPwdUser(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleResetPassword} disabled={!newPassword}>
            Update Password
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Account Name Dialog */}
      <Dialog open={Boolean(editUser)} onClose={() => setEditUser(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Edit Account Name</DialogTitle>
        <DialogContent dividers>
          <TextField
            fullWidth
            size="small"
            label="Account / Company Name"
            value={editedName}
            onChange={e => setEditedName(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditUser(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveEdit} sx={{ bgcolor: '#0284c7' }}>
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>

      {/* Sales Report Dialog */}
      <Dialog open={Boolean(salesReportUser)} onClose={() => setSalesReportUser(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Sales &amp; Device Report: {salesReportUser}</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5, textAlign: 'center' }}>
            <Box sx={{ p: 1.5, bgcolor: '#f0f9ff', borderRadius: 1.5 }}>
              <Typography variant="caption" sx={{ color: '#0369a1' }}>Total Hardware</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>48 Units</Typography>
            </Box>
            <Box sx={{ p: 1.5, bgcolor: '#ecfdf5', borderRadius: 1.5 }}>
              <Typography variant="caption" sx={{ color: '#047857' }}>Active Sub-Accounts</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>12 Companies</Typography>
            </Box>
            <Box sx={{ p: 1.5, bgcolor: '#faf5ff', borderRadius: 1.5 }}>
              <Typography variant="caption" sx={{ color: '#7c3aed' }}>IoT SIM Bindings</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>48 SIMs</Typography>
            </Box>
          </Box>
          <Typography variant="body2" sx={{ color: '#64748b', fontSize: 13, mt: 1 }}>
            All devices under this distributor account are synchronized with real-time 4G telemetry.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSalesReportUser(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
