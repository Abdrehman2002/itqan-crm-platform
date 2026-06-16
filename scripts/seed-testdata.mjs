/**
 * Rich test-data seeder for the `demo` tenant.
 * Adds queues, SLA policies, companies, contacts, deals, activities, tickets,
 * comments, voice-bot calls, emails, billing contacts, invoices, notifications.
 *
 * Idempotent: skips if the tenant already has plenty of deals.
 * Usage:  node scripts/seed-testdata.mjs   (DB must be running on :5433)
 */

import pkg from 'pg';
const { Client } = pkg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@localhost:5433/crm_platform';

const rand   = (n) => Math.floor(Math.random() * n);
const pick   = (a) => a[rand(a.length)];
const chance = (p) => Math.random() < p;
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
const daysAhead = (d) => new Date(Date.now() + d * 864e5).toISOString();

const FIRST = ['Alice','Bob','Carol','David','Eva','Frank','Grace','Hassan','Ivy','Jack','Khalid','Lena','Mona','Nadia','Omar','Priya','Quinn','Rana','Sara','Tariq','Usman','Vera','Wendy','Xavier','Yara','Zane','Bilal','Hina','Faisal','Ayesha'];
const LAST  = ['Johnson','Smith','White','Khan','Ali','Ahmed','Brown','Davis','Malik','Sheikh','Patel','Garcia','Lee','Hussain','Iqbal','Raza','Chaudhry','Butt','Qureshi','Farooq'];
const INDUSTRIES = ['Technology','Finance','Healthcare','Retail','Manufacturing','Education','Logistics','Telecom','Energy','Real Estate'];
const SIZES = ['1-10','11-50','51-200','201-500','501-1000'];
const CITIES = ['Karachi','Lahore','Islamabad','Dubai','Riyadh','London','New York','Singapore'];
const COMPANY_WORDS = ['Acme','Globex','Initech','Umbrella','Stark','Wayne','Hooli','Vehement','Massive','Soylent','Cyberdyne','Tyrell','Wonka','Gekko','Pied Piper','Nakatomi','Oscorp','Aperture','Black Mesa','Vandelay','Bluth','Prestige','Dunder','Sterling','Vance'];
const SUFFIX = ['Corp','Inc','Ltd','LLC','Group','Partners','Industries','Solutions'];

