import { Box, Card, CardContent, Typography } from '@mui/material'

interface StatCardProps {
  title: string
  value: string
  delta: string
  tone: 'primary' | 'success' | 'warning' | 'error' | 'info'
}

const toneMap = {
  primary: '#1b63f2',
  success: '#1fbf75',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#14b8a6',
}

export function StatCard({ title, value, delta, tone }: StatCardProps) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent sx={{ p: 2.5 }}>
        <Typography variant="body2" color="text.secondary">
          {title}
        </Typography>
        <Box sx={{ mt: 1, display: 'flex', alignItems: 'end', justifyContent: 'space-between' }}>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            {value}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: toneMap[tone],
              bgcolor: `${toneMap[tone]}15`,
              px: 1,
              py: 0.5,
              borderRadius: 999,
              fontWeight: 700,
            }}
          >
            {delta}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  )
}
