import type { AdminUser } from './models'

export type XDriveAdminCreateUserInput = {
  username: string
  password: string
  role: 'user' | 'admin'
  must_change_password: boolean
  quota_bytes: number
}
export type XDriveAdminUpdateUserInput = {
  role?: 'user' | 'admin'
  disabled?: boolean
  quota_bytes?: number
}
/** One full CRUD and identity-administration contract for Web and Desktop. */
export type XDriveAdminUsersPort = {
  adminUsers(): Promise<AdminUser[]>
  adminCreateUser(input: XDriveAdminCreateUserInput): Promise<AdminUser>
  adminUpdateUser(id: number, input: XDriveAdminUpdateUserInput): Promise<AdminUser>
  adminResetPassword(id: number, password: string, mustChangePassword?: boolean): Promise<void>
  adminRevokeSessions(id: number): Promise<void>
  adminDeleteUser(id: number): Promise<void>
}
