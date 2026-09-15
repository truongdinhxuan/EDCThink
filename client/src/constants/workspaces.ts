import type { RoleCode } from './roles';

/**
 * Every authenticated user shares one workspace URL space. What a user may open
 * inside it is decided by permissions (`PermissionGuard`), not by the URL, so
 * there is no reason to fork the path per role.
 */
export const DEFAULT_WORKSPACE_BASE_PATH = '/workspace';

/**
 * Role-prefixed base paths shipped before the RBAC consolidation. Retained only
 * so old links and bookmarks can be rewritten onto `/workspace/*` instead of
 * dead-ending on the 404 page. Do not add new entries.
 */
export const LEGACY_WORKSPACE_BASE_PATHS = [
  '/admin',
  '/teamlead',
  '/datavt',
  '/datadg',
  '/material-control',
] as const;

/**
 * The workspace base path.
 *
 * @param _role Ignored. Accepted so existing call sites keep compiling while the
 * role argument is removed from them incrementally.
 * @deprecated Prefer `DEFAULT_WORKSPACE_BASE_PATH`.
 */
export const getRoleBasePath = (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _role?: RoleCode | null,
): string => DEFAULT_WORKSPACE_BASE_PATH;

/**
 * Landing page after login and the "back to dashboard" target.
 *
 * @param _role Ignored — see {@link getRoleBasePath}.
 */
export const getRoleHomePath = (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _role?: RoleCode | null,
): string => `${DEFAULT_WORKSPACE_BASE_PATH}/dashboard`;

/**
 * Builds an absolute workspace URL from a route-relative path.
 *
 * @param _role Ignored — see {@link getRoleBasePath}.
 */
export const getWorkspacePath = (
  _role: RoleCode | null | undefined,
  relativePath = '',
): string => {
  const normalizedPath = relativePath.replace(/^\/+/, '');
  return normalizedPath
    ? `${DEFAULT_WORKSPACE_BASE_PATH}/${normalizedPath}`
    : DEFAULT_WORKSPACE_BASE_PATH;
};

/**
 * Rewrites a legacy role-prefixed pathname onto `/workspace/*`.
 * Returns the pathname unchanged when it carries no legacy prefix.
 *
 * `/datadg/orders/42` -> `/workspace/orders/42`
 * `/admin`            -> `/workspace`
 */
export const toWorkspacePathname = (pathname: string): string => {
  const legacyBase = LEGACY_WORKSPACE_BASE_PATHS.find(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
  return legacyBase
    ? `${DEFAULT_WORKSPACE_BASE_PATH}${pathname.slice(legacyBase.length)}`
    : pathname;
};
