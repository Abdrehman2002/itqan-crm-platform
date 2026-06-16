export interface Contact {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  mobile?: string;
  companyId?: string;
  jobTitle?: string;
  department?: string;
  ownerId: string;           // assigned user
  status: ContactStatus;
  source: LeadSource;
  tags: string[];
  customFields: Record<string, unknown>;
  score: number;             // lead scoring 0–100
  doNotCall: boolean;
  doNotEmail: boolean;
  lastContactedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ContactStatus = 'lead' | 'prospect' | 'customer' | 'churned' | 'unqualified';

export type LeadSource =
  | 'website'
  | 'voice_bot'
  | 'inbound_call'
  | 'outbound_call'
  | 'email_campaign'
  | 'social_media'
  | 'referral'
  | 'trade_show'
  | 'partner'
  | 'manual'
  | 'api'
  | 'import';

export interface Company {
  id: string;
  tenantId: string;
  name: string;
  domain?: string;
  industry?: string;
  size?: CompanySize;
  annualRevenue?: number;
  country?: string;
  city?: string;
  website?: string;
  phone?: string;
  ownerId: string;
  tags: string[];
  customFields: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type CompanySize = '1-10' | '11-50' | '51-200' | '201-500' | '501-1000' | '1000+';
