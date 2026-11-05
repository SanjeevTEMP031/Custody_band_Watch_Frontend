import { Alert, Box, Stack, Typography } from '@mui/material'

function AttendancePage() {
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>Attendance</Typography>
        <Typography variant="body2" color="text.secondary">Attendance records and time summaries</Typography>
      </Box>
      <Alert severity="info">
        Attendance data is not available because the current backend API does not expose an attendance endpoint.
      </Alert>
    </Stack>
  )
}

export default AttendancePage
