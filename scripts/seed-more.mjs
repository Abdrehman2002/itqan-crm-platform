/**
 * Additive top-up seeder — appends MORE data each time it runs (not idempotent).
 * Adds extra agent users (across departments), companies, contacts, deals,
 * tickets, invoices. Useful for stress-testing list/pagination/dashboards.
 *
 * Usage:  node scripts/seed-more.mjs            (DB on :5433)
 *         node scripts/seed-more.mjs 2          (run 2x the default batch)
 */
import pkg from 'pg';
const { Client } = pkg;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres@localhost:5433/crm_platform';
const MULT = Math.max(1, parseInt(process.argv[2] || '1', 10));
// bcrypt hash of Demo1234! (same as admin) so agent logins work too
const PW_HASH = '$2a$12$gCMcRKhxGcMOrRUZmg5BAuEdc2nMqRjxqffLaSXWrE1iLpkF8emCu';

const rand = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rand(a.length)];
const chance = (p) => Math.random() < p;
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
const daysAhead = (d) => new Date(Date.now() + d * 864e5).toISOString();

const FIRST = ['Alice','Bob','Carol','David','Eva','Frank','Grace','Hassan','Ivy','Jack','Khalid','Lena','Mona','Nadia','Omar','Priya','Quinn','Rana','Sara','Tariq','Usman','Vera','Wendy','Xavier','Yara','Zane','Bilal','Hina','Faisal','Ayesha','Imran','Sana','Bilqis','Noman','Rabia'];
const LAST = ['Johnson','Smith','White','Khan','Ali','Ahmed','Brown','Davis','Malik','Sheikh','Patel','Garcia','Lee','Hussain','Iqbal','Raza','Chaudhry','Butt','Qureshi','Farooq'];
const INDUSTRIES = ['Technology','Finance','Healthcare','Retail','Manufacturing','Education','Logistics','Telecom','Energy','Real Estate'];
const SIZES = ['1-10','11-50','51-200','201-500','501-1000'];
const CITIES = ['Karachi','Lahore','Islamabad','Dubai','Riyadh','London','New York','Singapore'];
const WORDS = ['Acme','Globex','Initech','Umbrella','Stark','Wayne','Hooli','Vehement','Massive','Soylent','Cyberdyne','Tyrell','Wonka','Gekko','Pied Piper','Nakatomi','Oscorp','Aperture','Vandelay','Prestige','Sterling','Apex','Zenith','Pioneer','Summit'];
const SUFFIX = ['Corp','Inc','Ltd','LLC','Group','Partners','Industries','Solutions','Systems','Holdings'];
const DEPTS = ['sales','support','complaints'];

