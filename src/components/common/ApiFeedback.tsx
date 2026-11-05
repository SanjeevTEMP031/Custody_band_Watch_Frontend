import { Alert, CircularProgress, Stack, Typography } from '@mui/material'

interface ApiFeedbackProps {
  loading: boolean
  error: string
  empty: boolean
  emptyMessage: string
}

function ApiFeedback({ loading, error, empty, emptyMessage }: ApiFeedbackProps) {
  if (loading) {
    return (
      <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'center', alignItems: 'center', py: 5 }}>
        <CircularProgress size={20} />
        <Typography color="text.secondary">Loading data from the API…</Typography>
      </Stack>
    )
  }

  if (error) return <Alert severity="error" sx={{ my: 2 }}>{error}</Alert>
  if (empty) return <Typography color="text.secondary" align="center" sx={{ py: 5 }}>{emptyMessage}</Typography>
  return null
}

export default ApiFeedback
