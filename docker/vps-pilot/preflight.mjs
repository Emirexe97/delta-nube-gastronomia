#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const IMAGE = 'sha256:c1cf559ea8f3c286b719c508bbffea31007c06f3ac1632153cbfbae22457eaef';
const ROOT = '/home/deploy/gastronomy-account-waiter-pilot';
const PROJECT = 'gastronomy_account_waiter_pilot';
const NETWORK = `${PROJECT}_private`;
const KINDS = ['license', 'waiter'];
const SERVICE_KEYS = new Set(['image', 'pull_policy', 'entrypoint', 'command', 'working_dir', 'user', 'init', 'restart', 'read_only', 'cap_drop', 'security_opt', 'pids_limit', 'mem_limit', 'memswap_limit', 'cpus', 'tmpfs', 'logging', 'environment', 'volumes', 'healthcheck', 'networks']);
const errors = [];
const fail = message => errors.push(message);
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const eq = (actual, expected, label) => {
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) fail(`${label} must be ${JSON.stringify(expected)}`);
};
const bytes = value => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  const match = value.match(/^(\d+)(b|k|kb|m|mb|g|gb)?$/i);
  if (!match) return NaN;
  const power = { b: 0, k: 1, kb: 1, m: 2, mb: 2, g: 3, gb: 3 }[match[2]?.toLowerCase() ?? 'b'];
  return Number(match[1]) * (1024 ** power);
};

function validate(compose, projectRoot) {
  if (projectRoot !== ROOT) fail(`project root must be exactly ${ROOT}`);
  if (compose?.name !== PROJECT) fail(`compose project name must be ${PROJECT}`);
  const services = compose?.services;
  if (!services || Object.keys(services).length !== KINDS.length || Object.keys(services).some(name => !KINDS.includes(name))) fail('services must be exactly license and waiter');
  for (const kind of KINDS) {
    const svc = services?.[kind];
    if (!svc) continue;
    for (const key of Object.keys(svc)) if (!SERVICE_KEYS.has(key)) fail(`${kind}.${key} is not allowed`);
    eq(svc.image, IMAGE, `${kind}.image`);
    eq(svc.pull_policy, 'never', `${kind}.pull_policy`);
    eq(svc.entrypoint, ['node'], `${kind}.entrypoint`);
    eq(svc.command, ['/pilot/app.js'], `${kind}.command`);
    eq(svc.working_dir, '/pilot', `${kind}.working_dir`);
    eq(svc.user, '1000:1000', `${kind}.user`);
    eq(svc.init, true, `${kind}.init`);
    eq(svc.restart, 'unless-stopped', `${kind}.restart`);
    eq(svc.read_only, true, `${kind}.read_only`);
    eq(svc.cap_drop, ['ALL'], `${kind}.cap_drop`);
    eq(svc.security_opt, ['no-new-privileges:true'], `${kind}.security_opt`);
    eq(svc.pids_limit, 64, `${kind}.pids_limit`);
    const memory = kind === 'license' ? '512m' : '128m';
    const limit = bytes(memory);
    if (bytes(svc.mem_limit) !== limit) fail(`${kind}.mem_limit must be ${memory}`);
    if (bytes(svc.memswap_limit) !== limit) fail(`${kind}.memswap_limit must equal ${memory}`);
    eq(svc.cpus, kind === 'license' ? 0.5 : 0.25, `${kind}.cpus`);
    eq(svc.environment, { HOME: '/pilot-home', HOSTING_PILOT_KIND: kind, PORT: '3000', NODE_ENV: 'production' }, `${kind}.environment`);
    const mounts = svc.volumes;
    if (!Array.isArray(mounts) || mounts.length !== 2) fail(`${kind}.volumes must contain exactly release and state binds`);
    const expectedSources = [`${projectRoot}/release/${kind}`, `${projectRoot}/state/${kind}`];
    const expectedTargets = ['/pilot', '/pilot-home'];
    for (let i = 0; i < 2; i += 1) {
      const mount = mounts?.[i];
      if (typeof mount === 'string') {
        const [source, target, mode] = mount.split(':');
        const sourcePath = source.startsWith('/') ? path.posix.normalize(source) : path.posix.resolve(projectRoot, source);
        if (sourcePath !== expectedSources[i] || target !== expectedTargets[i] || mode !== (i === 0 ? 'ro' : 'rw')) fail(`${kind}.volumes[${i}] must bind the exact ${i === 0 ? 'read-only release' : 'writable state'} directory`);
      } else if (mount && typeof mount === 'object') {
        const normalizedSource = path.posix.normalize(String(mount.source ?? ''));
        const source = normalizedSource.startsWith('/') ? normalizedSource : path.posix.resolve(projectRoot, normalizedSource);
        if (mount.type !== 'bind' || source !== expectedSources[i] || mount.target !== expectedTargets[i] || (i === 0) !== (mount.read_only === true)) fail(`${kind}.volumes[${i}] must bind the exact ${i === 0 ? 'read-only release' : 'writable state'} directory`);
        for (const key of Object.keys(mount)) if (!['type', 'source', 'target', 'read_only', 'bind'].includes(key)) fail(`${kind}.volumes[${i}].${key} is not allowed`);
      } else fail(`${kind}.volumes[${i}] must be a bind mount`);
    }
    eq(svc.tmpfs, ['/tmp:size=8m,mode=1777'], `${kind}.tmpfs`);
    eq(svc.logging, { driver: 'local', options: { 'max-size': '5m', 'max-file': '2' } }, `${kind}.logging`);
    const alias = kind === 'license' ? 'gastronomy-pilot-license' : 'gastronomy-pilot-waiter';
    eq(svc.networks, { private: { aliases: [alias] } }, `${kind}.networks`);
    const expectedHealthcheck = ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"];
    eq(svc.healthcheck?.test, expectedHealthcheck, `${kind}.healthcheck.test`);
    eq(svc.healthcheck?.interval, '30s', `${kind}.healthcheck.interval`);
    eq(svc.healthcheck?.timeout, '3s', `${kind}.healthcheck.timeout`);
    eq(svc.healthcheck?.retries, 3, `${kind}.healthcheck.retries`);
    eq(svc.healthcheck?.start_period, '10s', `${kind}.healthcheck.start_period`);
  }
  const networks = compose?.networks;
  if (!networks || Object.keys(networks).length !== 1 || networks.private?.name !== NETWORK || networks.private?.internal !== true) fail(`network must be exactly internal ${NETWORK}`);
  if (networks?.private?.external || networks?.private?.driver_opts) fail('external or host-connected networks are forbidden');
  return errors;
}

