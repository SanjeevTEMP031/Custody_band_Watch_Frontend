import { Alert, Box, Stack, Typography } from '@mui/material'

function SettingsPage() {
  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>Settings</Typography>
        <Typography variant="body2" color="text.secondary">Platform configuration</Typography>
      </Box>
      <Alert severity="info">
        The current backend API does not expose configuration settings. Settings are not shown as editable until a persistence endpoint is available.
      </Alert>
    </Stack>
  )
}

export default SettingsPage
