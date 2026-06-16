import type { ModuleRegistry } from '@crm/core';

const baseSchema = `
  type Query {
    contacts(page: Int, pageSize: Int, search: String, status: String): ContactPage!
    contact(id: ID!): Contact
    companies(page: Int, pageSize: Int, search: String): CompanyPage!
    deals(pipelineId: ID, stageId: String, status: String): [Deal!]!
    deal(id: ID!): Deal
    pipeline(id: ID!): Pipeline
    pipelines: [Pipeline!]!
    activities(contactId: ID, dealId: ID, status: String): [Activity!]!
    voiceCalls(direction: String, status: String, page: Int): VoiceCallPage!
    dashboardStats: DashboardStats!
    tenant: Tenant!
  }

  type Mutation {
    createContact(input: CreateContactInput!): Contact!
    updateContact(id: ID!, input: UpdateContactInput!): Contact!
    deleteContact(id: ID!): Boolean!
    createDeal(input: CreateDealInput!): Deal!
    moveDeal(id: ID!, stageId: String!): Deal!
    wonDeal(id: ID!): Deal!
    lostDeal(id: ID!, reason: String): Deal!
    createActivity(input: CreateActivityInput!): Activity!
    completeActivity(id: ID!, outcome: String): Activity!
    initiateCall(contactId: ID, toNumber: String!, fromNumber: String!): VoiceCallResult!
  }

  type Contact {
    id: ID!
    firstName: String!
    lastName: String
    email: String
    phone: String
    mobile: String
    jobTitle: String
    status: String!
    source: String!
    score: Int!
    tags: [String!]!
    companyId: ID
    companyName: String
    ownerId: ID!
    ownerName: String
    lastContactedAt: String
    createdAt: String!
    updatedAt: String!
  }

  type ContactPage {
    data: [Contact!]!
    total: Int!
    page: Int!
    pageSize: Int!
    totalPages: Int!
  }

  type Company {
    id: ID!
    name: String!
    domain: String
    industry: String
    size: String
    country: String
    website: String
    phone: String
    ownerId: ID!
    tags: [String!]!
    createdAt: String!
  }

  type CompanyPage {
    data: [Company!]!
    total: Int!
  }

  type Deal {
    id: ID!
    name: String!
    amount: Float
    currency: String!
    status: String!
    priority: String!
    stageId: String!
    pipelineId: ID!
    contactId: ID
    contactName: String
    companyId: ID
    companyName: String
    ownerId: ID!
    ownerName: String
    closeDate: String
    tags: [String!]!
    createdAt: String!
    updatedAt: String!
  }

  type Pipeline {
    id: ID!
    name: String!
    isDefault: Boolean!
    stages: [PipelineStage!]!
  }

  type PipelineStage {
    id: String!
    name: String!
    order: Int!
    probability: Int!
    color: String!
  }

  type Activity {
    id: ID!
    type: String!
    subject: String!
    body: String
    status: String!
    priority: String!
    contactId: ID
    contactName: String
    dealId: ID
    dealName: String
    ownerId: ID!
    ownerName: String
    scheduledAt: String
    dueAt: String
    completedAt: String
    duration: Int
    outcome: String
    createdAt: String!
  }

  type VoiceCall {
    id: ID!
    externalCallId: String!
    provider: String!
    direction: String!
    status: String!
    fromNumber: String!
    toNumber: String!
    contactId: ID
    contactName: String
    botHandled: Boolean!
    duration: Int
    botIntent: String
    sentiment: String
    startedAt: String!
    endedAt: String
  }

  type VoiceCallPage {
    data: [VoiceCall!]!
    total: Int!
  }

  type VoiceCallResult {
    callId: String!
    externalCallId: String!
  }

  type DashboardStats {
    totalContacts: Int!
    newContacts30d: Int!
    openDeals: Int!
    pipelineValue: Float!
    dealsWon30d: Int!
    revenue30d: Float!
    calls30d: Int!
    overdueTasks: Int!
  }

  type Tenant {
    id: ID!
    name: String!
    slug: String!
    plan: String!
    status: String!
  }

  input CreateContactInput {
    firstName: String!
    lastName: String
    email: String
    phone: String
    jobTitle: String
    companyId: ID
    status: String
    source: String
    tags: [String!]
  }

  input UpdateContactInput {
    firstName: String
    lastName: String
    email: String
    phone: String
    jobTitle: String
    status: String
    tags: [String!]
  }

  input CreateDealInput {
    name: String!
    pipelineId: ID!
    stageId: String!
    contactId: ID
    companyId: ID
    amount: Float
    currency: String
    closeDate: String
    priority: String
  }

  input CreateActivityInput {
    type: String!
    subject: String!
    body: String
    contactId: ID
    dealId: ID
    dueAt: String
    scheduledAt: String
    priority: String
  }
`;

