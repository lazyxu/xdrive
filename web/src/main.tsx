import React from 'react'
import ReactDOM from 'react-dom/client'
import { App as AntApp, ConfigProvider } from 'antd'
import { ThemeProvider as MuiThemeProvider } from '@mui/material'
import zhCN from 'antd/locale/zh_CN'
import { createXDriveMuiTheme } from '@xdrive/ui/mui'
import App from './App'
import './styles.css'

const muiTheme = createXDriveMuiTheme('light')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MuiThemeProvider theme={muiTheme}>
      <ConfigProvider locale={zhCN} theme={{ token: { borderRadius: 8 } }}>
        <AntApp>
          <App />
        </AntApp>
      </ConfigProvider>
    </MuiThemeProvider>
  </React.StrictMode>,
)
