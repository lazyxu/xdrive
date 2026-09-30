import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider as MuiThemeProvider } from '@mui/material'
import { createXDriveMuiTheme } from '@xdrive/ui/mui'
import App from './App'
import './styles.css'

const muiTheme = createXDriveMuiTheme('light')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MuiThemeProvider theme={muiTheme}>
      <App />
    </MuiThemeProvider>
  </React.StrictMode>,
)
