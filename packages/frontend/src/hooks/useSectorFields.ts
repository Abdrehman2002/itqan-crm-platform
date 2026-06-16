/**
 * useSectorFields — fetches the current tenant's sector config + custom field definitions.
 * Returns both the static sector config and the live DB-stored field list.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import { getSector, type SectorConfig } from '@crm/shared';

export interface SectorFieldDef {
  id:          string;
  name:        string;
  label:       string;
  field_type:  'text' | 'email' | 'phone' | 'number' | 'date' | 'select' | 'textarea' | 'boolean';
  options:     string[] | null;
  is_required: boolean;
  sort_order:  number;
  /** true = seeded by sector, false = added by admin */
  is_custom?:  boolean;
}

export interface SectorData {
  sector:   string;
  config:   SectorConfig;
  fields:   SectorFieldDef[];
  isLoading: boolean;
}

export function useSectorFields(): SectorData {
  const { data, isLoading } = useQuery({
    queryKey: ['sector-fields'],
    queryFn: () => api.get('/api/v1/sector').then(r => r.data.data),
    staleTime: 5 * 60 * 1000,
  });

  return {
    sector:    data?.sector ?? 'other',
    config:    data?.config ?? getSector('other'),
    fields:    data?.fields ?? [],
    isLoading,
  };
}
