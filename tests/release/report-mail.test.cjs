'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const ExcelJS = require('exceljs');
const Mail = require('../../scripts/report-mail.cjs');
const Reports = require('../../server/report-center.cjs');

function sample() {
  return {
    smtp: { url: 'smtps://127.0.0.1:2465', from: 'wms@musonoi.test' },
    recipientAllowlist: ['reader@musonoi.test', 'supervisor@musonoi.test'],
    schedules: [{
      id: 'warehouse-reports', hour: 7, frequency: 'daily', actor: 'report-user',
      recipients: ['reader@musonoi.test'], reports: [{ kind: 'movement', product: 'CU_CATHODE' }]
    }]
  };
}

async function isolated(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'musonoi-report-mail-test-'));
  t.after(async () => {
    for (const name of await fs.readdir(dir)) await fs.unlink(path.join(dir, name));
    await fs.rmdir(dir);
  });
  return dir;
}

function fakePool(permissions, active = true) {
  const c = new EventEmitter();
  c.release = () => {};
  c.query = async sql => {
    if (sql.includes('FROM users')) {
      assert.match(sql, /active AND deleted_at IS NULL/);
      return { rows: active ? [{ id: 'actor-id', role_code: 'report-reader', language_code: 'zh-CN' }] : [] };
    }
    if (sql.includes('FROM role_permissions')) {
      return { rows: permissions.map(permission_code => ({ permission_code })) };
    }
    return { rows: [] };
  };
  return { connect: async () => c };
}

test('report mail is disabled without configuration and TEST refuses external delivery targets', async () => {
  assert.equal(await Mail.settings({ APP_ENV: 'production' }), null);
  const config = sample();
  assert.equal(Mail.validate(config, 'test').smtp.url, 'smtps://127.0.0.1:2465');
  config.smtp.url = 'smtps://smtp.company.example:2465';
  assert.throws(() => Mail.validate(config, 'test'), { code: 'REPORT_MAIL_TEST_DESTINATION_FORBIDDEN' });
  assert.equal(Mail.validate(config, 'production').schedules.length, 1);
  config.smtp.url = 'smtps://127.0.0.1:2465';
  config.recipientAllowlist.push('reader@company.example');
  assert.throws(() => Mail.validate(config, 'test'), { code: 'REPORT_MAIL_TEST_DESTINATION_FORBIDDEN' });
  config.recipientAllowlist.pop();
  config.schedules[0].recipients = ['unlisted@musonoi.test'];
  assert.throws(() => Mail.validate(config, 'test'), { code: 'REPORT_MAIL_SCHEDULE_INVALID' });
  config.schedules[0].recipients = ['reader@musonoi.test'];
  config.smtp.url = 'smtp://private:secret@127.0.0.1:587';
  assert.throws(() => Mail.validate(config, 'test'), { code: 'REPORT_MAIL_SMTP_INVALID' });
});

test('saved delivery plans override the legacy file without bypassing its recipient policy', () => {
  const legacy = { ...sample(), environment: 'test' };
  assert.deepEqual(Mail.selectedSchedules(legacy, { version: 0, enabled: false, schedules: [] }), legacy.schedules);
  const { schedules, ...relay } = legacy;
  assert.deepEqual(Mail.selectedSchedules(relay, { version: 0, enabled: false, schedules: [] }), []);
  assert.deepEqual(Mail.selectedSchedules(relay, { version: 1, enabled: true, schedules }), schedules);
  assert.deepEqual(Mail.selectedSchedules(legacy, { version: 2, enabled: false, schedules }), []);
  const unapproved = [{ ...schedules[0], recipients: ['outside@musonoi.test'] }];
  assert.throws(() => Mail.selectedSchedules(relay, { version: 2, enabled: true, schedules: unapproved }),
    { code: 'REPORT_MAIL_SCHEDULE_INVALID' });
});

