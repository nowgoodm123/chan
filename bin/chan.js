#!/usr/bin/env node
import { main } from '../src/cli/main.js';

main(process.argv.slice(2)).catch((err) => {
  if (err && err.name === 'AbortError') {
    process.exitCode = 130;
    return;
  }
  const message = err && err.message ? err.message : String(err);
  console.error(`chan: ${message}`);
  if (process.env.CHAN_DEBUG && err && err.stack) console.error(err.stack);
  process.exitCode = 1;
});
