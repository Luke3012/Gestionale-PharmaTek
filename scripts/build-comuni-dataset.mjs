#!/usr/bin/env node
/**
 * Reads comuni.json (matteocontrini/comuni-json) and generates two
 * TypeScript data files for PharmaTek:
 *   - src/data/belfiore.ts   (comune → codice catastale)
 *   - src/data/cap-db.ts     (CAP ↔ comune/provincia/regione)
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── 1. Read source data ────────────────────────────────────────────
const raw = readFileSync(join(__dirname, "comuni.json"), "utf-8");
const comuni = JSON.parse(raw);
console.log(`Loaded ${comuni.length} comuni from comuni.json`);

// ── 2. Ensure output directory exists ──────────────────────────────
const dataDir = join(ROOT, "src", "data");
mkdirSync(dataDir, { recursive: true });

// ── 3. Build belfiore.ts ───────────────────────────────────────────
const belfioreMap = new Map();
for (const c of comuni) {
  const key = c.nome.toLowerCase();
  const val = c.codiceCatastale;
  belfioreMap.set(key, val);
}
const belfioreEntries = [...belfioreMap.entries()];
// Sort alphabetically by key
belfioreEntries.sort((a, b) => a[0].localeCompare(b[0]));

let belfioreTs = `// Dataset comuni → codice Belfiore (catastale) per il calcolo del Codice Fiscale.
// Fonte: matteocontrini/comuni-json — NON MODIFICARE A MANO.
export const BELFIORE: Record<string, string> = {\n`;

for (const [key, val] of belfioreEntries) {
  belfioreTs += `  ${JSON.stringify(key)}: ${JSON.stringify(val)},\n`;
}
belfioreTs += `};\n`;

const belfiorePath = join(dataDir, "belfiore.ts");
writeFileSync(belfiorePath, belfioreTs, "utf-8");

// ── 4. Build cap-db.ts ─────────────────────────────────────────────
// Build ComuneInfo objects
const comuneInfoMap = new Map(); // lowercase nome → ComuneInfo
const capToComuniMap = new Map(); // cap string → ComuneInfo[]

for (const c of comuni) {
  const info = {
    nome: c.nome,
    sigla: c.sigla,
    provincia: c.provincia.nome,
    regione: c.regione.nome,
    cap: c.cap,
  };

  const key = c.nome.toLowerCase();
  comuneInfoMap.set(key, info);

  for (const cap of c.cap) {
    if (!capToComuniMap.has(cap)) {
      capToComuniMap.set(cap, []);
    }
    capToComuniMap.get(cap).push(info);
  }
}

// Helper: serialise a ComuneInfo object
function serInfo(info) {
  return `{ nome: ${JSON.stringify(info.nome)}, sigla: ${JSON.stringify(info.sigla)}, provincia: ${JSON.stringify(info.provincia)}, regione: ${JSON.stringify(info.regione)}, cap: [${info.cap.map(c => JSON.stringify(c)).join(", ")}] }`;
}

// Sort CAP keys
const sortedCaps = [...capToComuniMap.keys()].sort();
// Sort comune keys
const sortedComuneKeys = [...comuneInfoMap.keys()].sort((a, b) => a.localeCompare(b));

let capDbTs = `// Dataset CAP ↔ comune/provincia/regione per auto-compilazione indirizzi.
// Fonte: matteocontrini/comuni-json — NON MODIFICARE A MANO.
export interface ComuneInfo {
  nome: string;
  sigla: string;
  provincia: string;
  regione: string;
  cap: string[];
}

// CAP → lista comuni (un CAP può corrispondere a più comuni)
export const CAP_TO_COMUNI: Record<string, ComuneInfo[]> = {\n`;

for (const cap of sortedCaps) {
  const infos = capToComuniMap.get(cap);
  const entries = infos.map(i => serInfo(i)).join(", ");
  capDbTs += `  ${JSON.stringify(cap)}: [${entries}],\n`;
}
capDbTs += `};\n\n`;

capDbTs += `// Nome comune (lowercase) → info completa
export const COMUNE_TO_INFO: Record<string, ComuneInfo> = {\n`;

for (const key of sortedComuneKeys) {
  const info = comuneInfoMap.get(key);
  capDbTs += `  ${JSON.stringify(key)}: ${serInfo(info)},\n`;
}
capDbTs += `};\n`;

const capDbPath = join(dataDir, "cap-db.ts");
writeFileSync(capDbPath, capDbTs, "utf-8");

// ── 5. Report ──────────────────────────────────────────────────────
const belfioreSize = statSync(belfiorePath).size;
const capDbSize = statSync(capDbPath).size;

console.log(`\n✅ Generated files:`);
console.log(`   ${belfiorePath}`);
console.log(`     → ${belfioreEntries.length} entries, ${(belfioreSize / 1024).toFixed(1)} KB`);
console.log(`   ${capDbPath}`);
console.log(`     → ${sortedCaps.length} CAP entries, ${sortedComuneKeys.length} comuni entries, ${(capDbSize / 1024).toFixed(1)} KB`);
console.log(`\nDone.`);
