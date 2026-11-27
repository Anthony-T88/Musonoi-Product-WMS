'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');
const DB = require('../server/database-connection.cjs');
const Lease = require('../server/authorization-lease.cjs');
const Management = require('../server/management.cjs');
const ReportCenter = require('../server/report-center.cjs');
const { display } = require('../server/business-time.cjs');

const reportKinds = new Set(['shipping', 'movement', 'balance', 'stocktake', 'sales']);
const products = new Set(['CU_CATHODE', 'CO_HYDROXIDE']);
const maxAttachmentBytes = 10 * 1024 * 1024;
const crlf = '\r\n';
const writeStatus = record => console.log(JSON.stringify(record));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const addressKey = value => typeof value === 'string' ? value.toLowerCase() : value;

function hasKeys(object, expected) {
  return object && typeof object === 'object' && !Array.isArray(object) &&
    Object.keys(object).length === expected.length && expected.every(key => Object.hasOwn(object, key));
}

function uniqueArray(values, max, key = value => value) {
  return Array.isArray(values) && values.length > 0 && values.length <= max &&
    new Set(values.map(key)).size === values.length;
}

function mailbox(value) {
  if (typeof value !== 'string' || value.length > 254) return false;
  const parts = value.split('@');
  const [user, domain] = parts;
  return parts.length === 2 && user.length <= 64 && /^[a-zA-Z0-9_+-]+(?:\.[a-zA-Z0-9_+-]+)*$/.test(user) &&
    /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(domain);
}

function validate(value, environment) {
  if (!['test', 'production'].includes(environment)) DB.fail('REPORT_MAIL_INVALID_ENVIRONMENT');
  if (!hasKeys(value, ['smtp', 'recipientAllowlist', 'schedules']) ||
      !hasKeys(value.smtp, ['url', 'from']) || !mailbox(value.smtp.from) ||
      !uniqueArray(value.recipientAllowlist, 100, addressKey) || !value.recipientAllowlist.every(mailbox) ||
      !uniqueArray(value.schedules, 20, schedule => schedule?.id)) DB.fail('REPORT_MAIL_CONFIG_INVALID');
  if (typeof value.smtp.url !== 'string' || /[\s\u0000-\u001f\u007f]/.test(value.smtp.url)) DB.fail('REPORT_MAIL_SMTP_INVALID');
  let url;
  try { url = new URL(value.smtp.url); } catch { DB.fail('REPORT_MAIL_SMTP_INVALID'); }
  if (!['smtp:', 'smtps:'].includes(url.protocol) || !url.hostname || !url.port ||
      url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname) ||
      !/^[a-zA-Z0-9.-]+$/.test(url.hostname)) DB.fail('REPORT_MAIL_SMTP_INVALID');
  if (environment === 'test' && (url.hostname !== '127.0.0.1' ||
      ![value.smtp.from, ...value.recipientAllowlist].every(address => address.toLowerCase().endsWith('.test')))) {
    DB.fail('REPORT_MAIL_TEST_DESTINATION_FORBIDDEN');
  }
  const allowlist = new Set(value.recipientAllowlist);
  for (const schedule of value.schedules) {
    if (!hasKeys(schedule, ['id', 'hour', 'frequency', 'actor', 'recipients', 'reports']) ||
        typeof schedule.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(schedule.id) ||
        !Number.isInteger(schedule.hour) || schedule.hour < 0 || schedule.hour > 23 ||
        !['daily', 'monthly'].includes(schedule.frequency) ||
        typeof schedule.actor !== 'string' || !schedule.actor.trim() || schedule.actor.length > 160 ||
        schedule.actor.trim() !== schedule.actor || /[\u0000-\u001f\u007f]/.test(schedule.actor) ||
        !uniqueArray(schedule.recipients, 8, addressKey) || !schedule.recipients.every(address => allowlist.has(address)) ||
        !uniqueArray(schedule.reports, 6, report => `${report?.kind}:${report?.product}`)) {
      DB.fail('REPORT_MAIL_SCHEDULE_INVALID');
    }
    for (const report of schedule.reports) {
      if (!hasKeys(report, ['kind', 'product']) || !reportKinds.has(report.kind) || !products.has(report.product) ||
          (schedule.frequency === 'daily' && ['balance', 'sales'].includes(report.kind))) {
        DB.fail('REPORT_MAIL_REPORT_INVALID');
      }
    }
  }
  return { ...value, smtp: { from: value.smtp.from, url: `${url.protocol}//${url.host}` } };
}

