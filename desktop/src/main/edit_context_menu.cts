export type EditContextMenuFlags = {
  canUndo?: boolean
  canRedo?: boolean
  canCut?: boolean
  canCopy?: boolean
  canPaste?: boolean
  canDelete?: boolean
  canSelectAll?: boolean
}

export type EditContextMenuItem =
  | { type: 'separator' }
  | {
      label: string
      role: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll'
      enabled: boolean
    }

export function editContextMenuTemplate(flags: EditContextMenuFlags): EditContextMenuItem[] {
  return [
    { label: '撤销', role: 'undo', enabled: !!flags.canUndo },
    { label: '重做', role: 'redo', enabled: !!flags.canRedo },
    { type: 'separator' },
    { label: '剪切', role: 'cut', enabled: !!flags.canCut },
    { label: '复制', role: 'copy', enabled: !!flags.canCopy },
    { label: '粘贴', role: 'paste', enabled: !!flags.canPaste },
    { label: '删除', role: 'delete', enabled: !!flags.canDelete },
    { type: 'separator' },
    { label: '全选', role: 'selectAll', enabled: !!flags.canSelectAll },
  ]
}