async function main() {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  await c.query("SELECT set_config('app.bypass_rls','on',false)");

  const tenant = (await c.query("SELECT id FROM tenants WHERE slug='demo'")).rows[0];
  if (!tenant) { console.error('No demo tenant. Run db:seed first.'); process.exit(1); }
  const TID = tenant.id;
  const USER = (await c.query('SELECT id FROM users WHERE tenant_id=$1 LIMIT 1',[TID])).rows[0].id;
  const pipe = (await c.query('SELECT id, stages FROM pipelines WHERE tenant_id=$1 LIMIT 1',[TID])).rows[0];
  const PIPE = pipe.id;
  const STAGES = pipe.stages.map(s => s.id);

  const dealCount = (await c.query('SELECT COUNT(*)::int n FROM deals WHERE tenant_id=$1',[TID])).rows[0].n;
  if (dealCount > 20) { console.log(`Already seeded (${dealCount} deals). Skipping.`); await c.end(); return; }

  console.log('Seeding rich test data for tenant', TID);

  // ── Ticket queues (idempotent) ────────────────────────────────
  const queueDefs = [
    ['General Support','Default support queue','#6366f1', true],
    ['Complaints Queue','Handles all complaint tickets','#dc2626', false],
    ['Support Queue','Handles support and inquiry tickets','#2563eb', false],
    ['Sales Queue','Handles sales tickets and leads','#16a34a', false],
  ];
  for (const [name,desc,color,isDef] of queueDefs) {
    await c.query(
      `INSERT INTO ticket_queues (tenant_id,name,description,color,is_default,routing_method)
       SELECT $1,$2,$3,$4,$5,'pull'
       WHERE NOT EXISTS (SELECT 1 FROM ticket_queues WHERE tenant_id=$1 AND name=$2)`,
      [TID,name,desc,color,isDef]);
  }
  const queues = (await c.query('SELECT id,name FROM ticket_queues WHERE tenant_id=$1',[TID])).rows;

  // ── SLA policies (idempotent) ─────────────────────────────────
  const slaDefs = [['Urgent','urgent',1,4],['High','high',2,8],['Medium','medium',4,24],['Low','low',8,72]];
  for (const [name,prio,fr,res] of slaDefs) {
    await c.query(
      `INSERT INTO sla_policies (tenant_id,name,priority,first_response_hours,resolution_hours,reminder_pct,l1_escalation_pct,l2_escalation_pct)
       SELECT $1,$2,$3,$4,$5,80,100,150
       WHERE NOT EXISTS (SELECT 1 FROM sla_policies WHERE tenant_id=$1 AND name=$2)`,
      [TID,name,prio,fr,res]);
  }
  const slas = (await c.query('SELECT id,priority FROM sla_policies WHERE tenant_id=$1',[TID])).rows;

  // ── Companies ─────────────────────────────────────────────────
  const companyIds = (await c.query('SELECT id FROM companies WHERE tenant_id=$1',[TID])).rows.map(r=>r.id);
  for (let i=0;i<25;i++) {
    const name = `${pick(COMPANY_WORDS)} ${pick(SUFFIX)}`;
    const r = await c.query(
      `INSERT INTO companies (tenant_id,name,industry,size,country,city,website,phone,annual_revenue,owner_id)
       VALUES ($1,$2,$3,$4,'Pakistan',$5,$6,$7,$8,$9) RETURNING id`,
      [TID,name,pick(INDUSTRIES),pick(SIZES),pick(CITIES),
       `https://${name.toLowerCase().replace(/[^a-z]/g,'')}.com`,
       `+9230${rand(9)}${1000000+rand(8999999)}`, (rand(50)+1)*100000, USER]);
    companyIds.push(r.rows[0].id);
  }

  // ── Contacts ──────────────────────────────────────────────────
  const STATUSES = ['lead','prospect','customer','churned'];
  const SOURCES = ['website','referral','cold_call','event','social','manual'];
  const contactIds = (await c.query('SELECT id FROM contacts WHERE tenant_id=$1',[TID])).rows.map(r=>r.id);
  for (let i=0;i<80;i++) {
    const fn = pick(FIRST), ln = pick(LAST);
    const r = await c.query(
      `INSERT INTO contacts (tenant_id,first_name,last_name,email,phone,mobile,company_id,job_title,status,source,owner_id,score,last_contacted_at,tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [TID,fn,ln,`${fn.toLowerCase()}.${ln.toLowerCase()}${i}@example.com`,
       `+9230${rand(9)}${1000000+rand(8999999)}`,`+9231${rand(9)}${1000000+rand(8999999)}`,
       pick(companyIds), pick(['CEO','CTO','VP Sales','Manager','Director','Engineer','Analyst','Coordinator']),
       pick(STATUSES), pick(SOURCES), USER, rand(101), daysAgo(rand(90)),
       chance(0.4) ? [pick(['vip','newsletter','hot-lead','partner'])] : []]);
    contactIds.push(r.rows[0].id);
  }

  // ── Deals ─────────────────────────────────────────────────────
  const DEAL_STATUS = ['open','open','open','won','lost'];
  for (let i=0;i<40;i++) {
    const status = pick(DEAL_STATUS);
    const stage = status==='won' ? STAGES[STAGES.length-1] : pick(STAGES);
    await c.query(
      `INSERT INTO deals (tenant_id,name,contact_id,company_id,pipeline_id,stage_id,owner_id,amount,currency,close_date,status,priority,source,won_at,lost_at,lost_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'USD',$9,$10,$11,$12,$13,$14,$15)`,
      [TID, `${pick(['Enterprise','Annual','Pilot','Renewal','Expansion','New Logo'])} Deal #${i+1}`,
       pick(contactIds), pick(companyIds), PIPE, stage, USER,
       (rand(200)+5)*1000, status==='won'?daysAgo(rand(30)):daysAhead(rand(60)),
       status, pick(['low','medium','high']), pick(SOURCES),
       status==='won'?daysAgo(rand(30)):null, status==='lost'?daysAgo(rand(30)):null,
       status==='lost'?pick(['budget','competitor','no decision','timing']):null]);
  }

  // ── Activities ────────────────────────────────────────────────
  const ATYPES = ['call','email','meeting','task','note'];
  for (let i=0;i<60;i++) {
    const type = pick(ATYPES);
    const done = chance(0.5);
    await c.query(
      `INSERT INTO activities (tenant_id,type,subject,body,status,priority,contact_id,company_id,owner_id,scheduled_at,due_at,completed_at,duration)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [TID,type,`${type[0].toUpperCase()+type.slice(1)} with ${pick(FIRST)}`,
       'Follow-up regarding their requirements and next steps.',
       done?'completed':'pending', pick(['low','normal','high']),
       pick(contactIds), pick(companyIds), USER,
       daysAgo(rand(20)), daysAhead(rand(14)), done?daysAgo(rand(10)):null,
       type==='call'||type==='meeting'?rand(60)+5:null]);
  }

  // ── Tickets (+ counter + comments) ────────────────────────────
  const TSTATUS = ['open','assigned','accepted','in_progress','pending','resolved','closed'];
  const TPRIO = ['low','medium','high','urgent'];
  const TTYPE = ['complaint','inquiry','sales'];
  const CHANNELS = ['manual','email','voice_bot','api'];
  let counter = 1;
  for (let i=0;i<50;i++) {
    const num = `TKT-${String(counter++).padStart(5,'0')}`;
    const status = pick(TSTATUS);
    const prio = pick(TPRIO);
    const sla = slas.find(s=>s.priority===prio) || pick(slas);
    const accepted = ['accepted','in_progress','pending','resolved','closed'].includes(status);
    const ct = pick(contactIds);
    const r = await c.query(
      `INSERT INTO tickets (tenant_id,ticket_number,subject,description,status,priority,channel,ticket_type,queue_id,sla_policy_id,contact_id,company_id,assignee_id,reporter_name,reporter_email,created_at,accepted_at,resolved_at,closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [TID,num,
       `${pick(['Login issue','Billing question','Feature request','Outage report','Refund request','Integration help','Performance problem','Account access'])} #${i+1}`,
       'Customer reports an issue that needs attention from the support team.',
       status, prio, pick(CHANNELS), pick(TTYPE),
       pick(queues).id, sla.id, ct, pick(companyIds),
       chance(0.8)?USER:null, pick(FIRST)+' '+pick(LAST),
       `reporter${i}@example.com`, daysAgo(rand(30)),
       accepted?daysAgo(rand(20)):null,
       ['resolved','closed'].includes(status)?daysAgo(rand(10)):null,
       status==='closed'?daysAgo(rand(5)):null]);
    // a couple of comments
    const tk = r.rows[0].id;
    const nComments = rand(4);
    for (let j=0;j<nComments;j++) {
      await c.query(
        `INSERT INTO ticket_comments (tenant_id,ticket_id,author_id,body,is_internal,comment_type)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [TID,tk,USER, pick(['Looking into this now.','Escalated to engineering.','Awaiting customer response.','Resolved and confirmed with customer.','Could you share more details?']),
         chance(0.4), chance(0.4)?'note':'reply']);
    }
  }
  await c.query(
    `INSERT INTO ticket_counters (tenant_id,next_val) VALUES ($1,$2)
     ON CONFLICT (tenant_id) DO UPDATE SET next_val=$2`, [TID, counter]);

  // ── Voice-bot calls ───────────────────────────────────────────
  for (let i=0;i<25;i++) {
    await c.query(
      `INSERT INTO voice_bot_calls (tenant_id,provider,provider_call_id,from_number,to_number,direction,duration_seconds,status,transcript,summary,sentiment,extracted_subject,extracted_priority,contact_id,created_at,started_at,ended_at)
       VALUES ($1,$2,$3,$4,$5,'inbound',$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15)`,
      [TID, pick(['vapi','retell','bland','twilio_ai']), 'call_'+Math.random().toString(36).slice(2,10),
       `+9230${rand(9)}${1000000+rand(8999999)}`, '+922135000000',
       rand(600)+30, pick(['completed','completed','no_answer','failed']),
       'Customer: I have a problem with my order. Agent: I can help with that...',
       'Customer called about an order issue; ticket created for follow-up.',
       pick(['positive','neutral','negative','urgent']),
       pick(['Order issue','Billing query','Technical support','Complaint']),
       pick(TPRIO), pick(contactIds), daysAgo(rand(25)), daysAgo(rand(25))]);
  }

  // ── Emails ────────────────────────────────────────────────────
  for (let i=0;i<30;i++) {
    const ct = pick(contactIds);
    await c.query(
      `INSERT INTO emails (tenant_id,from_email,from_name,to_email,subject,body_html,body_text,status,provider,contact_id,sent_by,sent_at,created_at)
       VALUES ($1,'noreply@demo.com','Demo CRM',$2,$3,$4,$5,$6,'smtp',$7,$8,$9,$9)`,
      [TID, `contact${i}@example.com`,
       pick(['Welcome to Demo CRM','Your invoice is ready','Following up on our call','Thanks for your interest','Re: Support ticket']),
       '<p>Hello, thank you for being a valued customer.</p>',
       'Hello, thank you for being a valued customer.',
       pick(['delivered','delivered','sent','opened','bounced']),
       ct, USER, daysAgo(rand(20))]);
  }

  // ── Billing contacts + invoices + line items ──────────────────
  const INV_STATUS = ['draft','sent','viewed','partial','paid','overdue'];
  for (let i=0;i<12;i++) {
    const fn = pick(FIRST), ln = pick(LAST);
    const bc = await c.query(
      `INSERT INTO billing_contacts (tenant_id,name,email,phone,company,currency,tax_id,billing_address)
       VALUES ($1,$2,$3,$4,$5,'USD',$6,$7) RETURNING id`,
      [TID, `${fn} ${ln}`, `billing${i}@example.com`, `+9230${rand(9)}${1000000+rand(8999999)}`,
       `${pick(COMPANY_WORDS)} ${pick(SUFFIX)}`, `NTN-${1000000+rand(8999999)}`,
       JSON.stringify({ city: pick(CITIES), country: 'Pakistan' })]);
    const bcId = bc.rows[0].id;
    // 1-3 invoices per billing contact
    const nInv = 1 + rand(3);
    for (let k=0;k<nInv;k++) {
      const status = pick(INV_STATUS);
      const subtotal = (rand(50)+5)*100;
      const taxRate = pick([0,5,17]);
      const tax = +(subtotal*taxRate/100).toFixed(2);
      const total = +(subtotal+tax).toFixed(2);
      const paid = status==='paid' ? total : status==='partial' ? +(total/2).toFixed(2) : 0;
      const inv = await c.query(
        `INSERT INTO invoices (tenant_id,number,status,billing_contact_id,issue_date,due_date,currency,subtotal,total_tax,total,amount_paid,amount_due,notes)
         VALUES ($1,$2,$3,$4,$5,$6,'USD',$7,$8,$9,$10,$11,$12) RETURNING id`,
        [TID, `INV-${String(i*10+k+1).padStart(4,'0')}`, status, bcId,
         daysAgo(rand(60)).slice(0,10), daysAhead(rand(30)).slice(0,10),
         subtotal, tax, total, paid, +(total-paid).toFixed(2),
         'Thank you for your business.']);
      const invId = inv.rows[0].id;
      const nLines = 1 + rand(3);
      for (let li=0; li<nLines; li++) {
        const qty = rand(5)+1, price = (rand(20)+1)*50;
        const lineTax = +(qty*price*taxRate/100).toFixed(2);
        await c.query(
          `INSERT INTO invoice_line_items (invoice_id,description,quantity,unit_price,tax_rate,tax_amount,total,sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [invId, pick(['Consulting','License','Support plan','Implementation','Training']),
           qty, price, taxRate, lineTax, +(qty*price+lineTax).toFixed(2), li]);
      }
    }
  }

  // ── Notifications ─────────────────────────────────────────────
  for (let i=0;i<20;i++) {
    await c.query(
      `INSERT INTO notifications (tenant_id,user_id,type,title,body,entity_type,is_read,created_at)
       VALUES ($1,$2,$3,$4,$5,'ticket',$6,$7)`,
      [TID, USER, pick(['ticket_assigned','sla_reminder','sla_breach','ticket_accepted']),
       pick(['New ticket assigned to you','SLA reminder: ticket due soon','SLA breached on a ticket','Ticket was accepted']),
       'Click to view details.', chance(0.5), daysAgo(rand(7))]);
  }

  // ── Summary ───────────────────────────────────────────────────
  console.log('\nDone. Row counts:');
  for (const t of ['companies','contacts','deals','activities','tickets','ticket_comments','ticket_queues','sla_policies','voice_bot_calls','emails','billing_contacts','invoices','invoice_line_items','notifications']) {
    const r = await c.query(`SELECT COUNT(*)::int n FROM ${t} WHERE ${t==='invoice_line_items'?'true':'tenant_id=$1'}`, t==='invoice_line_items'?[]:[TID]);
    console.log('  '+t.padEnd(20), r.rows[0].n);
  }
  await c.end();
}

main().catch(e => { console.error('SEED FAILED:', e.message); process.exit(1); });
