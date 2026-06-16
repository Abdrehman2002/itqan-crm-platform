/**
 * Sector definitions for multi-vertical CRM.
 *
 * Each sector declares:
 *  - id          : machine key stored in tenants.sector
 *  - label       : display name
 *  - icon        : emoji for quick identification
 *  - description : shown on the registration picker
 *  - color       : brand accent for the sector badge
 *  - contactLabel: what "contacts" are called in this sector
 *  - fields      : default custom fields seeded into custom_field_definitions on signup
 *
 * Field types: text | email | phone | number | date | select | textarea | boolean
 */

export type FieldType = 'text' | 'email' | 'phone' | 'number' | 'date' | 'select' | 'textarea' | 'boolean';

export interface SectorField {
  name: string;           // machine key → stored in custom_fields JSONB
  label: string;          // shown in the form
  field_type: FieldType;
  is_required: boolean;
  sort_order: number;
  options?: string[];     // for select fields
  placeholder?: string;
  group?: string;         // visual grouping within the form
}

export interface SectorConfig {
  id: string;
  label: string;
  icon: string;
  description: string;
  color: string;
  bg: string;
  contactLabel: string;     // e.g. "Passenger", "Policyholder", "Student"
  contactLabelPlural: string;
  ticketLabel: string;      // e.g. "Case", "Claim", "Incident"
  departments: string[];    // default departments seeded on signup
  fields: SectorField[];
}

// ── Common field shared by every sector ────────────────────────────────────
const CUSTOMER_TYPE_FIELD: SectorField = {
  name:       'customer_type',
  label:      'Customer Type',
  field_type: 'select',
  is_required: true,
  sort_order: 0,
  options:    ['Individual', 'Company Employee', 'Corporate', 'SME', 'Government'],
  group:      'Identity',
};

