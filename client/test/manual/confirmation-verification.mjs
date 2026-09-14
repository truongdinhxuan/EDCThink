// Phase 4.1 LOCAL ONLY. Real Fastify routes + local Supabase; disposable fixtures.
// Run with --serve for production-page browser checks, otherwise runs API checks.
// Add --ui-only with --serve to leave PENDING fixtures untouched for UI tests.
// Serve mode creates 64 rows per representative list for non-zero scroll on page 2.
// POST /__verify/cleanup for graceful cleanup in --serve mode (Windows process
// termination may skip SIGINT handlers). Never use a remote database.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHmac } from 'node:crypto';
import {
  backendApiUrl,
  backendListenOptions,
  configureDisposableLocalSupabase,
  frontendOrigin,
  requireServer,
  serverDirectory,
} from './project-test-environment.mjs';

const local = JSON.parse(execFileSync('cmd.exe', ['/d', '/s', '/c', 'npx.cmd supabase status -o json'], {
  cwd: serverDirectory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
}));
configureDisposableLocalSupabase(local);
assert.ok(process.env.APP_JWT_SECRET, 'APP_JWT_SECRET must be configured in server/.env');
const Fastify = requireServer('fastify');
const app = requireServer('./dist/app.js').default;
const { hashPassword } = requireServer('./dist/utils/password.js');
const authorizationRepair = process.argv.includes('--authorization-repair');
const primaryCrud = process.argv.includes('--phase5');
const resumePrefix = process.argv.find(value => value.startsWith('--resume-prefix='))?.split('=')[1];
if (resumePrefix) assert.ok(primaryCrud && /^P5_\d+$/.test(resumePrefix), 'Resume only an exact Phase 5 fixture prefix');
const prefix = resumePrefix ?? `${primaryCrud ? 'P5' : authorizationRepair ? 'P401' : 'P4VERIFY'}_${Date.now()}`;
const q = (value) => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const sql = (command) => execFileSync('docker', [
  'exec', '-i', 'supabase_db_server', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres',
], { input: command, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000 }).trim();
const rows = (query) => JSON.parse(sql(`select coalesce(json_agg(x),'[]') from (${query}) x;`));
const ids = Object.fromEntries(['actorRole', 'readerRole', 'actor', 'reader', 'category', 'unit', 'provider',
  'supply', 'location', 'balance', 'sheet', 'pendingExtra', 'pending', 'reject', 'apiCancel', 'apiReject', 'area', 'wrongAreaOrder'].map((key) => [key, randomUUID()]));
