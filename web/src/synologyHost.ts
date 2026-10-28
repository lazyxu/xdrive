import {
  createXDriveSynologyBackupLocalClient,
  createXDriveSynologyOwnerBackupSource,
  createXDriveSynologyCloudStorageDataSource,
  createXDriveSynologyBrowserStorageSource,
} from '@xdrive/ui/mui'
import type { XDriveWorkspaceHostAdapter } from '@xdrive/ui/mui'
import { createXDriveSynologyOwnerGallerySource } from '../../ui/shared/src/mui/SynologyOwnerGallerySource'

/**
 * DSM-only authenticated transport adapter for the shared xDrive application.
 * No page JSX, user token forwarding, unverified admin role or native stub.
 */
export function createXDriveSynologyHost(): XDriveWorkspaceHostAdapter {
  // DSM provides authenticated Host domain ports; ui/shared owns page JSX.
  const cgi = new URL('backup.cgi', window.location.href)
  const local = createXDriveSynologyBackupLocalClient(cgi.href)
  return {
    platform: 'synology',
    services: {
      localBackupClient: local,
      // Only the verified same-origin DSM CGI methods are enabled. The shared
      // Desktop Files command bar remains visible; no fake NAS upload/write.
      ownerFilesPage: {
        client: local,
        unavailableActions: {
          search: 'DSM 尚未接通当前 Server Owner 的全库搜索接口。',
          createFolder: 'DSM Owner 文件目前只读，不能创建文件夹。',
          uploadFiles: 'DSM Owner 文件上传尚未接通已授权 Host API。',
          uploadFolder: 'DSM Owner 文件夹上传尚未接通已授权 Host API。',
          copy: 'DSM Owner 文件目前没有经过授权的云端复制接口。',
          cut: 'DSM Owner 文件目前没有经过授权的移动接口。',
          paste: 'DSM Owner 文件目前没有经过授权的粘贴接口。',
          delete: 'DSM Owner 文件目前没有经过授权的删除接口。',
          rename: 'DSM Owner 文件目前没有经过授权的重命名接口。',
          moveTo: 'DSM Owner 文件目前没有经过授权的移动到接口。',
          copyTo: 'DSM Owner 文件目前没有经过授权的复制到接口。',
          manageTags: 'DSM Owner 文件目前没有经过授权的标签修改接口。',
        },
      },
      // Both Owner Files and Gallery reuse the same authenticated DSM CGI
      // client. Do not regress the current explicit read-only Files port.
      galleryPage: {
        source: createXDriveSynologyOwnerGallerySource(local),
        pageSize: 100,
      },
      deviceBackups: createXDriveSynologyOwnerBackupSource(local),
      cloudStorage: createXDriveSynologyCloudStorageDataSource(local),
      localStorage: createXDriveSynologyBrowserStorageSource(),
    },
    unavailableMessage: () =>
      '此功能采用与 Desktop 相同的页面；DSM 对应的认证 Host API 尚未接通，不能执行操作。',
  }
}
