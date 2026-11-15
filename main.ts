// VAULTLINE — the entrypoint for the make.fun threejs-fps-02 bounty.
//
// The program does three things, in order:
//   1. Copies the game (game/) and its screenshots (screenshots/) into the
//      output directory, so the whole entry sits in one place.
//   2. Asks the vendored make.fun library to describe that directory as a
//      dossier: what the game holds, its sources in reading order, and the
//      screenshots, the first by name being the cover.
//   3. Writes that dossier as dossier.json beside the copies.
//
// It finds game/ and screenshots/ beside this file, so it runs from any
// working directory. The output directory is MAKEFUN_OUTPUT_DIR when set,
// otherwise /output. Node 22, standard library only: no build step, no
// install, nothing fetched from the network.

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildDossier } from './vendor/makefun-threejs.ts';

// The scorer's caps for this bounty, from the kit's gate: the most text the
// dossier may carry, at most four screenshots of at most 256 KiB each, and
// the game's own file and byte caps.
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

// The directory this file lives in: game/ and screenshots/ sit beside it.
const repoRoot = dirname(fileURLToPath(import.meta.url));

// Where the entry goes: the environment's choice, else /output.
const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

/** Copies a whole directory tree, refusing when the source is not there. */
function copyTree(from: string, to: string): void {
  if (!existsSync(from)) throw new Error(`${from}: no such directory (expected beside main.ts)`);
  cpSync(from, to, { recursive: true });
}

/** How many files a directory tree holds, directories not counted. */
function countFiles(dir: string): number {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
  }
  return n;
}

/** Builds the entry. Throws a plain Error on anything it cannot do. */
function main(): void {
  const gameSrc = join(repoRoot, 'game');
  const shotsSrc = join(repoRoot, 'screenshots');
  const gameOut = join(outDir, 'game');
  const shotsOut = join(outDir, 'screenshots');

  mkdirSync(outDir, { recursive: true });
  copyTree(gameSrc, gameOut);
  copyTree(shotsSrc, shotsOut);

  const dossier = buildDossier(outDir, CAPS);
  const dossierPath = join(outDir, 'dossier.json');
  writeFileSync(dossierPath, dossier);

  const gameFiles = countFiles(gameOut);
  const shotFiles = countFiles(shotsOut);
  console.log(`wrote ${dossierPath} (${dossier.length} bytes): game ${gameFiles} files, screenshots ${shotFiles} files`);
}

try {
  main();
} catch (err) {
  console.error(`error: ${(err as Error).message}`);
  process.exit(1);
}
