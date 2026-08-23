export interface PlatformAuthenticatedUser {
  id?: string;
  claims?: {
    sub?: string;
  };
  isAdmin?: boolean;
  isAdminBypass?: boolean;
  isMasterBypass?: boolean;
}

export function getPlatformUserId(user: PlatformAuthenticatedUser | null | undefined): string | undefined {
  const userId = user?.id ?? user?.claims?.sub;
  return typeof userId === 'string' && userId.length > 0 ? userId : undefined;
}

export function normalizePlatformUser<T extends PlatformAuthenticatedUser>(user: T): T & PlatformAuthenticatedUser {
  const userId = getPlatformUserId(user);

  return {
    ...user,
    ...(userId ? { id: userId } : {}),
    isAdmin: Boolean(user.isAdmin || user.isMasterBypass || user.isAdminBypass),
  };
}