// ══════════════════════════════════════════════════════════════════════════
// SECTOR DEFINITIONS
// ══════════════════════════════════════════════════════════════════════════
export const SECTORS: SectorConfig[] = [

  // ── 1. Banking ───────────────────────────────────────────────────────
  {
    id:                 'banking',
    label:              'Banking',
    icon:               '🏦',
    description:        'Retail & corporate banking, loans, accounts, and financial services',
    color:              '#1d4ed8',
    bg:                 '#eff6ff',
    contactLabel:       'Account Holder',
    contactLabelPlural: 'Account Holders',
    ticketLabel:        'Case',
    departments:        ['Retail Banking', 'Loans', 'Cards', 'Customer Support', 'Compliance'],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'account_number',    label: 'Account Number',     field_type: 'text',   is_required: true,  sort_order: 1, group: 'Account Details', placeholder: 'e.g. 0012345678' },
      { name: 'account_type',      label: 'Account Type',       field_type: 'select', is_required: true,  sort_order: 2, group: 'Account Details', options: ['Savings', 'Current', 'Fixed Deposit', 'Loan', 'Credit Card', 'Demat'] },
      { name: 'branch_name',       label: 'Branch Name',        field_type: 'text',   is_required: false, sort_order: 3, group: 'Account Details', placeholder: 'e.g. Main Street Branch' },
      { name: 'ifsc_swift_code',   label: 'IFSC / SWIFT Code',  field_type: 'text',   is_required: false, sort_order: 4, group: 'Account Details', placeholder: 'e.g. HDFC0001234' },
      { name: 'relationship_manager', label: 'Relationship Manager', field_type: 'text', is_required: false, sort_order: 5, group: 'Account Details' },
      { name: 'kyc_status',        label: 'KYC Status',         field_type: 'select', is_required: false, sort_order: 6, group: 'Compliance', options: ['Pending', 'Submitted', 'Verified', 'Rejected', 'Expired'] },
      { name: 'customer_since',    label: 'Customer Since',     field_type: 'date',   is_required: false, sort_order: 7, group: 'Account Details' },
      { name: 'preferred_contact', label: 'Preferred Contact',  field_type: 'select', is_required: false, sort_order: 8, group: 'Preferences', options: ['Phone', 'Email', 'Branch', 'App', 'SMS'] },
      { name: 'national_id',       label: 'National ID / PAN',  field_type: 'text',   is_required: false, sort_order: 9, group: 'Identity', placeholder: 'Government-issued ID' },
    ],
  },

  // ── 2. Telecom ───────────────────────────────────────────────────────
  {
    id:                 'telecom',
    label:              'Telecom',
    icon:               '📡',
    description:        'Mobile, broadband, TV, and enterprise telecom services',
    color:              '#7c3aed',
    bg:                 '#f5f3ff',
    contactLabel:       'Subscriber',
    contactLabelPlural: 'Subscribers',
    ticketLabel:        'Trouble Ticket',
    departments:        ['Mobile Services', 'Broadband', 'Enterprise', 'Technical Support', 'Billing'],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'mobile_number',     label: 'Mobile / Service Number', field_type: 'phone',  is_required: true,  sort_order: 1, group: 'Service Details', placeholder: 'Primary service number' },
      { name: 'account_number',    label: 'Account Number',           field_type: 'text',   is_required: true,  sort_order: 2, group: 'Service Details' },
      { name: 'plan_type',         label: 'Plan Type',                field_type: 'select', is_required: true,  sort_order: 3, group: 'Service Details', options: ['Prepaid', 'Postpaid', 'Enterprise', 'Family', 'SIM Only'] },
      { name: 'service_type',      label: 'Service Type',             field_type: 'select', is_required: true,  sort_order: 4, group: 'Service Details', options: ['Mobile', 'Broadband', 'TV', 'Fixed Line', 'IoT', 'Enterprise'] },
      { name: 'sim_serial',        label: 'SIM Serial (ICCID)',       field_type: 'text',   is_required: false, sort_order: 5, group: 'Technical', placeholder: 'e.g. 8944501234567890' },
      { name: 'imei_number',       label: 'IMEI Number',              field_type: 'text',   is_required: false, sort_order: 6, group: 'Technical' },
      { name: 'data_usage_gb',     label: 'Monthly Data Usage (GB)',  field_type: 'number', is_required: false, sort_order: 7, group: 'Usage' },
      { name: 'contract_end_date', label: 'Contract End Date',        field_type: 'date',   is_required: false, sort_order: 8, group: 'Service Details' },
      { name: 'roaming_enabled',   label: 'Roaming Enabled',          field_type: 'boolean',is_required: false, sort_order: 9, group: 'Service Details' },
    ],
  },

  // ── 3. Public Transport ──────────────────────────────────────────────
  {
    id:                 'public_transport',
    label:              'Public Transport',
    icon:               '🚌',
    description:        'Bus, rail, metro, ferry, and aviation passenger services',
    color:              '#059669',
    bg:                 '#f0fdf4',
    contactLabel:       'Passenger',
    contactLabelPlural: 'Passengers',
    ticketLabel:        'Complaint',
    departments:        ['Passenger Services', 'Operations', 'Ticketing', 'Lost & Found', 'Accessibility'],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'booking_reference',  label: 'Booking Reference #',    field_type: 'text',   is_required: true,  sort_order: 1, group: 'Journey Details', placeholder: 'e.g. BK-2024-00123' },
      { name: 'travel_mode',        label: 'Travel Mode',             field_type: 'select', is_required: true,  sort_order: 2, group: 'Journey Details', options: ['Bus', 'Train', 'Metro', 'Tram', 'Ferry', 'Airplane', 'Taxi / Ride-share'] },
      { name: 'traveling_from',     label: 'Traveling From',          field_type: 'text',   is_required: true,  sort_order: 3, group: 'Journey Details', placeholder: 'Origin station / city' },
      { name: 'traveling_to',       label: 'Traveling To',            field_type: 'text',   is_required: true,  sort_order: 4, group: 'Journey Details', placeholder: 'Destination station / city' },
      { name: 'date_of_travel',     label: 'Date of Travel',          field_type: 'date',   is_required: true,  sort_order: 5, group: 'Journey Details' },
      { name: 'vehicle_number',     label: 'Bus / Train / Flight No', field_type: 'text',   is_required: false, sort_order: 6, group: 'Journey Details', placeholder: 'e.g. TRN-204 / EK-501' },
      { name: 'seat_berth',         label: 'Seat / Berth / Class',    field_type: 'text',   is_required: false, sort_order: 7, group: 'Journey Details', placeholder: 'e.g. 14A / Sleeper' },
      { name: 'pnr_number',         label: 'PNR / Ticket Number',     field_type: 'text',   is_required: false, sort_order: 8, group: 'Journey Details' },
      { name: 'passenger_count',    label: 'Number of Passengers',    field_type: 'number', is_required: false, sort_order: 9, group: 'Journey Details' },
      { name: 'loyalty_card',       label: 'Loyalty Card / Pass No',  field_type: 'text',   is_required: false, sort_order: 10, group: 'Identity' },
      { name: 'accessibility_needs',label: 'Accessibility Requirements', field_type: 'textarea', is_required: false, sort_order: 11, group: 'Special Requirements', placeholder: 'Wheelchair, visual impairment, etc.' },
    ],
  },

  // ── 4. Logistics ─────────────────────────────────────────────────────
  {
    id:                 'logistics',
    label:              'Logistics',
    icon:               '🚚',
    description:        'Courier, freight, warehousing, and supply chain management',
    color:              '#d97706',
    bg:                 '#fffbeb',
    contactLabel:       'Shipper / Consignee',
    contactLabelPlural: 'Shippers & Consignees',
    ticketLabel:        'Dispute',
    departments:        ['Customer Service', 'Operations', 'Customs & Compliance', 'Warehousing', 'Last Mile'],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'tracking_number',   label: 'Tracking / AWB Number',   field_type: 'text',   is_required: true,  sort_order: 1, group: 'Shipment Details', placeholder: 'e.g. TRK1234567890' },
      { name: 'shipment_type',     label: 'Shipment Type',            field_type: 'select', is_required: true,  sort_order: 2, group: 'Shipment Details', options: ['Document', 'Parcel', 'Pallet', 'Full Container', 'LCL', 'Bulk', 'Cold Chain'] },
      { name: 'origin_address',    label: 'Origin Address',           field_type: 'textarea',is_required: true, sort_order: 3, group: 'Shipment Details' },
      { name: 'destination_address',label: 'Destination Address',     field_type: 'textarea',is_required: true, sort_order: 4, group: 'Shipment Details' },
      { name: 'expected_delivery', label: 'Expected Delivery Date',   field_type: 'date',   is_required: false, sort_order: 5, group: 'Shipment Details' },
      { name: 'weight_kg',         label: 'Weight (kg)',              field_type: 'number', is_required: false, sort_order: 6, group: 'Cargo Details' },
      { name: 'dimensions_cm',     label: 'Dimensions (L×W×H cm)',    field_type: 'text',   is_required: false, sort_order: 7, group: 'Cargo Details', placeholder: 'e.g. 40×30×20' },
      { name: 'cargo_type',        label: 'Cargo Type',               field_type: 'select', is_required: false, sort_order: 8, group: 'Cargo Details', options: ['General', 'Fragile', 'Hazardous', 'Perishable', 'High Value', 'Oversized'] },
      { name: 'declared_value',    label: 'Declared Value (USD)',     field_type: 'number', is_required: false, sort_order: 9, group: 'Cargo Details' },
      { name: 'customs_required',  label: 'Customs Declaration Required', field_type: 'boolean', is_required: false, sort_order: 10, group: 'Compliance' },
      { name: 'incoterms',         label: 'Incoterms',                field_type: 'select', is_required: false, sort_order: 11, group: 'Compliance', options: ['EXW','FCA','CPT','CIP','DAP','DPU','DDP','FAS','FOB','CFR','CIF'] },
    ],
  },

  // ── 5. Insurance ─────────────────────────────────────────────────────
  {
    id:                 'insurance',
    label:              'Insurance',
    icon:               '🛡️',
    description:        'Life, health, motor, property, and commercial insurance',
    color:              '#dc2626',
    bg:                 '#fef2f2',
    contactLabel:       'Policyholder',
    contactLabelPlural: 'Policyholders',
    ticketLabel:        'Claim',
    departments:        ['New Business', 'Claims', 'Renewals', 'Customer Support', 'Underwriting'],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'policy_number',     label: 'Policy Number',            field_type: 'text',   is_required: true,  sort_order: 1, group: 'Policy Details', placeholder: 'e.g. POL-2024-00123' },
      { name: 'policy_type',       label: 'Policy Type',              field_type: 'select', is_required: true,  sort_order: 2, group: 'Policy Details', options: ['Life', 'Health', 'Motor', 'Home', 'Travel', 'Commercial', 'Marine', 'Liability'] },
      { name: 'coverage_amount',   label: 'Sum Insured / Coverage',   field_type: 'number', is_required: false, sort_order: 3, group: 'Policy Details' },
      { name: 'premium_amount',    label: 'Annual Premium',           field_type: 'number', is_required: false, sort_order: 4, group: 'Policy Details' },
      { name: 'policy_start_date', label: 'Policy Start Date',        field_type: 'date',   is_required: false, sort_order: 5, group: 'Policy Details' },
      { name: 'policy_end_date',   label: 'Policy Expiry Date',       field_type: 'date',   is_required: false, sort_order: 6, group: 'Policy Details' },
      { name: 'claim_number',      label: 'Claim Number (if any)',    field_type: 'text',   is_required: false, sort_order: 7, group: 'Claim Details', placeholder: 'e.g. CLM-2024-0045' },
      { name: 'claim_status',      label: 'Claim Status',             field_type: 'select', is_required: false, sort_order: 8, group: 'Claim Details', options: ['No Claim', 'Draft', 'Submitted', 'Under Review', 'Approved', 'Paid', 'Rejected', 'Disputed'] },
      { name: 'agent_broker',      label: 'Agent / Broker Name',      field_type: 'text',   is_required: false, sort_order: 9, group: 'Policy Details' },
      { name: 'nominee',           label: 'Nominee / Beneficiary',    field_type: 'text',   is_required: false, sort_order: 10, group: 'Policy Details' },
      { name: 'date_of_birth',     label: 'Date of Birth',            field_type: 'date',   is_required: false, sort_order: 11, group: 'Identity' },
    ],
  },

  // ── 6. Education ─────────────────────────────────────────────────────
  {
    id:                 'education',
    label:              'Education',
    icon:               '🎓',
    description:        'Schools, universities, training institutes, and e-learning platforms',
    color:              '#0891b2',
    bg:                 '#f0f9ff',
    contactLabel:       'Student',
    contactLabelPlural: 'Students',
    ticketLabel:        'Inquiry',
    departments:        ['Admissions', 'Student Services', 'Finance & Fees', 'Academic Affairs', 'Alumni'],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'student_id',        label: 'Student / Enrollment ID',  field_type: 'text',   is_required: true,  sort_order: 1, group: 'Academic Details', placeholder: 'e.g. STU-2024-0078' },
      { name: 'course_program',    label: 'Course / Program',         field_type: 'text',   is_required: true,  sort_order: 2, group: 'Academic Details', placeholder: 'e.g. B.Sc. Computer Science' },
      { name: 'faculty_department',label: 'Faculty / Department',     field_type: 'text',   is_required: false, sort_order: 3, group: 'Academic Details' },
      { name: 'academic_year',     label: 'Academic Year / Semester', field_type: 'text',   is_required: false, sort_order: 4, group: 'Academic Details', placeholder: 'e.g. Year 2 / Semester 3' },
      { name: 'enrollment_date',   label: 'Enrollment Date',          field_type: 'date',   is_required: false, sort_order: 5, group: 'Academic Details' },
      { name: 'expected_graduation',label: 'Expected Graduation Year',field_type: 'text',   is_required: false, sort_order: 6, group: 'Academic Details', placeholder: 'e.g. 2026' },
      { name: 'guardian_name',     label: "Parent / Guardian's Name", field_type: 'text',   is_required: false, sort_order: 7, group: 'Guardian Details' },
      { name: 'guardian_contact',  label: 'Guardian Contact Number',  field_type: 'phone',  is_required: false, sort_order: 8, group: 'Guardian Details' },
      { name: 'scholarship_status',label: 'Scholarship / Aid Status', field_type: 'select', is_required: false, sort_order: 9, group: 'Finance', options: ['None', 'Applied', 'Awarded', 'Partial', 'Full', 'Discontinued'] },
      { name: 'fee_status',        label: 'Fee Payment Status',       field_type: 'select', is_required: false, sort_order: 10, group: 'Finance', options: ['Paid', 'Partial', 'Pending', 'Overdue', 'Waived'] },
      { name: 'hostel_required',   label: 'Hostel / Accommodation',   field_type: 'boolean',is_required: false, sort_order: 11, group: 'Logistics' },
    ],
  },

  // ── 7. eCommerce ─────────────────────────────────────────────────────
  {
    id:                 'ecommerce',
    label:              'eCommerce',
    icon:               '🛒',
    description:        'Online retail, marketplaces, D2C brands, and digital stores',
    color:              '#ea580c',
    bg:                 '#fff7ed',
    contactLabel:       'Shopper',
    contactLabelPlural: 'Shoppers',
    ticketLabel:        'Issue',
    departments:        ['Customer Support', 'Returns & Refunds', 'Payments', 'Logistics', 'Seller Support'],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'order_id',          label: 'Order ID',                 field_type: 'text',   is_required: true,  sort_order: 1, group: 'Order Details', placeholder: 'e.g. ORD-2024-00567' },
      { name: 'platform',          label: 'Platform / Store',         field_type: 'text',   is_required: false, sort_order: 2, group: 'Order Details', placeholder: 'e.g. Amazon, Shopify, Website' },
      { name: 'product_category',  label: 'Product Category',         field_type: 'select', is_required: false, sort_order: 3, group: 'Order Details', options: ['Electronics', 'Fashion', 'Home & Garden', 'Food & Beverage', 'Health & Beauty', 'Books', 'Toys', 'Sports', 'Automotive', 'Other'] },
      { name: 'order_value',       label: 'Order Value',              field_type: 'number', is_required: false, sort_order: 4, group: 'Order Details' },
      { name: 'order_status',      label: 'Order Status',             field_type: 'select', is_required: false, sort_order: 5, group: 'Order Details', options: ['Placed', 'Confirmed', 'Processing', 'Shipped', 'Out for Delivery', 'Delivered', 'Cancelled', 'Failed'] },
      { name: 'return_refund_status', label: 'Return / Refund Status',field_type: 'select', is_required: false, sort_order: 6, group: 'After Sales', options: ['Not Requested', 'Requested', 'Approved', 'Picked Up', 'Refund Initiated', 'Refunded', 'Rejected'] },
      { name: 'delivery_address',  label: 'Delivery Address',         field_type: 'textarea',is_required: false, sort_order: 7, group: 'Delivery' },
      { name: 'payment_method',    label: 'Payment Method',           field_type: 'select', is_required: false, sort_order: 8, group: 'Payment', options: ['Credit Card', 'Debit Card', 'UPI / Wallet', 'Net Banking', 'COD', 'BNPL', 'Crypto', 'Other'] },
      { name: 'coupon_code',       label: 'Coupon / Promo Code',      field_type: 'text',   is_required: false, sort_order: 9, group: 'Order Details' },
      { name: 'seller_id',         label: 'Seller / Vendor ID',       field_type: 'text',   is_required: false, sort_order: 10, group: 'Marketplace', placeholder: 'If marketplace order' },
    ],
  },

  // ── 8. Others (Generic) ──────────────────────────────────────────────
  {
    id:                 'other',
    label:              'Other',
    icon:               '🏢',
    description:        'Any other business — fully customizable fields for your unique needs',
    color:              '#475569',
    bg:                 '#f8fafc',
    contactLabel:       'Contact',
    contactLabelPlural: 'Contacts',
    ticketLabel:        'Ticket',
    departments:        ['Customer Support', 'Sales', 'Operations'],
    fields: [
      CUSTOMER_TYPE_FIELD,
      { name: 'reference_number',  label: 'Reference / Case Number',  field_type: 'text',   is_required: false, sort_order: 1, group: 'Details' },
      { name: 'customer_segment',  label: 'Customer Segment',         field_type: 'select', is_required: false, sort_order: 2, group: 'Details', options: ['VIP', 'Premium', 'Standard', 'Trial', 'Partner'] },
      { name: 'region',            label: 'Region / Territory',       field_type: 'text',   is_required: false, sort_order: 3, group: 'Details' },
      { name: 'notes',             label: 'Additional Notes',         field_type: 'textarea',is_required: false, sort_order: 4, group: 'Details' },
    ],
  },
];

export const SECTOR_MAP: Record<string, SectorConfig> = Object.fromEntries(
  SECTORS.map(s => [s.id, s]),
);

export function getSector(id: string | null | undefined): SectorConfig {
  return SECTOR_MAP[id ?? ''] ?? SECTOR_MAP['other'];
}
