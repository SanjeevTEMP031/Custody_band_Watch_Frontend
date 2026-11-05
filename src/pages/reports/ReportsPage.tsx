import { Alert, Box, Stack, Typography } from '@mui/material'

function ReportsPage() {
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>Reports</Typography>
        <Typography variant="body2" color="text.secondary">Export and analytics</Typography>
      </Box>
      <Alert severity="info">
        Report generation and export endpoints are not available in the current backend API.
      </Alert>
    </Stack>
  )
}

export default ReportsPage
