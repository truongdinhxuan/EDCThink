import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  FilterRailContext,
  type FilterRailCloseEvent,
  type FilterRailContextValue,
} from './FilterRailContext';

export const FilterRailProvider = ({
  children,
  onRailOpen,
}: {
  children: ReactNode;
  onRailOpen?: () => void;
}) => {
  const [activeRailId, setActiveRailId] = useState<string | null>(null);
  const [lastClose, setLastClose] = useState<FilterRailCloseEvent | null>(null);
  const activeRailIdRef = useRef<string | null>(null);
  const closeSequence = useRef(0);

  const openFilterRail = useCallback((railId: string) => {
    onRailOpen?.();
    activeRailIdRef.current = railId;
    setActiveRailId(railId);
  }, [onRailOpen]);

  const closeFilterRail = useCallback((
    railId?: string,
    restoreFocus = true,
  ) => {
    const current = activeRailIdRef.current;
    if (!current || (railId && current !== railId)) return;
    closeSequence.current += 1;
    activeRailIdRef.current = null;
    setLastClose({
      railId: current,
      restoreFocus,
      sequence: closeSequence.current,
    });
    setActiveRailId(null);
  }, []);

  const value = useMemo<FilterRailContextValue>(() => ({
    activeRailId,
    lastClose,
    openFilterRail,
    closeFilterRail,
  }), [activeRailId, closeFilterRail, lastClose, openFilterRail]);

  return (
    <FilterRailContext.Provider value={value}>
      {children}
    </FilterRailContext.Provider>
  );
};