function duePeriod(schedule, now) {
  const [today, time] = display(now).split(' ');
  const localDay = today.replaceAll('/', '-');
  if (Number(time.slice(0, 2)) < schedule.hour ||
      (schedule.frequency === 'monthly' && !localDay.endsWith('-01'))) return null;
  const yesterday = new Date(Date.parse(localDay + 'T00:00:00Z') - 86_400_000).toISOString().slice(0, 10);
  return schedule.frequency === 'monthly'
    ? { key: yesterday.slice(0, 7), from: yesterday.slice(0, 7) + '-01', to: yesterday }
    : { key: yesterday, from: yesterday, to: yesterday };
}

async function checkedPath(file, directory, mask) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) DB.fail('REPORT_MAIL_PRIVATE_PATH_REQUIRED');
  const stat = await fs.lstat(file);
  if ((directory ? !stat.isDirectory() : !stat.isFile()) ||
      (process.platform !== 'win32' && (stat.mode & mask) !== 0)) DB.fail('REPORT_MAIL_PRIVATE_PATH_INVALID');
  return stat;
}

async function settings(env) {
  const configFile = env.WMS_REPORT_MAIL_CONFIG_FILE;
  if (!configFile) return null;
  const stat = await checkedPath(configFile, false, 0o022);
  if (stat.size > 65_536) DB.fail('REPORT_MAIL_CONFIG_INVALID');
  let input;
  try { input = JSON.parse(await fs.readFile(configFile, 'utf8')); } catch { DB.fail('REPORT_MAIL_CONFIG_INVALID'); }
  const environment = env.APP_ENV || 'test';
  const config = validate(input, environment);
  const stateDir = env.WMS_REPORT_MAIL_STATE_DIR;
  await checkedPath(stateDir, true, 0o077);
  const netrcFile = env.WMS_REPORT_MAIL_NETRC_FILE;
  if (environment === 'production' || netrcFile) await checkedPath(netrcFile, false, 0o077);
  const caFile = env.WMS_REPORT_MAIL_CA_FILE;
  if (caFile) await checkedPath(caFile, false, 0o022);
  return { ...config, environment, stateDir, netrcFile, caFile };
}

function encoded(value) {
  return Buffer.from(value, 'utf8').toString('base64').match(/.{1,76}/g)?.join(crlf) || '';
}

function message({ from, to, jobId, period, attachments, language, now }) {
  const chinese = language !== 'en';
  const subject = (chinese ? '穆松尼 WMS 报表 ' : 'Musonoi WMS reports ') + period.key;
  const body = (chinese ? '附件为指定期间的 WMS 汇总报表。' : 'Attached are the WMS summary reports for the selected period.') +
    crlf + period.from + ' – ' + period.to + ' (Africa/Lubumbashi)' + crlf;
  const boundary = 'WMS.' + jobId;
  const headers = [
    'Date: ' + now.toUTCString().replace('GMT', '+0000'), 'From: ' + from, 'To: ' + to,
    'Message-ID: <wms-' + jobId + '@' + from.split('@')[1] + '>',
    'Subject: =?UTF-8?B?' + Buffer.from(subject).toString('base64') + '?=',
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="' + boundary + '"', '',
    '--' + boundary, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encoded(body)
  ];
  for (const item of attachments) {
    headers.push('--' + boundary,
      'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition: attachment; filename="' + item.name + '"',
      'Content-Transfer-Encoding: base64', '', encoded(item.data));
  }
  return Buffer.from(headers.concat('--' + boundary + '--', '').join(crlf), 'ascii');
}

