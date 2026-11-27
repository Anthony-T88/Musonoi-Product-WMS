'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');
const DB = require('../server/database-connection.cjs');
const Lease = require('../server/authorization-lease.cjs');
const Management = require('../server/management.cjs');
const ReportCenter = require('../server/report-center.cjs');
const Policy = require('../server/report-mail-policy.cjs');
const Transport = require('../server/report-mail-transport.cjs');
const { duePeriod } = Policy;

const maxAttachmentBytes = 10 * 1024 * 1024;
const crlf = '\r\n';
const writeStatus = record => console.log(JSON.stringify(record));
const sha256 = value => createHash('sha256').update(value).digest('hex');
function validate(value, environment) {
  const config = Transport.validateHost(value, environment);
  Policy.validateSchedules(config.schedules, {
    environment, allowlist: new Set(config.recipientAllowlist.map(Policy.addressKey)), accountsAllowed: false
  });
  return config;
}

function selectedSchedules(config, policy) {
  const effective = Policy.effectivePolicy(config, policy);
  if (!effective.enabled) return [];
  if (policy.version !== 0) {
    Policy.validateSchedules(effective.schedules, {
      environment: config.environment, allowlist: new Set(config.recipientAllowlist.map(Policy.addressKey)), enabled: false
    });
  }
  return effective.schedules.filter(Policy.scheduleEnabled);
}

async function settings(env) {
  const environment = env.APP_ENV || 'test';
  const config = await Transport.readHost(env, environment);
  if (!config) return null;
  const stateDir = env.WMS_REPORT_MAIL_STATE_DIR;
  await Transport.checkedPath(stateDir, true, 0o077);
  const caFile = env.WMS_REPORT_MAIL_CA_FILE;
  if (caFile) await Transport.checkedPath(caFile, false, 0o022);
  return { ...config, stateDir, netrcFile: env.WMS_REPORT_MAIL_NETRC_FILE, caFile };
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

function curlSend(config, recipient, payload, netrcFile) {
  const options = [
    '-q', '--silent', '--globoff', '--proto', '=smtp,smtps', '--noproxy', '*',
    '--ssl-reqd', '--tlsv1.2', '--connect-timeout', '8', '--max-time', '25',
    '--url', config.smtp.url, '--mail-from', config.smtp.from, '--mail-rcpt', recipient, '--upload-file', '-'
  ];
  if (netrcFile) options.push('--netrc', '--netrc-file', netrcFile);
  if (config.caFile) options.push('--cacert', config.caFile);
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(path|systemroot|windir|systemdrive|tmp|temp)$/i.test(name)));
  return new Promise((resolve, reject) => {
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

async function send(config, recipient, payload) {
  if (!config.transport?.version) return curlSend(config, recipient, payload, config.netrcFile);
  const key = await Transport.readKey(config.keyEnvironment);
  try {
    const password = Transport.open(config.transport.sealedPassword, config.transport, key);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wms-mail-'));
    const netrc = path.join(dir, 'smtp.netrc');
    const quoted = value => '"' + value.replace(/["\\]/g, '\\$&') + '"';
    try {
      const host = Transport.smtpUrl(config.smtp.url).host;
      await fs.writeFile(netrc, 'machine ' + host + ' login ' + quoted(config.transport.username) +
        ' password ' + quoted(password) + '\n', { mode: 0o600, flag: 'wx' });
      return await curlSend(config, recipient, payload, netrc);
    } finally {
      await fs.unlink(netrc).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await fs.rmdir(dir);
    }
  } finally {
    key.fill(0);
  }
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
  const jobId = sha256(JSON.stringify([config.environment, schedule.id, period.key, Policy.addressKey(recipient)])).slice(0, 40);
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

async function scheduledRecipients(c, schedule, config) {
  if (!schedule.recipientAccounts) return schedule.recipients;
  const accounts = await Policy.recipientAccounts(c, schedule.recipientAccounts);
  if (accounts.length !== schedule.recipientAccounts.length || accounts.some(account =>
    !Transport.approvedRecipient(config, account.email) ||
      (config.environment === 'test' && !Policy.testMailbox(account.email)))) {
    DB.fail('REPORT_MAIL_RECIPIENT_UNAVAILABLE');
  }
  return [...new Map(accounts.map(account => [Policy.addressKey(account.email), account.email])).values()];
}

async function dueJobs(config, due, pool, now, {
  render = readReport, transport = send, report = writeStatus
} = {}) {
  let failures = 0;
  for (const { schedule, period } of due) {
    const req = {};
    try {
      const c = await Lease.acquire(req, pool);
      const pending = [];
      for (const recipient of await scheduledRecipients(c, schedule, config)) {
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
          if (config.policyVersion !== undefined) {
            const { rows: [current] } = await c.query('SELECT version FROM report_mail_settings WHERE singleton');
            if (current?.version !== config.policyVersion) DB.fail('REPORT_MAIL_POLICY_CHANGED');
          } else await c.query('SELECT 1');
          if (config.transport) {
            const { rows: [current] } = await c.query('SELECT version FROM report_mail_transport WHERE singleton');
            if (current?.version !== config.transport.version) DB.fail('REPORT_MAIL_TRANSPORT_CHANGED');
          }
          if (schedule.recipientAccounts && !(await scheduledRecipients(c, schedule, config)).includes(recipient)) {
            DB.fail('REPORT_MAIL_RECIPIENT_UNAVAILABLE');
          }
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
  const cfg = require('../server/config.cjs').config();
  if (cfg.environment !== config.environment) DB.fail('REPORT_MAIL_ENVIRONMENT_MISMATCH');
  const options = DB.connection(cfg, 'app');
  await DB.network(cfg, options);
  const pool = new Pool({ ...options, max: 2, application_name: 'musonoi-report-mail' });
  try {
    let policy, transport;
    const client = await pool.connect();
    try {
      await DB.verify(client, cfg, 'app');
      const { rows: [system] } = await client.query('SELECT environment FROM system_info WHERE singleton');
      if (system?.environment !== config.environment) DB.fail('REPORT_MAIL_DATABASE_MISMATCH');
      policy = await Policy.readPolicy(client);
      transport = await Transport.readTransport(client);
    } finally { client.release(); }
    const schedules = selectedSchedules(config, policy);
    if (!schedules.length) { writeStatus({ status: 'DISABLED' }); return 0; }
    const due = schedules.map(schedule => ({ schedule, period: duePeriod(schedule, now) })).filter(job => job.period);
    if (!due.length) { writeStatus({ status: 'NO_REPORT_DUE' }); return 0; }
    if (transport.version) {
      if (!Transport.approvedSender(config, transport.url, transport.from) || !Transport.credential(transport.username, 254)) {
        DB.fail('REPORT_MAIL_TRANSPORT_NOT_APPROVED');
      }
      config.smtp = { url: transport.url, from: transport.from };
    } else if (config.environment === 'production' || config.netrcFile) {
      await Transport.checkedPath(config.netrcFile, false, 0o077);
    }
    const keyEnvironment = { WMS_REPORT_MAIL_KEY_FILE: env.WMS_REPORT_MAIL_KEY_FILE };
    return await dueJobs({ ...config, policyVersion: policy.version, transport, keyEnvironment }, due, pool, now) ? 1 : 0;
  } finally {
    await pool.end();
  }
}

module.exports = { validate, selectedSchedules, scheduledRecipients, duePeriod, settings, message, send, deliverOnce, dueJobs, readReport, main };
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(JSON.stringify(DB.safeError(error)));
  process.exitCode = 1;
});
