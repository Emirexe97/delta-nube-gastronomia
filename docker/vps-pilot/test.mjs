import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const preflight = fileURLToPath(new URL('./preflight.mjs', import.meta.url));
const result = spawnSync(process.execPath, [preflight, '--test'], { encoding: 'utf8' });
if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
process.stdout.write(result.stdout);
