import React from 'react'
import ReactDOM from 'react-dom/client'
import { CssBaseline, ThemeProvider, createTheme, useMediaQuery } from '@mui/material'
import App from './App'
import './styles.css'

function Root() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true })
  const theme = React.useMemo(() => createTheme({
    palette: {
      mode: prefersDark ? 'dark' : 'light',
      primary: { main: prefersDark ? '#5f8ff4' : '#4177e6' },
      background: {
        default: prefersDark ? '#0f141d' : '#f5f7fb',
        paper: prefersDark ? '#171d27' : '#ffffff',
      },
    },
    typography: {
      fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    shape: { borderRadius: 10 },
  }), [prefersDark])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
