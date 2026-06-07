#!/usr/bin/env node

// `driftCli` statically imports `@babel/core`. Importing it *dynamically* here keeps that resolution
// inside the try/catch, so a missing peer dependency produces a friendly hint instead of a raw
// ERR_MODULE_NOT_FOUND stack trace at process startup (a static import would throw before any code runs).
async function main(): Promise<void> {
  try {
    const { runCli } = await import('./driftCli');
    process.exit(await runCli(process.argv.slice(2)));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/@babel\/core/.test(msg)) {
      console.error('semantic-inspector: requires @babel/core — npm i -D @babel/core');
    } else {
      console.error(`semantic-inspector: ${msg}`);
    }
    process.exit(2);
  }
}

void main();
