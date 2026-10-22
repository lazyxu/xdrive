#!/usr/bin/env node
// Security preflight for the *optional* standalone child Caddy host.
// Conservative on purpose: a pass is necessary but NOT sufficient for PSL,
// Cookie/Storage policy, enterprise DNS ownership or CSP effectiveness.
import {isIP} from 'node:net'

export function validateIndependentBaiduSites(gallery, child) {
  const suffix = value => {
    if (typeof value !== 'string' || value.length > 253 || !value.startsWith('https://')) return null
    let url
    try { url = new URL(value) } catch { return null }
    if (url.origin !== value || url.protocol !== 'https:' || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || url.port) return null
    const hostname = url.hostname.toLowerCase()
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || isIP(hostname) ||
        hostname.endsWith('.invalid') || hostname.endsWith('.test') ||
        hostname.endsWith('.example') || hostname.endsWith('.local') ||
        hostname.includes('..') || hostname.startsWith('.') || hostname.endsWith('.')) return null
    const labels = hostname.split('.')
    if (labels.length < 2 || labels.some(label => label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null
    return labels.slice(-2).join('.')
  }
  const a=suffix(gallery), b=suffix(child)
  return Boolean(a && b && a !== b)
}

if (process.argv[1]?.endsWith('/validate-site.mjs')) {
  const [gallery,child] = process.argv.slice(2)
  if (!validateIndependentBaiduSites(gallery,child)) {
    console.error('DENIED: require distinct trusted HTTPS Cookie sites; manual PSL/Domain/CSP review still mandatory')
    process.exitCode = 1
  } else {
    console.log('PREFLIGHT_OK: conservative site separation only; CSP/PSL/actual browser checks still mandatory')
  }
}
