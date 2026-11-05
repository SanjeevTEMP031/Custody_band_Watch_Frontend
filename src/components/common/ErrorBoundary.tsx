import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Box, Button, Typography, Paper } from '@mui/material'
import { RefreshOutlined } from '@mui/icons-material'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Trackin360 Dashboard ErrorBoundary caught:', error, errorInfo)
  }

  handleReload = () => {
    this.setState({ hasError: false })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: '#071a2e', p: 3, color: '#edf4ff' }}>
          <Paper sx={{ p: 4, maxWidth: 480, textAlign: 'center', bgcolor: '#0f294a', color: '#edf4ff', borderRadius: 3, border: '1px solid rgba(255,255,255,0.15)' }}>
            <Typography variant="h5" sx={{ fontWeight: 700, mb: 1, color: '#60a5fa' }}>
              Dashboard Ready
            </Typography>
            <Typography sx={{ color: '#94a3b8', mb: 3, fontSize: 14 }}>
              The application encountered a display glitch. Click below to refresh your view.
            </Typography>
            <Button
              variant="contained"
              startIcon={<RefreshOutlined />}
              onClick={this.handleReload}
              sx={{ bgcolor: '#2563eb', fontWeight: 600, px: 3, py: 1 }}
            >
              Reload Dashboard
            </Button>
          </Paper>
        </Box>
      )
    }

    return this.props.children
  }
}
