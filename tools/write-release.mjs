import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const channel = process.env.VITE_RELEASE_CHANNEL;
if (!['main', 'dev'].includes(channel)) throw new Error('Expected main or dev release channel');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
writeFileSync('dist/release.json', JSON.stringify({ channel, commit }) + '\n');
