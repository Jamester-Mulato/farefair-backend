/* Regenerate js/snapshot.js from the app's live city datasets.
 *
 * The admin console prefers fetching assets/data/*.json at runtime. The
 * snapshot is the offline fallback: it keeps the console usable when the page
 * is opened from file:// or hosted without the app's asset folder.
 *
 * Usage (from this folder):
 *   node tool/generate_admin_snapshot.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const adminDir = path.resolve(here, '..');
const repoRoot = path.resolve(adminDir, '..', '..');
const dataDir = path.join(repoRoot, 'assets', 'data');

const configPath = path.join(dataDir, 'app_config.json');
if (!fs.existsSync(configPath)) {
  console.error('Could not find assets/data/app_config.json at ' + configPath);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const cities = {};

for (const entry of config.cities) {
  const relative = String(entry.asset || '').replace(/^assets\/data\//, '');
  if (!relative) continue;
  const file = path.join(dataDir, relative);
  const city = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!city.id) {
    console.error('Skipping ' + file + ': missing "id"');
    continue;
  }
  if (city.id !== entry.id) {
    console.warn('Warning: ' + file + ' has id "' + city.id + '" but app_config lists "' + entry.id + '"');
  }
  cities[city.id] = city;
}

const snapshot = `/* Auto-generated snapshot of assets/data (${Object.keys(cities).length} cities).
 * Regenerate after editing city datasets: node tool/generate_admin_snapshot.mjs
 * The dashboard prefers live JSON assets when served; this keeps file:// demos working. */
window.FAREFAIR_SNAPSHOT = ${JSON.stringify({ config, cities }, null, 2)};
`;

const outFile = path.join(adminDir, 'js', 'snapshot.js');
fs.writeFileSync(outFile, snapshot, 'utf8');
console.log('Wrote ' + outFile + ' (' + snapshot.length + ' bytes, ' + Object.keys(cities).length + ' cities)');
