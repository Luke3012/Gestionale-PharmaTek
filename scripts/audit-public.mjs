import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
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
const patterns = [
  ["indirizzo e-mail letterale", /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
  ["IBAN italiano", /\bIT\s*\d{2}\s*[A-Z]\s*(?:\d\s*){10}(?:[A-Z0-9]\s*){12}\b/i],
  ["numero telefonico", /(?:\+39|0039)[\s.-]*\d{3}[\s.-]*\d{3,4}[\s.-]*\d{3,4}|\b3\d{2}[\s.-]+\d{3}[\s.-]+\d{4}\b/],
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
  for (const [label, pattern] of patterns) if (pattern.test(text)) findings.push(`${relative}: ${label}`);
}
if (findings.length) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log("Audit pubblico completato: nessun rilievo.");