test('report email administration persists plans, respects authorization and avoids writing addresses to audit', async t => {
  const app = require('fastify')();
  const settings = require('../../server/report-mail-settings.cjs');
  const { digest } = require('../../server/security.cjs');
  t.after(() => app.close());
  const path = settings.path;
  const decisions = [];
  const records = new Map();
  let policy = { version: 0, enabled: false, schedules: [], updatedAt: null };
  const c = {
    release() {},
    async query(sql, args = []) {
      if (sql.includes('FROM sessions s JOIN users u')) {
        return { rows: [{ id: 'operator-admin', role_code: 'admin', csrf_hash: digest('csrf') }] };
      }
      if (sql.startsWith('SELECT permission_code FROM role_permissions')) {
        return { rows: [{ permission_code: 'system:manage' }] };
      }
      if (sql.includes('ORDER BY u.username')) {
        return { rows: [{ username: 'report-user', displayName: 'Test Account' }] };
      }
      if (sql.includes('FROM report_mail_settings')) return { rows: [{ ...policy }] };
      if (sql.startsWith('UPDATE report_mail_settings')) {
        policy = { enabled: args[0], schedules: JSON.parse(args[1]), version: policy.version + 1, updatedAt: '2026-11-27T07:30:00Z' };
        const { schedules, ...response } = policy;
        return { rows: [response] };
      }
      if (sql.startsWith('INSERT INTO audit_logs')) { decisions.push(args); return { rows: [] }; }
      if (sql.includes('FROM idempotency_requests')) return { rows: records.has(args[2]) ? [records.get(args[2])] : [] };
      if (sql.startsWith('INSERT INTO idempotency_requests')) {
        records.set(args[2], { request_hash: args[3], response: args[4] });
      }
      return { rows: [] };
    }
  };
  const fail = statusCode => { throw Object.assign(Error('denied'), { statusCode }); };
  settings.register({
    app, cfg: { environment: 'test' }, pool: { connect: async () => c },
    permitted: permission => async req => {
      assert.equal(permission, 'system:manage');
      const role_code = req.headers['x-test-role'];
      if (!role_code) fail(401);
      req.user = { id: 'operator-admin', role_code };
      req.cookies = { musonoi_session: 'test-session' };
    },
    csrf: async req => { if (req.headers['x-csrf-token'] !== 'csrf') fail(403); }
  });
  const send = (method, { role = 'admin', csrf = 'csrf', key = 'request-0001', payload } = {}) => app.inject({
    method, url: path, headers: { 'x-test-role': role, 'x-csrf-token': csrf, 'idempotency-key': key }, payload
  });
  assert.equal((await send('GET', { role: '' })).statusCode, 401);
  assert.equal((await send('GET', { role: 'production_operator' })).statusCode, 403);
  const first = await send('GET');
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers['cache-control'], 'no-store');
  assert.deepEqual(first.json().schedules, []);
  assert.doesNotMatch(first.payload, /smtp|recipientAllowlist|netrc/i);
  const payload = { version: 0, enabled: true, schedules: sample().schedules };
  assert.equal((await send('PUT', { role: 'limited_role_manager', payload })).statusCode, 403);
  assert.equal((await send('PUT', { csrf: '', payload })).statusCode, 403);
  const malicious = { ...payload, schedules: [{ ...payload.schedules[0], recipients: ['x@example.com'] }] };
  assert.equal((await send('PUT', { payload: malicious })).statusCode, 400);
  const invalidActor = { ...payload, schedules: [{ ...payload.schedules[0], actor: 'out-of-scope' }] };
  assert.equal((await send('PUT', { payload: invalidActor })).statusCode, 400);
  const saved = await send('PUT', { payload });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().version, 1);
  assert.deepEqual(saved.json(), (await send('PUT', { payload })).json());
  const readBack = await send('GET');
  assert.deepEqual(readBack.json().schedules, payload.schedules);
  assert.equal((await send('PUT', { payload, key: 'request-0002' })).statusCode, 409);
  const disabled = await send('PUT', { payload: { version: 1, enabled: false, schedules: [] }, key: 'request-0003' });
  assert.equal(disabled.statusCode, 200);
  assert.equal(disabled.json().enabled, false);
  assert.equal(decisions.length, 2);
  assert.doesNotMatch(JSON.stringify(decisions), /@musonoi\.test|report-user/);
});
test('dispatched date ranges use completed Lubumbashi days and months', () => {
  const schedule = sample().schedules[0];
  assert.equal(Mail.duePeriod(schedule, new Date('2026-11-27T04:59:59Z')), null);
  assert.deepEqual(Mail.duePeriod(schedule, new Date('2026-11-27T05:00:00Z')),
    { key: '2026-11-26', from: '2026-11-26', to: '2026-11-26' });
  assert.equal(Mail.duePeriod(schedule, new Date('2026-11-27T20:59:59Z')).key, '2026-11-26');
  schedule.frequency = 'monthly';
  assert.deepEqual(Mail.duePeriod(schedule, new Date('2028-03-01T07:00:00Z')),
    { key: '2028-02', from: '2028-02-01', to: '2028-02-29' });
  assert.equal(Mail.duePeriod(schedule, new Date('2028-03-02T07:00:00Z')), null);
});

