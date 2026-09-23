import { spawnSync } from 'node:child_process';

// Fail closed: a missing emulator must never silently skip the security checks.
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085') {
  console.error('Run through Firebase emulators:exec using the repository firebase.json.');
  process.exit(1);
}
const test = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/feedback-firestore.test.ts'], { stdio: 'inherit', env: process.env });
process.exit(test.status ?? 1);