async function send(config, recipient, payload) {
  const options = [
    '-q', '--silent', '--globoff', '--proto', '=smtp,smtps', '--noproxy', '*',
    '--ssl-reqd', '--tlsv1.2', '--connect-timeout', '8', '--max-time', '25',
    '--url', config.smtp.url, '--mail-from', config.smtp.from, '--mail-rcpt', recipient, '--upload-file', '-'
  ];
  if (config.netrcFile) options.push('--netrc-file', config.netrcFile);
  if (config.caFile) options.push('--cacert', config.caFile);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(path|systemroot|windir|systemdrive|tmp|temp)$/i.test(name)));
  await new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', options,
      { env, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const failed = code => reject(Object.assign(Error(code), { code }));
    child.once('error', error => failed(error.code === 'ENOENT' ? 'REPORT_MAIL_CURL_MISSING' : 'REPORT_MAIL_SMTP_FAILED'));
    child.once('close', code => code === 0 ? resolve() : failed('REPORT_MAIL_SMTP_FAILED'));
    // A rejected SMTP transaction may close its input before curl reports its exit status.
    child.stdin.on('error', () => {});
    child.stdin.end(payload);
  });
}

async function readReport(c, user, selected, period) {
  if (selected.product === 'CO_HYDROXIDE' && !await require('../server/cobalt-packing.cjs').enabled(c)) {
    DB.fail('REPORT_MAIL_PRODUCT_UNAVAILABLE');
  }
  const req = { user, productCode: selected.product };
  const result = await ReportCenter.report(c, req, { kind: selected.kind, from: period.from, to: period.to, month: period.to.slice(0, 7) });
  const data = await ReportCenter.workbook(result, req, { summaryOnly: true });
  return { name: `${selected.kind}-${selected.product}-${period.key}.xlsx`, data };
}

async function actor(c, username) {
  const user = (await c.query(
    'SELECT id,username,role_code,language_code FROM users WHERE username=$1 AND active AND deleted_at IS NULL', [username]
  )).rows[0];
  if (!user) DB.fail('REPORT_MAIL_ACTOR_UNAVAILABLE');
  user.permissions = (await c.query('SELECT permission_code FROM role_permissions WHERE role_code=$1',
    [user.role_code])).rows.map(row => row.permission_code);
  if (!['report:read', 'inventory:export'].every(key => user.permissions.includes(key))) {
    DB.fail('REPORT_MAIL_ACTOR_FORBIDDEN');
  }
  return user;
}

async function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

function deliveryRecord(config, schedule, period, recipient) {
  const jobId = sha256(JSON.stringify([config.environment, schedule.id, period.key, addressKey(recipient)])).slice(0, 40);
  return { jobId, location: path.join(config.stateDir, jobId + '.jsonl') };
}

async function deliveryState({ location, jobId }) {
  const existing = await fs.lstat(location).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (!existing) return null;
  if (existing.isFile() && existing.size <= 4096) {
    try {
      const lines = (await fs.readFile(location, 'utf8')).trim().split('\n');
      const last = JSON.parse(lines.at(-1));
      if (last.jobId === jobId && last.status === 'ACCEPTED') return 'ALREADY_ACCEPTED';
    } catch {}
  }
  DB.fail('REPORT_MAIL_DELIVERY_REVIEW_REQUIRED');
}

