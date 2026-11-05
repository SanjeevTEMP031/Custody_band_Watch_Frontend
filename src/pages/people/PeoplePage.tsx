import { useCallback, useMemo, useState } from 'react'
import { Box, Card, CardContent, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material'
import ApiFeedback from '../../components/common/ApiFeedback'
import { useApiData } from '../../hooks/useApiData'
import { listDevices, listPeople, type CustodyPerson, type Device } from '../../services/api'

function PeoplePage() {
  const [search, setSearch] = useState('')
  const loadPeople = useCallback(async () => {
    const [people, devices] = await Promise.all([listPeople(0, 500), listDevices(0, 500)])
    return { people, devices }
  }, [])
  const { data, loading, error } = useApiData(loadPeople)
  const people = useMemo(() => {
    if (!data) return []
    const query = search.trim().toLocaleLowerCase()
    return data.people.filter((person) => !query
      || person.full_name.toLocaleLowerCase().includes(query)
      || person.reference_no.toLocaleLowerCase().includes(query))
  }, [data, search])

  const deviceForPerson = (person: CustodyPerson): Device | undefined =>
    data?.devices.find((device) => device.custody_person_id === person.id)

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>People Management</Typography>
          <Typography variant="body2" color="text.secondary">People and assigned tracking device details from the API</Typography>
        </Box>
        <TextField size="small" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people" />
      </Box>
      <Card>
        <CardContent sx={{ overflowX: 'auto' }}>
          <Table sx={{ minWidth: 900 }}>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Reference No.</TableCell>
                <TableCell>Date of Birth</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Device Serial</TableCell>
                <TableCell>IMEI</TableCell>
                <TableCell>Battery</TableCell>
                <TableCell>Last Seen</TableCell>
                <TableCell>Last Location</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {people.map((person) => {
                const device = deviceForPerson(person)
                return (
                  <TableRow key={person.id} hover>
                    <TableCell>
                      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                        <Box sx={{ width: 36, height: 36, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: 'white', fontWeight: 700 }}>
                          {person.full_name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}
                        </Box>
                        {person.full_name}
                      </Stack>
                    </TableCell>
                    <TableCell>{person.reference_no}</TableCell>
                    <TableCell>{person.date_of_birth ?? '—'}</TableCell>
                    <TableCell><Chip label={person.status} size="small" variant="outlined" /></TableCell>
                    <TableCell>{device?.serial_number ?? '—'}</TableCell>
                    <TableCell>{device?.imei ?? '—'}</TableCell>
                    <TableCell>{device?.battery_pct == null ? '—' : `${device.battery_pct}%`}</TableCell>
                    <TableCell>{device?.last_seen ? new Date(device.last_seen).toLocaleString() : '—'}</TableCell>
                    <TableCell>
                      {device?.last_latitude != null && device.last_longitude != null
                        ? `${device.last_latitude}, ${device.last_longitude}`
                        : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
              {data && people.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9}>
                    <ApiFeedback loading={false} error="" empty emptyMessage={search ? 'No people match your search.' : 'No people returned by the API.'} />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {!data && <ApiFeedback loading={loading} error={error} empty={false} emptyMessage="" />}
        </CardContent>
      </Card>
    </Stack>
  )
}

export default PeoplePage