async function main() {
  const c = new Client({ connectionString: DATABASE_URL });
  await c.connect();
  await c.query("SELECT set_config('app.bypass_rls','on',false)");

  const TID = (await c.query("SELECT id FROM tenants WHERE slug='demo'")).rows[0].id;
  const ownerUser = (await c.query('SELECT id FROM users WHERE tenant_id=$1 ORDER BY created_at LIMIT 1',[TID])).rows[0].id;
  const pipe = (await c.query('SELECT id, stages FROM pipelines WHERE tenant_id=$1 LIMIT 1',[TID])).rows[0];
  const PIPE = pipe.id;
  const STAGES = pipe.stages.map(s => s.id);

  console.log(`Top-up x${MULT} for tenant ${TID}`);

  // ── Extra agent users across departments ──────────────────────
  const userIds = [ownerUser];
  for (let i=0;i<4*MULT;i++) {
    const fn = pick(FIRST), ln = pick(LAST);
    const email = `agent${Date.now()}${i}@demo.com`;
    const r = await c.query(
      `INSERT INTO users (tenant_id,email,name,password_hash,role,department,is_active)
       VALUES ($1,$2,$3,$4,'agent',$5,true) RETURNING id`,
      [TID, email, `${fn} ${ln}`, PW_HASH, pick(DEPTS)]);
    userIds.push(r.rows[0].id);
  }

  // ── Companies ─────────────────────────────────────────────────
  const companyIds = (await c.query('SELECT id FROM companies WHERE tenant_id=$1',[TID])).rows.map(r=>r.id);
  for (let i=0;i<15*MULT;i++) {
    const name = `${pick(WORDS)} ${pick(SUFFIX)}`;
    const r = await c.query(
      `INSERT INTO companies (tenant_id,name,industry,size,country,city,website,phone,annual_revenue,owner_id)
       VALUES ($1,$2,$3,$4,'Pakistan',$5,$6,$7,$8,$9) RETURNING id`,
      [TID,name,pick(INDUSTRIES),pick(SIZES),pick(CITIES),
       `https://${name.toLowerCase().replace(/[^a-z]/g,'')}.com`,
       `+9230${rand(9)}${1000000+rand(8999999)}`, (rand(50)+1)*100000, pick(userIds)]);
    companyIds.push(r.rows[0].id);
  }

  // ── Contacts ──────────────────────────────────────────────────
  const STATUSES = ['lead','prospect','customer','churned'];
  const SOURCES = ['website','referral','cold_call','event','social','manual'];
  const contactIds = (await c.query('SELECT id FROM contacts WHERE tenant_id=$1',[TID])).rows.map(r=>r.id);
  for (let i=0;i<50*MULT;i++) {
    const fn = pick(FIRST), ln = pick(LAST);
    const r = await c.query(
      `INSERT INTO contacts (tenant_id,first_name,last_name,email,phone,company_id,job_title,status,source,owner_id,score,last_contacted_at,tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [TID,fn,ln,`${fn.toLowerCase()}.${ln.toLowerCase()}${Date.now()}${i}@example.com`,
       `+9230${rand(9)}${1000000+rand(8999999)}`, pick(companyIds),
       pick(['CEO','CTO','VP Sales','Manager','Director','Engineer','Analyst','Coordinator','Head of Ops']),
       pick(STATUSES), pick(SOURCES), pick(userIds), rand(101), daysAgo(rand(120)),
       chance(0.4) ? [pick(['vip','newsletter','hot-lead','partner'])] : []]);
    contactIds.push(r.rows[0].id);
  }

  // ── Deals ─────────────────────────────────────────────────────
  const DEAL_STATUS = ['open','open','open','won','lost'];
  for (let i=0;i<30*MULT;i++) {
    const status = pick(DEAL_STATUS);
    const stage = status==='won' ? STAGES[STAGES.length-1] : pick(STAGES);
    await c.query(
      `INSERT INTO deals (tenant_id,name,contact_id,company_id,pipeline_id,stage_id,owner_id,amount,currency,close_date,status,priority,source,won_at,lost_at,lost_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'USD',$9,$10,$11,$12,$13,$14,$15)`,
      [TID, `${pick(['Enterprise','Annual','Pilot','Renewal','Expansion','New Logo','Upsell'])} Deal ${Date.now()%100000}-${i}`,
       pick(contactIds), pick(companyIds), PIPE, stage, pick(userIds),
       (rand(300)+5)*1000, status==='won'?daysAgo(rand(30)):daysAhead(rand(90)),
       status, pick(['low','medium','high']), pick(SOURCES),
       status==='won'?daysAgo(rand(30)):null, status==='lost'?daysAgo(rand(30)):null,
       status==='lost'?pick(['budget','competitor','no decision','timing']):null]);
  }

  // ── Activities ────────────────────────────────────────────────
  const ATYPES = ['call','email','meeting','task','note'];
  for (let i=0;i<40*MULT;i++) {
    const type = pick(ATYPES), done = chance(0.5);
    await c.query(
      `INSERT INTO activities (tenant_id,type,subject,body,status,priority,contact_id,company_id,owner_id,scheduled_at,due_at,completed_at,duration)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [TID,type,`${type[0].toUpperCase()+type.slice(1)} with ${pick(FIRST)}`,
       'Follow-up regarding requirements and next steps.',
       done?'completed':'pending', pick(['low','normal','high']),
       pick(contactIds), pick(companyIds), pick(userIds),
       daysAgo(rand(30)), daysAhead(rand(21)), done?daysAgo(rand(15)):null,
       type==='call'||type==='meeting'?rand(60)+5:null]);
  }

  // ── Tickets (+ comments) ──────────────────────────────────────
  const queues = (await c.query('SELECT id FROM ticket_queues WHERE tenant_id=$1',[TID])).rows;
  const slas = (await c.query('SELECT id,priority FROM sla_policies WHERE tenant_id=$1',[TID])).rows;
  const TSTATUS = ['open','assigned','accepted','in_progress','pending','resolved','closed'];
  const TPRIO = ['low','medium','high','urgent'];
  const TTYPE = ['complaint','inquiry','sales'];
  const CHANNELS = ['manual','email','voice_bot','api'];
  let counter = (await c.query('SELECT COALESCE(next_val,1) v FROM ticket_counters WHERE tenant_id=$1',[TID])).rows[0]?.v
    ?? ((await c.query('SELECT COUNT(*)::int n FROM tickets WHERE tenant_id=$1',[TID])).rows[0].n + 1);
  counter = Number(counter);
  for (let i=0;i<35*MULT;i++) {
    const num = `TKT-${String(counter++).padStart(5,'0')}`;
    const status = pick(TSTATUS), prio = pick(TPRIO);
    const sla = slas.find(s=>s.priority===prio) || (slas.length?pick(slas):null);
    const accepted = ['accepted','in_progress','pending','resolved','closed'].includes(status);
    const r = await c.query(
      `INSERT INTO tickets (tenant_id,ticket_number,subject,description,status,priority,channel,ticket_type,queue_id,sla_policy_id,contact_id,company_id,assignee_id,reporter_name,reporter_email,created_at,accepted_at,resolved_at,closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [TID,num,
       `${pick(['Login issue','Billing question','Feature request','Outage report','Refund request','Integration help','Performance problem','Account access','Data export','API error'])} #${num}`,
       'Customer reports an issue needing support attention.',
       status, prio, pick(CHANNELS), pick(TTYPE),
       queues.length?pick(queues).id:null, sla?sla.id:null, pick(contactIds), pick(companyIds),
       chance(0.85)?pick(userIds):null, pick(FIRST)+' '+pick(LAST),
       `reporter${Date.now()%100000}${i}@example.com`, daysAgo(rand(40)),
       accepted?daysAgo(rand(30)):null,
       ['resolved','closed'].includes(status)?daysAgo(rand(15)):null,
       status==='closed'?daysAgo(rand(7)):null]);
    const tk = r.rows[0].id;
    for (let j=0;j<rand(4);j++) {
      await c.query(
        `INSERT INTO ticket_comments (tenant_id,ticket_id,author_id,body,is_internal,comment_type)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [TID,tk,pick(userIds), pick(['Looking into this.','Escalated to engineering.','Awaiting customer response.','Resolved and confirmed.','Need more details please.']),
         chance(0.4), chance(0.4)?'note':'reply']);
    }
  }
  await c.query(
    `INSERT INTO ticket_counters (tenant_id,next_val) VALUES ($1,$2)
     ON CONFLICT (tenant_id) DO UPDATE SET next_val=$2`, [TID, counter]);

  // ── Invoices ──────────────────────────────────────────────────
  const bcs = (await c.query('SELECT id FROM billing_contacts WHERE tenant_id=$1',[TID])).rows.map(r=>r.id);
  const INV_STATUS = ['draft','sent','viewed','partial','paid','overdue'];
  const invStart = (await c.query('SELECT COUNT(*)::int n FROM invoices WHERE tenant_id=$1',[TID])).rows[0].n;
  for (let i=0;i<15*MULT && bcs.length;i++) {
    const status = pick(INV_STATUS);
    const subtotal = (rand(80)+5)*100, taxRate = pick([0,5,17]);
    const tax = +(subtotal*taxRate/100).toFixed(2), total = +(subtotal+tax).toFixed(2);
    const paid = status==='paid'?total: status==='partial'? +(total/2).toFixed(2):0;
    const inv = await c.query(
      `INSERT INTO invoices (tenant_id,number,status,billing_contact_id,issue_date,due_date,currency,subtotal,total_tax,total,amount_paid,amount_due,notes)
       VALUES ($1,$2,$3,$4,$5,$6,'USD',$7,$8,$9,$10,$11,'Thank you for your business.') RETURNING id`,
      [TID, `INV-${String(invStart+i+1).padStart(4,'0')}-${rand(999)}`, status, pick(bcs),
       daysAgo(rand(90)).slice(0,10), daysAhead(rand(30)).slice(0,10),
       subtotal, tax, total, paid, +(total-paid).toFixed(2)]);
    const invId = inv.rows[0].id;
    for (let li=0; li<1+rand(3); li++) {
      const qty=rand(5)+1, price=(rand(20)+1)*50, lt=+(qty*price*taxRate/100).toFixed(2);
      await c.query(
        `INSERT INTO invoice_line_items (invoice_id,description,quantity,unit_price,tax_rate,tax_amount,total,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [invId, pick(['Consulting','License','Support plan','Implementation','Training','Hosting']), qty, price, taxRate, lt, +(qty*price+lt).toFixed(2), li]);
    }
  }

  console.log('\nDone. New totals:');
  for (const t of ['users','companies','contacts','deals','activities','tickets','ticket_comments','invoices','invoice_line_items']) {
    const r = await c.query(`SELECT COUNT(*)::int n FROM ${t} WHERE ${t==='invoice_line_items'?'true':'tenant_id=$1'}`, t==='invoice_line_items'?[]:[TID]);
    console.log('  '+t.padEnd(18), r.rows[0].n);
  }
  await c.end();
}
main().catch(e => { console.error('SEED FAILED:', e.message); process.exit(1); });
