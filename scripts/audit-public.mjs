import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const privateProfile = process.argv[3] ? path.resolve(process.argv[3]) : "";
const ignoredDirs = new Set([".git", "node_modules", "target", "dist"]);
const forbiddenExtensions = new Set([".db", ".sqlite", ".sqlite3", ".xlsx", ".xls", ".log", ".key"]);
const textExtensions = new Set([".cjs", ".css", ".html", ".json", ".md", ".mjs", ".ps1", ".py", ".rs", ".toml", ".ts", ".tsx"]);
const findings = [];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function flatten(value) {
  if (typeof value === "string") return value.trim().length >= 4 ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value && typeof value === "object") return Object.values(value).flatMap(flatten);
  return [];
}

const exactForbidden = privateProfile && fs.existsSync(privateProfile)
  ? [...new Set(flatten(JSON.parse(fs.readFileSync(privateProfile, "utf8"))))]
  : [];
const patterns = [
  ["IBAN italiano", /\bIT\s*\d{2}\s*[A-Z]\s*(?:\d\s*){10}(?:[A-Z0-9]\s*){12}\b/i],
  ["token updater", new RegExp(["VITE", "UPDATER", "TOKEN"].join("_"), "i")],
  ["repository privato", new RegExp(["Luke3012", "PharmaTek"].join("/"), "i")],
  ["riferimento operativo rimosso", new RegExp([
    ["smtps", "aruba", "it"].join("\\."),
    ["imaps", "aruba", "it"].join("\\."),
    ["www", "pharmatek", "it"].join("\\."),
    ["Pro", "belte"].join(""),
    ["Poste", "Italiane"].join(" "),
    ["Viale E", "Forlanini"].join("\\."),
    ["G", "L", "M"].join("\\."),
  ].join("|"), "i")],
];

const laboratorioDemoEmail = ["laboratorio", "example.invalid"].join("@");
const allowedDemoEmails = new Set(["demo@example.invalid", laboratorioDemoEmail]);
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

// Numeri fittizi usati nei test automatici. Ogni altro telefono italiano
// letterale resta un rilievo, mentre i recapiti reali noti sono controllati
// anche tramite operational-profile.local.json.
const allowedDemoPhones = new Set([
  "328188324",
  "328188335",
  "3281112233",
  "3289998877",
  "3281883355",
  "3302847548",
  "3331234567",
  "0811234567",
  "3280000000",
  "3280000001",
  "3280000002",
  "3381112233",
  "3385554433",
  "3399998877",
]);
const italianPhone = /(?:\+39|0039)[\s.-]*\d{3}[\s.-]*\d{3,4}[\s.-]*\d{3,4}|\b3\d{2}[\s.-]+\d{3}[\s.-]+\d{3,4}\b/gi;

function normalizeItalianPhone(value) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0039")) digits = digits.slice(4);
  else if (digits.startsWith("39") && digits.length > 10) digits = digits.slice(2);
  return digits;
}

for (const file of walk(root)) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const extension = path.extname(file).toLowerCase();
  if (relative.toLowerCase() === "scripts/release.ps1") {
    findings.push(`${relative}: script di pubblicazione vietato`);
  }
  if (forbiddenExtensions.has(extension)) findings.push(`${relative}: tipo di file vietato`);
  if (!textExtensions.has(extension)) continue;
  const buffer = fs.readFileSync(file);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) findings.push(`${relative}: ${label}`);
  }
  for (const match of text.matchAll(emailPattern)) {
    if (!allowedDemoEmails.has(match[0].toLowerCase())) {
      findings.push(`${relative}: indirizzo e-mail letterale`);
      break;
    }
  }
  for (const match of text.matchAll(italianPhone)) {
    if (!allowedDemoPhones.has(normalizeItalianPhone(match[0]))) {
      findings.push(`${relative}: numero telefonico`);
      break;
    }
  }
  for (const forbidden of exactForbidden) {
    if (text.includes(forbidden)) findings.push(`${relative}: valore presente nel profilo operativo`);
  }
}

if (findings.length) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log("Audit pubblico completato: nessun rilievo.");
