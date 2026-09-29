import React from 'react'
import ReactDOM from 'react-dom/client'
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material'
import { createXDriveMuiTheme } from '@xdrive/ui/mui'
import App from './App'
import './styles.css'

function Root() {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true })
  const theme = React.useMemo(
    () => createXDriveMuiTheme(prefersDark ? 'dark' : 'light'),
    [prefersDark],
  )

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
