export type XDriveUploadConflictPolicy = 'fail' | 'skip' | 'keep_both'

export type XDriveUploadConflictResolution = Exclude<XDriveUploadConflictPolicy, 'fail'>

export type XDriveUploadConflictPreflight = {
  conflict: boolean
}
