import { createTheme, type PaletteMode } from '@mui/material/styles'

export const createAppTheme = (mode: PaletteMode) =>
  createTheme({
    palette: {
      mode,
      primary: {
        main: '#19a9f5',
        light: '#70c9fa',
        dark: '#087bb8',
      },
      secondary: {
        main: '#102b46',
      },
      success: {
        main: '#1fbf75',
      },
      warning: {
        main: '#f59e0b',
      },
      error: {
        main: '#ef4444',
      },
      background: {
        default: mode === 'light' ? '#f5f8fc' : '#071a2e',
        paper: mode === 'light' ? '#ffffff' : '#102b46',
      },
      text: {
        primary: mode === 'light' ? '#182b3d' : '#edf4ff',
        secondary: mode === 'light' ? '#657587' : '#b9c8d7',
      },
    },
    shape: {
      borderRadius: 16,
    },
    typography: {
      fontFamily: 'Inter, Roboto, Arial, sans-serif',
      h3: {
        fontWeight: 700,
      },
      h4: {
        fontWeight: 700,
      },
      h5: {
        fontWeight: 700,
      },
      button: {
        textTransform: 'none',
        fontWeight: 600,
      },
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            boxShadow: '0 12px 30px rgba(7, 26, 46, 0.08)',
            border: '1px solid #e5ebf1',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            boxShadow: 'none',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
    },
  })