const password = 'Phase41Local1!';
const vinfast = authorizationRepair ? 940100001 : 941000001;
let setup = false;
let closing = false;
const server = Fastify({ logger: false });
const hits = [];
let control = { method: '', path: '', delay: 0, error: '' };
const results = [];
const record = async (name, check) => {
  try { await check(); results.push({ name, status: 'PASS' }); }
  catch (error) { results.push({ name, status: 'FAIL', error: error.message }); }
};
const sign = (id) => {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const content = `${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,exp:Math.floor(Date.now()/1000)+7200})}`;
  return `${content}.${createHmac('sha256', process.env.APP_JWT_SECRET).update(content).digest('base64url')}`;
};
const request = (method, url, payload, actor = ids.actor) => server.inject({
  method, url, payload, headers: { authorization: `Bearer ${sign(actor)}` },
});
const orderState = (id) => ({
  order: rows(`select o.id,s.code as status,o.cancel_reason,o.rejected_reason,o.shift_order_sheet_id from public.orders o join public.order_statuses s on s.id=o.status_id where o.id=${q(id)}`)[0],
  stock: rows(`select * from public.stock_balances where id=${q(ids.balance)}`),
  transactions: rows(`select id from public.stock_transactions where order_id=${q(id)}`),
  allocations: rows(`select a.* from public.order_item_allocations a join public.order_items i on i.id=a.order_item_id where i.order_id=${q(id)}`),
  notifications: rows(`select id,type,entity_id from public.notifications where entity_id=${q(id)}`),
});
const baseline = {};
const cleanup = async () => {
  if (closing) return;
  closing = true;
  try {
    if (!setup) return;
    sql(`begin; set local session_replication_role=replica;
    ${primaryCrud ? `
    delete from public.user_work_shift_assignments where user_id in (select id from public.users where email like ${q(`${prefix.toLowerCase()}%@example.test`)});
    delete from public.user_credentials where user_id in (select id from public.users where email like ${q(`${prefix.toLowerCase()}%@example.test`)});
    delete from public.user_roles where user_id in (select id from public.users where email like ${q(`${prefix.toLowerCase()}%@example.test`)});
    delete from public.users where email like ${q(`${prefix.toLowerCase()}%@example.test`)};
    delete from public.supply_providers where supply_id in (select id from public.supplies where code like ${q(`${prefix}%`)});
    delete from public.supplies where code like ${q(`${prefix}%`)} and id <> ${q(ids.supply)};
    delete from milkrun.trip_types where code like ${q(`${prefix}%`)};
    delete from milkrun.trip_statuses where code like ${q(`${prefix}%`)};
    delete from milkrun.racks where code like ${q(`${prefix}%`)};
    ` : ''}
    delete from public.notification_recipients where notification_id in (select id from public.notifications where created_by in (${q(ids.actor)},${q(ids.reader)}));
    delete from public.notifications where created_by in (${q(ids.actor)},${q(ids.reader)});
    delete from public.order_revisions where order_id in (select id from public.orders where requested_by=${q(ids.actor)});
    delete from public.order_items where order_id in (select id from public.orders where requested_by=${q(ids.actor)});
    delete from public.orders where requested_by=${q(ids.actor)};
    delete from public.supply_shift_order_sheets where id=${q(ids.sheet)} or leader_id in (${q(ids.actor)},${q(ids.reader)});
    delete from public.stock_balances where id=${q(ids.balance)};
    delete from public.supply_providers where supply_id=${q(ids.supply)};
    delete from public.supplies where id=${q(ids.supply)};
    delete from public.storage_locations where id=${q(ids.location)};
    delete from public.supply_categories where id=${q(ids.category)};
    delete from public.units where id=${q(ids.unit)};
    delete from public.providers where code like ${q(`${prefix}%`)};
    delete from milkrun.shops where code like ${q(`${prefix}%`)};
    delete from public.user_credentials where user_id in (${q(ids.actor)},${q(ids.reader)});
    delete from public.user_work_shift_assignments where user_id in (${q(ids.actor)},${q(ids.reader)});
    delete from public.user_roles where user_id in (${q(ids.actor)},${q(ids.reader)});
    delete from public.users where id in (${q(ids.actor)},${q(ids.reader)});
    delete from public.role_permissions where role_id in (select id from public.roles where code like ${q(`${prefix}%`)});
    delete from public.roles where code like ${q(`${prefix}%`)};
    ${authorizationRepair ? `delete from public.areas where id=${q(ids.area)};` : ''}
      commit;`);
    console.log(`CLEANUP PASS: dedicated ${primaryCrud ? 'Phase 5' : 'Phase 4.1'} fixtures removed.`);
  } finally {
    // SSE is intentionally long-lived. End test-only connections after fixture
    // cleanup so Fastify close cannot block the cleanup transaction forever.
    server.server.closeAllConnections?.();
    await server.close();
  }
};

