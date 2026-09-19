import { Navigate, useLocation } from 'react-router-dom';
import { toWorkspacePathname } from '../constants/workspaces';

/**
 * Backwards compatibility for pre-RBAC, role-prefixed URLs.
 *
 * `/admin/*`, `/teamlead/*`, `/datavt/*`, `/datadg/*` and `/material-control/*`
 * are rewritten onto the single `/workspace/*` space, preserving the rest of the
 * path plus any query string and hash. `replace` drops the legacy entry from
 * history so Back does not bounce the user between both URLs.
 *
 * This is a client-side rewrite, not an HTTP 301 — a real 3xx would have to come
 * from the static host / CDN in front of this SPA.
 */
export const LegacyRoleRedirect = () => {
  const { pathname, search, hash } = useLocation();

  return <Navigate to={`${toWorkspacePathname(pathname)}${search}${hash}`} replace />;
};
