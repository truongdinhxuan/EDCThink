import { useEffect } from 'react';
import { formatDocumentTitle } from '../constants/documentTitle';

/**
 * Owns the browser tab title for as long as the calling page is mounted, and
 * hands it back on unmount.
 *
 * Restoring matters because routes are lazy: when navigation suspends, the old
 * page unmounts before the new one resolves. Without the restore the tab would
 * keep advertising a page the user has already left.
 *
 * Pass `undefined` while a dynamic title is still loading; the tab shows the app
 * name until the real value arrives.
 */
export const useDocumentTitle = (title?: string | null): void => {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = formatDocumentTitle(title);
    return () => {
      document.title = previousTitle;
    };
  }, [title]);
};