try {
  if (!resumePrefix) assert.equal(rows(`select id from public.users where vinfast_id in (${vinfast},${vinfast+1})`).length, 0, 'Fixture VinFast ID already exists; do not overwrite');
  const source = rows("select id from public.areas where code='VTDG' and is_active and not is_deleted")[0];
  const area = authorizationRepair ? {id:ids.area} : rows("select id from public.areas where code='EDC_LOGISTICS' and is_active and not is_deleted")[0];
  const shift = rows("select id from public.work_shifts where code='S1' and is_active and not is_deleted")[0];
  assert.ok(source && area && shift, 'Required existing business lookups missing');
  const hashed = await hashPassword(password);
  const status = Object.fromEntries(rows('select id,code from public.order_statuses').map(r=>[r.code,r.id]));
  if (resumePrefix) {
    for (const [key, table, suffix] of [
      ['actorRole','roles','ACTOR'], ['readerRole','roles','READER'],
      ['category','supply_categories','CATEGORY'], ['unit','units','UNIT'],
      ['provider','providers','PROVIDER'], ['supply','supplies','SUPPLY'],
      ['location','storage_locations','LOC'],
      ...['pendingExtra','pending','reject','apiCancel','apiReject'].map(key => [key,'orders',key.toUpperCase()]),
    ]) {
      const found = rows(`select id from public.${table} where code=${q(`${prefix}_${suffix}`)}`);
      assert.equal(found.length, 1, `Missing exact resume fixture ${key}`);
      ids[key] = found[0].id;
    }
    for (const [key, roleKey] of [['actor','actorRole'],['reader','readerRole']]) {
      const fixtureVinfastId = key === 'actor' ? vinfast : vinfast + 1;
      const found = rows(`select id from public.users where role_id=${q(ids[roleKey])} and vinfast_id=${fixtureVinfastId}`);
      assert.equal(found.length, 1); ids[key] = found[0].id;
    }
    ids.balance = rows(`select id from public.stock_balances where supply_id=${q(ids.supply)}`)[0].id;
    ids.sheet = rows(`select shift_order_sheet_id as id from public.orders where id=${q(ids.pending)}`)[0].id;
  } else {
  sql(`begin;
    ${authorizationRepair ? `insert into public.areas(id,code,name) values (${q(ids.area)},${q(`${prefix}_AREA`)},'Authorization test area');` : ''}
    insert into public.roles(id,code,name,is_system) values
      (${q(ids.actorRole)},${q(`${prefix}_ACTOR`)},${q(`${prefix} Actor`)},false),
      (${q(ids.readerRole)},${q(`${prefix}_READER`)},${q(`${prefix} Reader`)},false);
    insert into public.role_permissions(role_id,permission_id)
      select ${q(ids.actorRole)},id from public.permissions where is_active and not is_deleted;
    insert into public.role_permissions(role_id,permission_id)
      select ${q(ids.readerRole)},id from public.permissions where code in ('admin.role.read','admin.user.read','supply.catalog.read','milkrun.shop.read',${q(authorizationRepair ? 'supply.order.approve' : 'supply.order.create')});
    insert into public.users(id,vinfast_id,email,role_id,area_id,first_name,last_name,is_verified)
      values (${q(ids.actor)},${vinfast},'p4verify-actor@example.test',${q(ids.actorRole)},${q(area.id)},'P4VERIFY','Actor',true),
      (${q(ids.reader)},${vinfast+1},'p4verify-reader@example.test',${q(ids.readerRole)},${q(area.id)},'P4VERIFY','Reader',true);
    insert into public.user_credentials(user_id,password_hash) values (${q(ids.actor)},${q(hashed)}),(${q(ids.reader)},${q(hashed)});
    ${authorizationRepair ? `update public.users set managed_by_user_id=${q(ids.reader)} where id=${q(ids.actor)};
      insert into public.user_work_shift_assignments(user_id,work_shift_id,effective_from,assigned_by) values (${q(ids.actor)},${q(shift.id)},now()-interval '2 days',${q(ids.reader)});` : ''}
    insert into public.units(id,code,symbol,name) values (${q(ids.unit)},${q(`${prefix}_UNIT`)},'EA','Test unit');
    insert into public.supply_categories(id,code,name) values (${q(ids.category)},${q(`${prefix}_CATEGORY`)},'Test normal');
    insert into public.providers(id,code,name) values (${q(ids.provider)},${q(`${prefix}_PROVIDER`)},'Test Provider');
    insert into public.supplies(id,code,short_text,description,category_id,unit_id) values
      (${q(ids.supply)},${q(`${prefix}_SUPPLY`)},'Test Supply','Test Supply',${q(ids.category)},${q(ids.unit)});
    insert into public.supply_providers(supply_id,provider_id) values (${q(ids.supply)},${q(ids.provider)});
    insert into public.storage_locations(id,code,area_id,name) values (${q(ids.location)},${q(`${prefix}_LOC`)},${q(source.id)},'Test Location');
    insert into public.stock_balances(id,supply_id,provider_id,area_id,storage_location_id,quantity) values
      (${q(ids.balance)},${q(ids.supply)},${q(ids.provider)},${q(source.id)},${q(ids.location)},100);
    insert into public.supply_shift_order_sheets(id,area_id,work_shift_id,work_date,leader_id) values
      (${q(ids.sheet)},${q(area.id)},${q(shift.id)},'2099-04-01',${q(ids.actor)});
    ${['pendingExtra','pending','reject','apiCancel','apiReject'].map(key=>`insert into public.orders(id,code,from_area_id,to_area_id,requested_by,status_id,shift_order_sheet_id,submitted_at) values
      (${q(ids[key])},${q(`${prefix}_${key.toUpperCase()}`)},${q(source.id)},${q(area.id)},${q(ids.actor)},${q(status.PENDING)},${q(ids.sheet)},now());
      insert into public.order_items(order_id,supply_id,provider_id,unit_id,quantity_requested) values (${q(ids[key])},${q(ids.supply)},${q(ids.provider)},${q(ids.unit)},2);`).join('\n')}
    ${['roles','providers','milkrun.shops'].map(table=>`insert into ${table.includes('.')?table:`public.${table}`}(code,name) select ${q(`${prefix}_ROW_`)}||lpad(n::text,2,'0'),${q(`${prefix} Row `)}||n from generate_series(1,${process.argv.includes('--serve') ? 64 : 24}) n;`).join('\n')}
    commit;`);
  }
  setup = true;
  for (const key of ['pendingExtra','pending','reject','apiCancel','apiReject']) baseline[key] = orderState(ids[key]);
  server.addHook('onRequest', async (req, reply) => {
    if (!['GET','OPTIONS'].includes(req.method) && !req.url.startsWith('/__verify')) hits.push({ method:req.method,path:req.url });
    if (req.method===control.method && req.url===control.path) {
      const current = control;
      if (current.delay) await new Promise(resolve=>setTimeout(resolve,current.delay));
      if (current.error) return reply.header('Access-Control-Allow-Origin', process.env.ORIGIN_URL)
        .code(409).send({ error:current.error });
    }
  });
  server.get('/__verify/state', async () => ({prefix,ids,hits,results,baseline,current:Object.fromEntries(['pendingExtra','pending','reject','apiCancel','apiReject'].map(k=>[k,orderState(ids[k])]))}));
  server.post('/__verify/control', async (req) => { control = req.body; return {ok:true}; });
  server.post('/__verify/cleanup', async () => {
    setTimeout(() => void cleanup().then(() => process.exit(0)), 100);
    return {ok:true};
  });
  await server.register(app);
  await server.ready();
  if (!process.argv.includes('--ui-only')) {
  if (authorizationRepair) {
    await record('P401 column grants and browser database isolation', async () => {
      const grants = rows(`select
        has_table_privilege('service_role','public.orders','UPDATE') as table_update,
        has_column_privilege('service_role','public.orders','status_id','UPDATE') as status_update,
        has_column_privilege('service_role','public.orders','cancel_reason','UPDATE') as reason_update,
        has_column_privilege('service_role','public.orders','note','UPDATE') as note_update`)[0];
      assert.deepEqual(grants,{table_update:false,status_update:true,reason_update:true,note_update:false});
      for (const role of ['anon','authenticated']) {
        const checks=rows(`select has_table_privilege(${q(role)},'public.orders','SELECT') as orders_read,
          has_any_column_privilege(${q(role)},'public.orders','UPDATE') as orders_write,
          has_table_privilege(${q(role)},'public.roles','INSERT') as roles_create`)[0];
        assert.deepEqual(checks,{orders_read:false,orders_write:false,roles_create:false});
      }
      // Real PostgREST anonymous requests, never use an application JWT as a DB JWT.
      const rest = `${local.API_URL}/rest/v1`;
      const headers={apikey:local.ANON_KEY,Authorization:`Bearer ${local.ANON_KEY}`,'Content-Type':'application/json'};
      for (const [path,method,body] of [
        ['/orders?select=id','GET'],
        [`/orders?id=eq.${ids.pendingExtra}`,'PATCH',{cancel_reason:'Forbidden'}],
        ['/roles','POST',{code:`${prefix}_DIRECT_DENIED`,name:'Forbidden'}],
      ]) {
        const response=await fetch(`${rest}${path}`,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
        assert.ok([401,403].includes(response.status),`${method} ${path}: ${response.status}`);
      }
      assert.equal(rows(`select id from public.roles where code=${q(`${prefix}_DIRECT_DENIED`)}`).length,0);
    });
    await record('P401 Cancel permission and cross-area scope rejection', async () => {
      const before=orderState(ids.pending);
      assert.equal((await request('POST',`/orders/${ids.pending}/cancel`,{cancel_reason:'Denied'},ids.reader)).statusCode,403);
      assert.deepEqual(orderState(ids.pending),before);
      // Same owner, different receiving Area: isolates area validation from ownership.
      sql(`insert into public.orders(id,code,from_area_id,to_area_id,requested_by,status_id)
        values (${q(ids.wrongAreaOrder)},${q(`${prefix}_WRONG_AREA`)},${q(source.id)},${q(source.id)},${q(ids.actor)},${q(status.PENDING)});`);
      const wrongBefore=orderState(ids.wrongAreaOrder);
      assert.equal((await request('POST',`/orders/${ids.wrongAreaOrder}/cancel`,{cancel_reason:'Wrong area'})).statusCode,403);
      assert.deepEqual(orderState(ids.wrongAreaOrder),wrongBefore);
    });
    await record('P401 Create PENDING atomically -> Cancel preserves Sheet and stock', async () => {
      const stockBefore=rows(`select * from public.stock_balances where id=${q(ids.balance)}`);
      const created=await request('POST','/orders',{
        from_area_id:source.id,to_area_id:area.id,note:`${prefix} create regression`,
        order_list:[{supply_id:ids.supply,provider_id:ids.provider,unit_id:ids.unit,quantity_requested:2,note:null}],
      });
      assert.equal(created.statusCode,201,created.body);
      const id=created.json().data.id;
      const pending=orderState(id);
      assert.equal(pending.order.status,'PENDING');
      assert.ok(pending.order.shift_order_sheet_id);
      assert.deepEqual(pending.stock,stockBefore);
      const cancelled=await request('POST',`/orders/${id}/cancel`,{cancel_reason:'  P401 cancelled  '});
      assert.equal(cancelled.statusCode,200,cancelled.body);
      const after=orderState(id);
      assert.equal(after.order.status,'CANCELLED');
      assert.equal(after.order.cancel_reason,'P401 cancelled');
      assert.equal(after.order.shift_order_sheet_id,pending.order.shift_order_sheet_id);
      assert.deepEqual(after.stock,stockBefore);
      assert.equal(after.transactions.length,0);
      assert.equal(after.notifications.filter(n=>n.type==='ORDER_CREATED').length,1);
      assert.equal(after.notifications.filter(n=>n.type==='ORDER_STATUS_CHANGED').length,1);
    });
    await record('P401 PENDING Cancel requires reason and preserves Sheet', async () => {
      const before=orderState(ids.pendingExtra);
      const missingReason=await request('POST',`/orders/${ids.pendingExtra}/cancel`,{});
      assert.equal(missingReason.statusCode,409,missingReason.body);
      assert.deepEqual(orderState(ids.pendingExtra),before);
      const response=await request('POST',`/orders/${ids.pendingExtra}/cancel`,{cancel_reason:'P401 extra cancelled'});
      assert.equal(response.statusCode,200,response.body);
      const after=orderState(ids.pendingExtra);
      assert.equal(after.order.status,'CANCELLED');
      assert.equal(after.order.shift_order_sheet_id,ids.sheet);
      assert.deepEqual(after.stock,before.stock);
      assert.equal(after.transactions.length,0);
    });
  }
  await record('Role create/update/soft-delete', async () => {
    const created = await request('POST','/roles',{code:`${prefix}_API`,name:`${prefix} API`});
    assert.equal(created.statusCode,201,created.body);
    const id = created.json().data.id;
    assert.deepEqual(rows(`select code,name,is_system from public.roles where id=${q(id)}`),
      [{code:`${prefix}_API`,name:`${prefix} API`,is_system:false}]);
    assert.equal((await request('PATCH',`/roles/${id}`,{name:`${prefix} Updated`})).statusCode,200);
    assert.equal(rows(`select name from public.roles where id=${q(id)}`)[0].name,`${prefix} Updated`);
    assert.equal((await request('DELETE',`/roles/${id}`)).statusCode,200);
    assert.deepEqual(rows(`select is_active,is_deleted from public.roles where id=${q(id)}`),[{is_active:false,is_deleted:true}]);
  });
  await record('Role in-use and system protection', async () => {
    assert.equal((await request('DELETE',`/roles/${ids.actorRole}`)).statusCode,409);
    const admin = rows("select id from public.roles where code='ADMIN' and is_system")[0];
    assert.equal((await request('DELETE',`/roles/${admin.id}`)).statusCode,409);
  });
  await record('Limited user mutations rejected', async () => {
    for (const [method,url,body] of [['POST','/roles',{code:`${prefix}_DENIED`,name:'Denied'}],['PATCH',`/providers/${ids.provider}/deactivate`],['POST','/milkrun/shops',{code:`${prefix}_DENIED`,name:'Denied'}]]) {
      assert.equal((await request(method,url,body,ids.reader)).statusCode,403,url);
    }
    assert.equal(rows(`select id from public.roles where code=${q(`${prefix}_DENIED`)}`).length,0);
  });
  for (const [key,action,field] of [['apiCancel','cancel','cancel_reason'],['apiReject','reject','rejected_reason']]) {
    await record(`${action}: blank reason has no side effect`, async () => {
      const response=await request('POST',`/orders/${ids[key]}/${action}`,{[field]:'  '});
      assert.ok(response.statusCode>=400,response.body);
      assert.deepEqual(orderState(ids[key]),baseline[key]);
    });
    await record(`${action}: persistence, sheet, stock and notification`, async () => {
      const response=await request('POST',`/orders/${ids[key]}/${action}`,{[field]:'  Phase41 reason  '});
      assert.equal(response.statusCode,200,response.body);
      const after=orderState(ids[key]);
      assert.equal(after.order.status,action==='cancel'?'CANCELLED':'REJECTED');
      assert.equal(after.order[field],'Phase41 reason');
      assert.equal(after.order.shift_order_sheet_id,ids.sheet);
      assert.deepEqual(after.stock,baseline[key].stock);
      assert.deepEqual(after.transactions,baseline[key].transactions);
      assert.deepEqual(after.allocations,baseline[key].allocations);
      assert.equal(after.notifications.length,1);
      assert.equal(after.notifications[0].type,'ORDER_STATUS_CHANGED');
      const recipients=rows(`select user_id from public.notification_recipients where notification_id=${q(after.notifications[0].id)}`);
      assert.ok(recipients.every(r=>r.user_id!==ids.actor));
      const repeated=await request('POST',`/orders/${ids[key]}/${action}`,{[field]:'Again'});
      assert.ok(repeated.statusCode>=400);
      assert.deepEqual(orderState(ids[key]),after);
    });
  }
  }
  console.log(JSON.stringify({prefix,results},null,2));
  if (process.argv.includes('--serve')) {
    await server.listen(backendListenOptions());
    console.log(`LOCAL UI READY: API ${backendApiUrl.origin}; browser origin ${frontendOrigin.origin}; VinFast ID ${vinfast}, password ${password}. Reader ${vinfast+1}. Fixture prefix ${prefix}.`);
    process.once('SIGINT',()=>void cleanup().then(()=>process.exit(0)));
    process.once('SIGTERM',()=>void cleanup().then(()=>process.exit(0)));
  } else {
    await cleanup();
    if(results.some(r=>r.status==='FAIL')) process.exitCode=1;
  }
} catch (error) {
  console.error(error.message);
  await cleanup();
  process.exitCode=1;
}
