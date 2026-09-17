// Editor grafico del changelog (zero dipendenze: solo moduli Node integrati).
// Avvia un server locale che legge/scrive src/features/changelog/changelog.json e
// rigenera docs/CHANGELOG.md. Si lancia con `npm run changelog` o `scripts/changelog.ps1`.
//
//   GET  /                 → pagina dell'editor
//   GET  /api/changelog    → contenuto attuale del changelog (JSON)
//   POST /api/changelog    → salva il changelog (e rigenera docs/CHANGELOG.md)
//   GET  /api/version      → versione corrente da package.json (per precompilare)
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { exec } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHANGELOG = join(ROOT, "src/features/changelog/changelog.json");
const CHANGELOG_MD = join(ROOT, "docs/CHANGELOG.md");
const PKG = join(ROOT, "package.json");
const PORT = 4517;

const ETICHETTE = { novita: "✨ Novità", correzioni: "🐞 Correzioni", altro: "🔧 Altro" };

/** Genera docs/CHANGELOG.md (leggibile) a partire dai dati strutturati. */
function generaMarkdown(versioni) {
  const righe = ["# Changelog", "", "<!-- Generato da scripts/changelog.ps1 — non modificare a mano. -->", ""];
  for (const v of versioni) {
    righe.push(`## ${v.versione} — ${v.data}`, "");
    if (v.sintesi) righe.push(v.sintesi, "");
    for (const cat of ["novita", "correzioni", "altro"]) {
      const voci = (v.voci || []).filter((x) => x.categoria === cat);
      if (voci.length) {
        righe.push(`**${ETICHETTE[cat]}**`, "");
        for (const x of voci) righe.push(`- ${x.testo}`);
        righe.push("");
      }
    }
  }
  return righe.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function inviaJson(res, code, dati) {
  const corpo = JSON.stringify(dati);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(corpo);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PAGINA);
      return;
    }
    if (req.method === "GET" && req.url === "/api/changelog") {
      const raw = await readFile(CHANGELOG, "utf8").catch(() => '{"versioni":[]}');
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(raw);
      return;
    }
    if (req.method === "GET" && req.url === "/api/version") {
      const pkg = JSON.parse(await readFile(PKG, "utf8"));
      inviaJson(res, 200, { versione: pkg.version ?? "" });
      return;
    }
    if (req.method === "POST" && req.url === "/api/changelog") {
      let corpo = "";
      for await (const chunk of req) corpo += chunk;
      const dati = JSON.parse(corpo);
      if (!dati || !Array.isArray(dati.versioni)) throw new Error("Formato non valido: manca l'array 'versioni'.");
      const json = JSON.stringify({ versioni: dati.versioni }, null, 2) + "\n";
      await writeFile(CHANGELOG, json, "utf8");
      await writeFile(CHANGELOG_MD, generaMarkdown(dati.versioni), "utf8").catch(() => {});
      inviaJson(res, 200, { ok: true });
      return;
    }
    res.writeHead(404).end("Not found");
  } catch (e) {
    inviaJson(res, 400, { errore: String(e?.message || e) });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const url = `http://localhost:${PORT}`;
    console.log(`\n  L'editor changelog è già attivo su ${url}`);
    console.log("  Apro il browser sull'istanza già in esecuzione...\n");
    const cmd =
      process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {
      process.exit(0);
    });
    return;
  }
  console.error("\n[ERRORE Server Changelog]", err);
  process.exit(1);
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Editor changelog avviato su ${url}`);
  console.log("  (chiudi questa finestra o premi Ctrl+C per terminare)\n");
  const cmd =
    process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
});

const PAGINA = /* html */ `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Editor Changelog — PharmaTek</title>
<style>
  :root {
    --accent: #4c6ef5; --accent-d: #3b5bdb; --bg: #f4f6fb; --surface: #fff;
    --ink: #1f2733; --dim: #6b7785; --line: #e6e9f0;
    --novita: #4c6ef5; --correzioni: #f08c00; --altro: #9c36b5;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 "Segoe UI", system-ui, sans-serif; color: var(--ink); background: var(--bg); }
  header {
    position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 12px;
    padding: 14px 22px; background: rgba(255,255,255,.85); backdrop-filter: blur(8px); border-bottom: 1px solid var(--line);
  }
  header h1 { font-size: 17px; margin: 0; font-weight: 800; }
  header .sp { flex: 1; }
  .wrap { max-width: 820px; margin: 0 auto; padding: 22px; }
  button { font: inherit; cursor: pointer; border-radius: 9px; border: 1px solid var(--line); background: var(--surface); padding: 8px 14px; color: var(--ink); transition: .12s; }
  button:hover { border-color: #cfd5e0; }
  button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  button.primary:hover { background: var(--accent-d); }
  button.ghost { border-color: transparent; color: var(--dim); padding: 6px 8px; }
  button.ghost:hover { background: #eef1f7; color: var(--ink); }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; padding: 18px 20px; margin-bottom: 18px; box-shadow: 0 4px 18px rgba(20,30,60,.04); }
  .vhead { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .vhead input.ver { width: 90px; font-weight: 800; font-size: 18px; }
  .vhead input.data { width: 150px; }
  input, textarea { font: inherit; color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; background: #fff; }
  input:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(76,110,245,.15); }
  .sintesi { width: 100%; margin-bottom: 14px; resize: vertical; min-height: 38px; }
  .grp { margin-bottom: 12px; }
  .glab { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 6px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; }
  .row { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
  .row input { flex: 1; }
  .addrow { font-size: 13px; color: var(--accent); border: 1px dashed var(--line); background: transparent; }
  .addrow:hover { border-color: var(--accent); }
  .muted { color: var(--dim); font-size: 13px; }
  .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px); opacity: 0; background: #1f2733; color: #fff; padding: 10px 18px; border-radius: 999px; transition: .25s; pointer-events: none; }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  .toast.err { background: #c92a2a; }
</style>
</head>
<body>
<header>
  <h1>📓 Changelog — PharmaTek</h1>
  <span class="sp"></span>
  <button id="add">+ Nuova versione</button>
  <button id="save" class="primary">Salva</button>
</header>
<div class="wrap">
  <p class="muted">Le voci qui scritte appaiono nel pannello «Novità» all'avvio dopo un aggiornamento e nello storico in Info. La <b>sintesi</b> è la riga mostrata nella notifica di aggiornamento. Una versione con la sola sintesi (nessuna voce) <b>non</b> apre il pannello.</p>
  <div id="lista"></div>
</div>
<div id="toast" class="toast"></div>
<script>
const CATS = [
  { id: "novita", lab: "Novità", col: "var(--novita)" },
  { id: "correzioni", lab: "Correzioni", col: "var(--correzioni)" },
  { id: "altro", lab: "Altro", col: "var(--altro)" },
];
let model = [];
let versioneApp = "";

function oggi() { return new Date().toISOString().slice(0, 10); }

async function carica() {
  const [cl, ver] = await Promise.all([
    fetch("/api/changelog").then((r) => r.json()).catch(() => ({ versioni: [] })),
    fetch("/api/version").then((r) => r.json()).catch(() => ({ versione: "" })),
  ]);
  versioneApp = ver.versione || "";
  model = (cl.versioni || []).map((v) => ({
    versione: v.versione || "",
    data: v.data || oggi(),
    sintesi: v.sintesi || "",
    gruppi: {
      novita: (v.voci || []).filter((x) => x.categoria === "novita").map((x) => x.testo),
      correzioni: (v.voci || []).filter((x) => x.categoria === "correzioni").map((x) => x.testo),
      altro: (v.voci || []).filter((x) => x.categoria === "altro").map((x) => x.testo),
    },
  }));
  render();
}

function render() {
  const lista = document.getElementById("lista");
  lista.innerHTML = "";
  if (!model.length) {
    lista.innerHTML = '<p class="muted">Nessuna versione. Aggiungine una con «+ Nuova versione».</p>';
    return;
  }
  model.forEach((v, vi) => lista.appendChild(cardVersione(v, vi)));
}

function cardVersione(v, vi) {
  const card = document.createElement("div");
  card.className = "card";

  const head = document.createElement("div");
  head.className = "vhead";
  head.innerHTML =
    '<span class="muted">v</span>' +
    '<input class="ver" placeholder="0.0.0" value="' + esc(v.versione) + '" />' +
    '<input class="data" type="date" value="' + esc(v.data) + '" />' +
    '<span style="flex:1"></span>' +
    '<button class="ghost" title="Elimina versione">🗑 Elimina</button>';
  head.querySelector("input.ver").addEventListener("input", (e) => (v.versione = e.target.value));
  head.querySelector("input.data").addEventListener("input", (e) => (v.data = e.target.value));
  head.querySelector("button").addEventListener("click", () => { model.splice(vi, 1); render(); });
  card.appendChild(head);

  const sintesi = document.createElement("textarea");
  sintesi.className = "sintesi";
  sintesi.placeholder = "Riga di sintesi (mostrata nella notifica di aggiornamento)";
  sintesi.value = v.sintesi;
  sintesi.addEventListener("input", (e) => (v.sintesi = e.target.value));
  card.appendChild(sintesi);

  CATS.forEach((c) => card.appendChild(gruppo(v, c)));
  return card;
}

function gruppo(v, c) {
  const box = document.createElement("div");
  box.className = "grp";
  const lab = document.createElement("div");
  lab.className = "glab";
  lab.innerHTML = '<span class="dot" style="background:' + c.col + '"></span>' + c.lab;
  box.appendChild(lab);

  const voci = v.gruppi[c.id];
  voci.forEach((_, i) => box.appendChild(rigaVoce(v, c, i)));

  const add = document.createElement("button");
  add.className = "addrow";
  add.textContent = "+ Aggiungi " + c.lab.toLowerCase();
  add.addEventListener("click", () => { v.gruppi[c.id].push(""); render(); });
  box.appendChild(add);
  return box;
}

function rigaVoce(v, c, i) {
  const row = document.createElement("div");
  row.className = "row";
  const inp = document.createElement("input");
  inp.value = v.gruppi[c.id][i];
  inp.placeholder = "Descrivi il cambiamento…";
  inp.addEventListener("input", (e) => (v.gruppi[c.id][i] = e.target.value));
  const del = document.createElement("button");
  del.className = "ghost";
  del.textContent = "✕";
  del.title = "Rimuovi";
  del.addEventListener("click", () => { v.gruppi[c.id].splice(i, 1); render(); });
  row.appendChild(inp);
  row.appendChild(del);
  return row;
}

function esc(s) { return String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

function toModello() {
  return {
    versioni: model.map((v) => ({
      versione: v.versione.trim(),
      data: v.data,
      sintesi: v.sintesi.trim(),
      voci: CATS.flatMap((c) => v.gruppi[c.id].map((t) => t.trim()).filter(Boolean).map((testo) => ({ categoria: c.id, testo }))),
    })),
  };
}

function mostraToast(msg, err) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (err ? " err" : "");
  setTimeout(() => (t.className = "toast"), 2200);
}

document.getElementById("add").addEventListener("click", () => {
  model.unshift({ versione: versioneApp, data: oggi(), sintesi: "", gruppi: { novita: [""], correzioni: [], altro: [] } });
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

document.getElementById("save").addEventListener("click", async () => {
  try {
    const r = await fetch("/api/changelog", { method: "POST", body: JSON.stringify(toModello()) });
    const j = await r.json();
    if (!r.ok || j.errore) throw new Error(j.errore || "Errore di salvataggio");
    mostraToast("Changelog salvato ✓");
  } catch (e) {
    mostraToast(String(e.message || e), true);
  }
});

carica();
</script>
</body>
</html>`;