function fixture() {
  return {
    name: PROJECT,
    services: Object.fromEntries(KINDS.map(kind => [kind, {
      image: IMAGE, pull_policy: 'never', entrypoint: ['node'], command: ['/pilot/app.js'], working_dir: '/pilot', user: '1000:1000', init: true, restart: 'unless-stopped', read_only: true,
      cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], pids_limit: 64, mem_limit: kind === 'license' ? '512m' : '128m', memswap_limit: kind === 'license' ? '512m' : '128m', cpus: kind === 'license' ? 0.5 : 0.25,
      tmpfs: ['/tmp:size=8m,mode=1777'], logging: { driver: 'local', options: { 'max-size': '5m', 'max-file': '2' } },
      environment: { HOME: '/pilot-home', HOSTING_PILOT_KIND: kind, PORT: '3000', NODE_ENV: 'production' },
      volumes: [`./release/${kind}:/pilot:ro`, `./state/${kind}:/pilot-home:rw`],
      healthcheck: { test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], interval: '30s', timeout: '3s', retries: 3, start_period: '10s' },
      networks: { private: { aliases: [kind === 'license' ? 'gastronomy-pilot-license' : 'gastronomy-pilot-waiter'] } },
    }])),
    networks: { private: { name: NETWORK, internal: true } },
  };
}

if (process.argv[2] === '--test') {
  const cases = [
    ['valid compose', c => c, ROOT, false],
    ['hostile production mount', c => { c.services.license.volumes[0] = '/:/pilot:ro'; return c; }, ROOT, true],
    ['path traversal mount', c => { c.services.waiter.volumes[1] = '../production:/pilot-home:rw'; return c; }, ROOT, true],
    ['published port', c => { c.services.waiter.ports = ['3000:3000']; return c; }, ROOT, true],
    ['resource escalation', c => { c.services.license.mem_limit = '8g'; return c; }, ROOT, true],
    ['wrong project root', c => c, '/home/deploy', true],
    ['docker socket', c => { c.services.license.volumes[0] = '/var/run/docker.sock:/docker.sock:ro'; return c; }, ROOT, true],
  ];
  for (const [name, change, projectRoot, expectFailure] of cases) {
    errors.length = 0;
    const result = validate(change(structuredClone(fixture())), projectRoot);
    if ((result.length > 0) !== expectFailure) throw new Error(`preflight self-test failed: ${name}`);
  }
  console.log(`preflight self-tests passed (${cases.length} cases)`);
  process.exit(0);
}

const [jsonPath, projectRoot] = process.argv.slice(2);
if (!jsonPath || !projectRoot) {
  console.error('Usage: node preflight.mjs <docker-compose-config.json> <absolute-project-root>');
  process.exit(2);
}
try { validate(JSON.parse(await readFile(jsonPath, 'utf8')), projectRoot); }
catch (error) { fail(`unable to read/parse compose JSON: ${error.message}`); }
if (errors.length) {
  console.error(`PREFLIGHT FAILED\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('PREFLIGHT PASSED: bounded isolated account/waiter pilot only');
