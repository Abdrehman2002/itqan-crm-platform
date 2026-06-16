export interface Pipeline {
  id: string;
  tenantId: string;
  name: string;
  stages: PipelineStage[];
  isDefault: boolean;
  createdAt: Date;
}

export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  probability: number;       // 0–100 win probability %
  rottenAfterDays?: number;  // deal goes stale after N days
  color: string;
}

export interface Deal {
  id: string;
  tenantId: string;
  name: string;
  contactId?: string;
  companyId?: string;
  pipelineId: string;
  stageId: string;
  ownerId: string;
  amount?: number;
  currency: string;
  closeDate?: Date;
  status: DealStatus;
  priority: 'low' | 'medium' | 'high';
  source: string;
  tags: string[];
  customFields: Record<string, unknown>;
  lostReason?: string;
  wonAt?: Date;
  lostAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type DealStatus = 'open' | 'won' | 'lost';

export interface DealHistory {
  id: string;
  dealId: string;
  tenantId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  changedBy: string;
  changedAt: Date;
}
