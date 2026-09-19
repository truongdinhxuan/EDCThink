/**
 * Product name shown in the browser tab, matching the wordmark in the sidebar
 * and on the login screen. Change it here and every tab follows.
 */
export const APP_NAME = 'EDCThink';

/**
 * Builds a tab title as "<page> · EDCThink".
 *
 * A blank or missing page name collapses to the app name alone, which is what a
 * page should pass while its real title is still loading: the tab then stays on
 * the product name instead of flashing a placeholder that is about to change.
 */
export const formatDocumentTitle = (title?: string | null): string => {
  const pageTitle = title?.trim();
  return pageTitle ? `${pageTitle} · ${APP_NAME}` : APP_NAME;
};