test('only a summary worksheet is attached while interactive exports keep both sheets', async () => {
  const req = { user: { language_code: 'en' }, productCode: 'CU_CATHODE' };
  const data = {
    kind: 'movement', product: 'CU_CATHODE', title: 'Inventory movements',
    from: '2026-11-26', to: '2026-11-26',
    summary: { columns: [{ label: 'Summary item', key: 'name' }], rows: [{ name: 'Test total' }] },
    detail: { columns: [{ label: 'Detail item', key: 'name' }], rows: [{ name: 'Private detail row' }] }
  };
  const summary = new ExcelJS.Workbook();
  await summary.xlsx.load(await Reports.workbook(data, req, { summaryOnly: true }));
  assert.deepEqual(summary.worksheets.map(sheet => sheet.name), ['Summary']);
  assert.equal(summary.getWorksheet('Summary').getCell('B7').value, 'Test total');
  const full = new ExcelJS.Workbook();
  await full.xlsx.load(await Reports.workbook(data, req));
  assert.deepEqual(full.worksheets.map(sheet => sheet.name), ['Summary', 'Detail']);
});

test('report jobs enforce permissions and send once per recipient with durable private receipts', async t => {
  const stateDir = await isolated(t);
  const config = { ...sample(), stateDir, environment: 'test' };
  config.schedules[0].recipients = [...config.recipientAllowlist];
  const [schedule] = config.schedules;
  const now = new Date('2026-11-27T05:00:00Z');
  const period = Mail.duePeriod(schedule, now);
  const due = [{ schedule, period }];
  const rendered = [];
  const sent = [];
  const records = [];
  const overrides = {
    render: async (_c, user, selection, included) => {
      rendered.push([user.id, selection.kind, selection.product, included.from]);
      return { name: 'movement-CU_CATHODE-2026-11-26.xlsx', data: Buffer.from('synthetic test attachment') };
    },
    transport: async (_config, recipient, payload) => sent.push([recipient, payload.toString('ascii')]),
    report: record => records.push(record)
  };
  assert.equal(await Mail.dueJobs(config, due, fakePool(['report:read']), now, overrides), 1);
  assert.equal(records[0].code, 'REPORT_MAIL_ACTOR_FORBIDDEN');
  assert.equal(await Mail.dueJobs(config, due, fakePool(['report:read', 'inventory:export'], false), now, overrides), 1);
  assert.equal(records[1].code, 'REPORT_MAIL_ACTOR_UNAVAILABLE');
  assert.equal(sent.length, 0);
  const pool = fakePool(['report:read', 'inventory:export']);
  assert.equal(await Mail.dueJobs(config, due, pool, now, overrides), 0);
  assert.equal(await Mail.dueJobs(config, due, pool, now, overrides), 0);
  assert.equal(rendered.length, 1);
  assert.deepEqual(rendered[0], ['actor-id', 'movement', 'CU_CATHODE', '2026-11-26']);
  assert.deepEqual(sent.map(([address]) => address), config.recipientAllowlist);
  assert.match(sent[0][1], /To: reader@musonoi\.test\r\n/);
  assert.doesNotMatch(sent[0][1], /supervisor@musonoi\.test/);
  const subject = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(sent[0][1])[1];
  assert.equal(Buffer.from(subject, 'base64').toString('utf8'), '穆松尼 WMS 报表 2026-11-26');
  const receipts = await fs.readdir(stateDir);
  assert.equal(receipts.length, 2);
  for (const name of receipts) {
    const value = await fs.readFile(path.join(stateDir, name), 'utf8');
    assert.doesNotMatch(value, /@musonoi\.test|synthetic test attachment/);
    assert.deepEqual(value.trim().split('\n').map(line => JSON.parse(line).status), ['STARTED', 'ACCEPTED']);
  }
  assert.equal(records.filter(row => row.status === 'ALREADY_ACCEPTED').length, 2);
});

test('an ambiguous or concurrently claimed delivery is never automatically retried', async t => {
  const config = { ...sample(), stateDir: await isolated(t), environment: 'test' };
  const [schedule] = config.schedules;
  const [recipient] = schedule.recipients;
  const period = Mail.duePeriod(schedule, new Date('2026-11-27T05:00:00Z'));
  const { promise: ready, resolve: claimWasWritten } = Promise.withResolvers();
  const { promise: failTransfer, reject: abortTransfer } = Promise.withResolvers();
  const first = Mail.deliverOnce(config, schedule, period, recipient, async () => {
    claimWasWritten();
    return failTransfer;
  });
  await ready;
  await assert.rejects(Mail.deliverOnce(config, schedule, period, recipient, () => assert.fail('duplicate delivery')),
    { code: 'REPORT_MAIL_DELIVERY_REVIEW_REQUIRED' });
  const failed = assert.rejects(first, /synthetic transport disconnect/);
  abortTransfer(Error('synthetic transport disconnect'));
  await failed;
  await assert.rejects(Mail.deliverOnce(config, schedule, period, recipient, () => assert.fail('duplicate delivery')),
    { code: 'REPORT_MAIL_DELIVERY_REVIEW_REQUIRED' });
});