async function deliverOnce(config, schedule, period, recipient, dispatch) {
  const recordPath = deliveryRecord(config, schedule, period, recipient);
  const { jobId, location } = recordPath;
  let handle;
  try { handle = await fs.open(location, 'wx', 0o600); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const preceding = await deliveryState(recordPath);
    if (preceding) return preceding;
    DB.fail('REPORT_MAIL_DELIVERY_REVIEW_REQUIRED');
  }
  async function record(status) {
    await handle.appendFile(JSON.stringify({ jobId, schedule: schedule.id, period: period.key, status, at: new Date().toISOString() }) + '\n');
    await handle.sync();
  }
  try {
    // Persist the claim before entering SMTP. A crash after DATA must not trigger a duplicate report.
    await record('STARTED');
    await syncDirectory(config.stateDir);
    try { await dispatch(jobId); } catch (error) {
      await record('FAILED');
      throw error;
    }
    await record('ACCEPTED');
    return 'ACCEPTED';
  } finally {
    await handle.close();
  }
}

async function dueJobs(config, due, pool, now, {
  render = readReport, transport = send, report = writeStatus
} = {}) {
  let failures = 0;
  for (const { schedule, period } of due) {
    const req = {};
    try {
      const pending = [];
      for (const recipient of schedule.recipients) {
        try {
          const status = await deliveryState(deliveryRecord(config, schedule, period, recipient));
          if (status) report({ status, schedule: schedule.id, period: period.key });
          else pending.push(recipient);
        } catch (error) {
          failures++;
          report({ ...DB.safeError(error), schedule: schedule.id, period: period.key });
        }
      }
      if (!pending.length) continue;
      const c = await Lease.acquire(req, pool);
      const user = await actor(c, schedule.actor);
      const attachments = await Management.read(pool, async reader => {
        await reader.query("SET LOCAL statement_timeout='30s'");
        const files = [];
        let bytes = 0;
        for (const selected of schedule.reports) {
          const file = await render(reader, user, selected, period);
          bytes += file.data.length;
          if (bytes > maxAttachmentBytes) DB.fail('REPORT_MAIL_ATTACHMENT_TOO_LARGE');
          files.push(file);
        }
        return files;
      });
      for (const recipient of pending) {
        try {
          Lease.healthy(req);
          await c.query('SELECT 1');
          const status = await deliverOnce(config, schedule, period, recipient, jobId =>
            transport(config, recipient, message({
              from: config.smtp.from, to: recipient, jobId, period, attachments,
              language: user.language_code, now
            }))
          );
          report({ status, schedule: schedule.id, period: period.key });
        } catch (error) {
          failures++;
          report({ ...DB.safeError(error), schedule: schedule.id, period: period.key });
        }
      }
    } catch (error) {
      failures++;
      report({ ...DB.safeError(error), schedule: schedule.id, period: period.key });
    } finally {
      await Lease.release(req);
    }
  }
  return failures;
}

async function main(env = process.env, now = new Date()) {
  const config = await settings(env);
  if (!config) { writeStatus({ status: 'DISABLED' }); return 0; }
  const due = config.schedules.map(schedule => ({ schedule, period: duePeriod(schedule, now) })).filter(job => job.period);
  if (!due.length) { writeStatus({ status: 'NO_REPORT_DUE' }); return 0; }
  const cfg = require('../server/config.cjs').config();
  if (cfg.environment !== config.environment) DB.fail('REPORT_MAIL_ENVIRONMENT_MISMATCH');
  const options = DB.connection(cfg, 'app');
  await DB.network(cfg, options);
  const pool = new Pool({ ...options, max: 2, application_name: 'musonoi-report-mail' });
  try {
    const client = await pool.connect();
    try {
      await DB.verify(client, cfg, 'app');
      const { rows: [system] } = await client.query('SELECT environment FROM system_info WHERE singleton');
      if (system?.environment !== config.environment) DB.fail('REPORT_MAIL_DATABASE_MISMATCH');
    } finally { client.release(); }
    return await dueJobs(config, due, pool, now) ? 1 : 0;
  } finally {
    await pool.end();
  }
}

module.exports = { validate, duePeriod, settings, message, send, deliverOnce, dueJobs, readReport, main };
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(JSON.stringify(DB.safeError(error)));
  process.exitCode = 1;
});
