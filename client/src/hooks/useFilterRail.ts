import { useContext } from 'react';
import { FilterRailContext } from '../components/filters/FilterRailContext';

export const useFilterRail = () => {
  const context = useContext(FilterRailContext);
  if (!context) {
    throw new Error('useFilterRail must be used within FilterRailProvider');
  }
  return context;
};
