import { createContext } from 'react';

export interface FilterRailCloseEvent {
  railId: string;
  restoreFocus: boolean;
  sequence: number;
}

export interface FilterRailContextValue {
  activeRailId: string | null;
  lastClose: FilterRailCloseEvent | null;
  openFilterRail: (railId: string) => void;
  closeFilterRail: (railId?: string, restoreFocus?: boolean) => void;
}

export const FilterRailContext = createContext<FilterRailContextValue | null>(null);
