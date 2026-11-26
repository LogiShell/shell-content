// Starts the skill's preview (node <skill>/preview.mjs <shell folder> --no-open) for the whole run and stops it after.
// The skill folder comes from LSH_SKILL_DIR, otherwise the one Claude Code keeps in ~/.claude/skills.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default async function globalSetup() {
  if (process.env.BASE_URL) return; // an already running preview
  const skill = resolve(process.env.LSH_SKILL_DIR ?? join(homedir(), '.claude/skills/logishell-shell'));
  const script = join(skill, 'preview.mjs');
  if (!existsSync(script)) throw new Error(`No preview.mjs in ${skill}. Set LSH_SKILL_DIR or download https://shell.lsh.dev/skill.tgz`);
  const shell = resolve(here, '..');
  const port = String(4400 + Math.floor(Math.random() * 400));
  const child = spawn(process.execPath, [script, shell, '--no-open', '--port', port], { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const address = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('The preview did not start in 20 s:\n' + log)), 20_000);
    const take = (chunk) => {
      log += chunk;
      const m = log.match(/http:\/\/localhost:\d+\/local/);
      if (m) { clearTimeout(timer); ok(m[0]); }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('exit', (code) => { clearTimeout(timer); fail(new Error(`The preview exited with ${code}:\n${log}`)); });
  });
  process.env.BASE_URL = address;
  return async () => { child.kill(); };
}