// Minimal resolvers — production would expand these significantly
const resolvers = {
  Query: {
    contacts: async (_: unknown, args: any, ctx: any) => {
      const offset = ((args.page ?? 1) - 1) * (args.pageSize ?? 25);
      const [{ count }] = await ctx.db.withTenant(ctx.tenant.id, async (client: any) => {
        const result = await client.query('SELECT COUNT(*) FROM contacts');
        return result.rows;
      });
      const data = await ctx.db.withTenant(ctx.tenant.id, async (client: any) => {
        const result = await client.query(
          `SELECT c.*, comp.name as company_name, u.name as owner_name
           FROM contacts c
           LEFT JOIN companies comp ON c.company_id = comp.id
           LEFT JOIN users u ON c.owner_id = u.id
           ${args.search ? `WHERE (c.first_name || ' ' || COALESCE(c.last_name,'') || ' ' || COALESCE(c.email,'')) ILIKE '%${args.search}%'` : ''}
           ORDER BY c.created_at DESC LIMIT $1 OFFSET $2`,
          [args.pageSize ?? 25, offset],
        );
        return result.rows;
      });
      return { data: data.map(mapContact), total: parseInt(count), page: args.page ?? 1, pageSize: args.pageSize ?? 25, totalPages: Math.ceil(parseInt(count) / (args.pageSize ?? 25)) };
    },

    deals: async (_: unknown, args: any, ctx: any) => {
      const data = await ctx.db.withTenant(ctx.tenant.id, async (client: any) => {
        const result = await client.query(
          `SELECT d.*, c.first_name || ' ' || COALESCE(c.last_name,'') as contact_name, u.name as owner_name
           FROM deals d
           LEFT JOIN contacts c ON d.contact_id = c.id
           LEFT JOIN users u ON d.owner_id = u.id
           WHERE d.status = ${args.status ? `'${args.status}'` : "'open'"}
           ${args.pipelineId ? `AND d.pipeline_id = '${args.pipelineId}'` : ''}
           ORDER BY d.updated_at DESC LIMIT 100`,
        );
        return result.rows;
      });
      return data.map(mapDeal);
    },

    dashboardStats: async (_: unknown, __: unknown, ctx: any) => {
      const [stats] = await ctx.db.withTenant(ctx.tenant.id, async (client: any) => {
        const result = await client.query(`
          SELECT
            (SELECT COUNT(*) FROM contacts) as total_contacts,
            (SELECT COUNT(*) FROM contacts WHERE created_at > NOW() - INTERVAL '30 days') as new_contacts_30d,
            (SELECT COUNT(*) FROM deals WHERE status = 'open') as open_deals,
            (SELECT COALESCE(SUM(amount),0) FROM deals WHERE status = 'open') as pipeline_value,
            (SELECT COUNT(*) FROM deals WHERE status = 'won' AND won_at > NOW() - INTERVAL '30 days') as deals_won_30d,
            (SELECT COALESCE(SUM(amount),0) FROM deals WHERE status = 'won' AND won_at > NOW() - INTERVAL '30 days') as revenue_30d,
            (SELECT COUNT(*) FROM voice_calls WHERE started_at > NOW() - INTERVAL '30 days') as calls_30d,
            (SELECT COUNT(*) FROM activities WHERE status = 'pending' AND due_at < NOW()) as overdue_tasks
        `);
        return result.rows;
      });
      return {
        totalContacts: parseInt(stats.total_contacts),
        newContacts30d: parseInt(stats.new_contacts_30d),
        openDeals: parseInt(stats.open_deals),
        pipelineValue: parseFloat(stats.pipeline_value),
        dealsWon30d: parseInt(stats.deals_won_30d),
        revenue30d: parseFloat(stats.revenue_30d),
        calls30d: parseInt(stats.calls_30d),
        overdueTasks: parseInt(stats.overdue_tasks),
      };
    },

    tenant: async (_: unknown, __: unknown, ctx: any) => ctx.tenant,
  },
};

function mapContact(row: any) {
  return {
    id: row.id, firstName: row.first_name, lastName: row.last_name,
    email: row.email, phone: row.phone, mobile: row.mobile,
    jobTitle: row.job_title, status: row.status, source: row.source,
    score: row.score, tags: row.tags, companyId: row.company_id,
    companyName: row.company_name, ownerId: row.owner_id, ownerName: row.owner_name,
    lastContactedAt: row.last_contacted_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapDeal(row: any) {
  return {
    id: row.id, name: row.name, amount: row.amount, currency: row.currency,
    status: row.status, priority: row.priority, stageId: row.stage_id,
    pipelineId: row.pipeline_id, contactId: row.contact_id, contactName: row.contact_name,
    companyId: row.company_id, ownerId: row.owner_id, ownerName: row.owner_name,
    closeDate: row.close_date, tags: row.tags, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function buildGraphQLSchema(_registry: ModuleRegistry) {
  return {
    typeDefs: baseSchema,
    resolvers,
  };
}
