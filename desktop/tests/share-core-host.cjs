'use strict'
// React unit-only host adapter. The *actual* XDriveFileExplorer runs in the
// SH-P021 Chromium/Gin/PostgreSQL/CAS test. Here we retain the Share bridge's
// real hooks, credential-scope callbacks and directory navigation while MUI
// layout/virtualized DOM and native browser downloads are tested separately.
// Never use this host as a performance measurement or production implementation.
module.exports = function createShareCoreHost(React, typeLabel) {
  return function ShareCoreHost({
    items, crumbs, loading, interactionLifecycleKey, viewMode,
    onViewModeChange, onOpenItem, onRefresh, canGoUp, onUp,
    getItemMenuItems, onDownloadItems, getSelectionActionDisabledReason,
    commandBarEnd,
  }) {
    const [selected, setSelected] = React.useState(null)
    const [context, setContext] = React.useState(null)
    const [properties, setProperties] = React.useState(null)
    React.useEffect(() => {
      setSelected(null)
      setContext(null)
      setProperties(null)
    }, [interactionLifecycleKey])
    const chosen = items.find(item => item.id === selected) || null
    const h = React.createElement
    const selectedDownloadDisabled = !chosen || !onDownloadItems ||
      !!getSelectionActionDisabledReason?.('download', [chosen], 1)
    const controls = [
      h('button', { key: 'list', onClick: () => onViewModeChange?.('details') }, '列表'),
      h('button', { key: 'grid', onClick: () => onViewModeChange?.('grid') }, '网格'),
      h('button', { key: 'refresh', 'aria-label': '刷新文件夹', onClick: onRefresh }, '刷新'),
      canGoUp && h('button', { key: 'up', onClick: onUp }, '上一级'),
      commandBarEnd,
      chosen && chosen.kind === 'dir' && h('button', { key: 'open',
        onClick: () => onOpenItem?.(chosen) }, '打开'),
      chosen && h('button', {
        key: 'download', 'data-xdrive-public-share-selected-download': true,
        disabled: selectedDownloadDisabled,
        onClick: () => onDownloadItems?.([chosen]),
      }, '下载'),
      chosen && h('button', {
        key: 'preview', 'data-xdrive-public-share-selected-preview': true,
        disabled: false,
      }, '预览'),
    ]
    const menuActions = context && [
      ...(getItemMenuItems?.(context) || []),
      { id: 'properties', label: '属性', onSelect: () => setProperties(context) },
    ]
    const pageRows = items.map(item => h('div', {
      key: item.id,
      role: 'listitem',
      'data-xdrive-public-share-item-id': item.id,
      'aria-selected': selected === item.id,
      onClick: () => setSelected(item.id),
      onDoubleClick: () => onOpenItem?.(item),
      onKeyDown: event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onOpenItem?.(item)
        }
      },
      onContextMenu: event => {
        event.preventDefault()
        setSelected(item.id)
        setContext(item)
      },
    }, item.name, ' · ', typeLabel(item.name, item.kind)))
    return h('div', { 'data-xdrive-public-share-folder-browser': true,
      'aria-busy': loading }, [
      h('div', { key: 'controls' }, controls),
      h('div', { key: 'region', 'aria-label': '分享文件夹内容',
        'aria-busy': loading, sx: { minHeight: 180 } },
      pageRows),
      context && h('div', { key: 'context', anchorReference: 'anchorPosition', open: true },
        menuActions.map(action => h('div', { key: action.id,
          onClick: () => {
            setContext(null)
            action.onSelect()
          },
        }, action.label))),
      properties && h('dialog', { key: 'properties', open: true }, [
        h('div', { key: 'name' }, '名称：', properties.name),
        h('div', { key: 'type' }, '类型：', typeLabel(properties.name, properties.kind)),
        h('div', { key: 'size' }, '大小：', properties.size ?? 0),
        h('button', { key: 'close', onClick: () => setProperties(null) }, '关闭'),
      ]),
    ])
  }
}
