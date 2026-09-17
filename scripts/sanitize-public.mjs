import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");

function replaceFunction(source, name, replacement) {
  const marker = `pub(super) fn ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Funzione non trovata: ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(0, start) + replacement + source.slice(i + 1);
  }
  throw new Error(`Funzione non bilanciata: ${name}`);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "target") return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

// La variante pubblica non distribuisce PDF generati. Gli screenshot e gli
// asset grafici esistenti, invece, sono intenzionalmente riutilizzati.
for (const relative of ["output/pdf"]) {
  fs.rmSync(path.join(root, relative), { recursive: true, force: true });
}
fs.rmSync(path.join(root, "scripts/release.ps1"), { force: true });

const textExtensions = new Set([
  ".cjs", ".css", ".html", ".json", ".md", ".mjs", ".ps1", ".py", ".rs", ".toml", ".ts", ".tsx",
]);
for (const file of walk(root)) {
  if (!textExtensions.has(path.extname(file).toLowerCase())) continue;
  let value = fs.readFileSync(file, "utf8");
  value = value
    // Mantieni i fixture con un recapito demo valido, così i test pubblici
    // continuano a esercitare i flussi e-mail senza esporre indirizzi reali.
    .replace(/mailto:[A-Z0-9._%+-]+%40[A-Z0-9.-]+\.[A-Z]{2,}/gi, "mailto:demo%40example.invalid")
    .replaceAll("laboratorio@example.invalid", "laboratorio@example.invalid")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "demo@example.invalid")
    .replaceAll("laboratorio@example.invalid", "demo@example.invalid")
    // Il codice distingue il conto Poste dal codice ABI/CAB nell'IBAN:
    // conserva quel solo discriminante in un valore breve e non utilizzabile.
    .replace(/\bIT\s*\d{2}\s*[A-Z]\s*(?:\d\s*){10}(?:[A-Z0-9]\s*){12}\b/gi, (iban) => {
      const normalizzato = iban.replace(/\s+/g, "").toUpperCase();
      return normalizzato.slice(5, 10) === "07601" ? "IT00 B076 01DE MO" : "IT00 X000 00DE MO";
    })
    // Evita di trasformare identificatori TypeScript in sintassi invalida
    // quando il nome operativo viene sostituito con testo leggibile.
    .replaceAll("GruppoCorriereA", "GruppoCorriereA")
    .replaceAll("preparaRigheCorriereA", "preparaRigheCorriereA")
    .replaceAll("spedizioneCorriereA", "spedizioneCorriereA")
    .replaceAll("https://github.com/Luke3012/Gestionale-PharmaTek", "https://github.com/Luke3012/Gestionale-PharmaTek")
    .replaceAll("repos/Luke3012/Gestionale-PharmaTek", "repos/Luke3012/Gestionale-PharmaTek")
    .replaceAll("Luke3012/Gestionale-PharmaTek", "Luke3012/Gestionale-PharmaTek")
    .replaceAll("VITE_DEMO_UPDATER_DISABLED", "VITE_DEMO_UPDATER_DISABLED")
    .replaceAll("smtp.example.invalid", "smtp.example.invalid")
    .replaceAll("imap.example.invalid", "imap.example.invalid")
    .replaceAll("example.invalid", "example.invalid")
    .replaceAll("", "")
    .replaceAll("", "")
    .replaceAll("", "")
    .replaceAll("", "")
    .replaceAll("PharmaTek", "PharmaTek")
    .replaceAll("PHARMATEK", "PHARMATEK")
    .replaceAll("PharmaTek", "PharmaTek")
    .replaceAll("Agente Demo 001", "Agente Demo 001")
    .replaceAll("Agente Demo 002", "Agente Demo 002")
    .replaceAll("Agente Demo 003", "Agente Demo 003")
    .replaceAll("Medico Demo 001", "Medico Demo 001")
    .replaceAll("Medico Demo 002", "Medico Demo 002")
    .replaceAll("Banca Demo", "Banca Demo")
    .replaceAll("BANCA DEMO", "BANCA DEMO")
    .replaceAll("Banca Demo", "Banca Demo")
    // Questi nomi possono comparire anche dentro identificatori e chiavi:
    // le sostituzioni restano senza spazi per non rompere la sintassi.
    .replaceAll("LABORATORIO", "LABORATORIO")
    .replaceAll("Laboratorio", "Laboratorio")
    .replaceAll("laboratorio", "laboratorio")
    .replaceAll("CORRIERE_A", "CORRIERE_A")
    .replace(/(?<![A-Za-z0-9_])Corriere A(?![A-Za-z0-9_])/g, "Corriere A")
    .replace(/(?<![A-Za-z0-9_])corriere_a(?![A-Za-z0-9_])/g, "corriere_a")
    .replaceAll("CORRIERE_B", "CORRIERE_B")
    .replaceAll("CORRIERE_C", "CORRIERE_C");
  if (path.relative(root, file).replaceAll("\\", "/") === "src-tauri/src/app/tests.rs") {
    value = value
      .replace(
        ".all(|r| r.data.get(\"prezzo_base_default\") == Some(&json!(6000))))",
        ".all(|r| r.data.get(\"prezzo_base_default\") == Some(&json!(0))))",
      )
      .replace(
        "assert_eq!(poli2.data.get(\"prezzo_base_default\"), Some(&json!(40000)));",
        "assert_eq!(poli2.data.get(\"prezzo_base_default\"), Some(&json!(0)));",
      )
      .replace(
        "assert_eq!(r2.prezzo, 40000);",
        "assert_eq!(r2.prezzo, 0);",
      );
  }
  fs.writeFileSync(file, value, "utf8");
}

const seedPath = path.join(root, "src-tauri/src/app/seed_catalog.rs");
let seed = fs.readFileSync(seedPath, "utf8");
const productsStart = seed.indexOf("pub(super) fn ensure_prodotti_default");
const diagStart = seed.indexOf("pub(super) fn ensure_prodotti_diagnostica");
let products = seed.slice(productsStart, diagStart)
  .replace(/(\("[^"]+",\s*)\d+(\))/g, "$10$2")
  .replace(/json!\(6000\)/g, "json!(0)")
  .replace(/ricavati dai file[^\n]*\n(?:[^\n]*\n){0,2}/g, "definiti dal catalogo dimostrativo.\n");
seed = seed.slice(0, productsStart) + products + seed.slice(diagStart);

const diagFunctionStart = seed.indexOf("pub(super) fn ensure_prodotti_diagnostica");
const diagBrace = seed.indexOf("{", diagFunctionStart);
let depth = 0;
let diagEnd = -1;
for (let i = diagBrace; i < seed.length; i += 1) {
  if (seed[i] === "{") depth += 1;
  if (seed[i] === "}") depth -= 1;
  if (depth === 0) { diagEnd = i + 1; break; }
}
const oldDiag = seed.slice(diagFunctionStart, diagEnd);
const entries = [...oldDiag.matchAll(/\("([A-Z]-\d+)",\s*"([^"]+)"\)/g)]
  .map((match) => `        (${JSON.stringify(match[1])}, ${JSON.stringify(match[2])}),`)
  .join("\n");
const newDiag = `pub(super) fn ensure_prodotti_diagnostica(engine: &Engine) -> AppResult<()> {\n    const DIAG: &[(&str, &str)] = &[\n${entries}\n    ];\n    for (codice, nome) in DIAG {\n        let id = seed_id("proddiag", codice);\n        ensure_record(\n            engine,\n            "prodotto",\n            &id,\n            &[\n                ("nome", json!(nome)),\n                ("categoria", json!("Diagnostica")),\n                ("codice_laboratorio", json!(codice)),\n                ("prezzo_base_default", json!(0)),\n                ("builtin", json!(true)),\n            ],\n        )?;\n    }\n    Ok(())\n}`;
seed = seed.slice(0, diagFunctionStart) + newDiag + seed.slice(diagEnd);
seed = seed
  .replace(/Le liste derivano dal file reale normalizzato\./g, "Le liste descrivono la tassonomia tecnica della demo.")
  .replace(/estratti dagli ordini Laboratorio/g, "disponibili nella demo")
  .replace(/listino\s+Laboratorio ufficiale/g, "catalogo tecnico dimostrativo")
  .replace(/Fonte: file[^\n]*/g, "Fonte: catalogo dimostrativo.")
  .replaceAll("LABORATORIO", "LABORATORIO")
  .replaceAll("Laboratorio", "Laboratorio")
  .replaceAll("laboratorio", "laboratorio");
fs.writeFileSync(seedPath, seed, "utf8");

console.log(`Sanitizzazione pubblica applicata in ${root}`);
