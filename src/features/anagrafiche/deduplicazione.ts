import type { Campi, ExtractedClient, RecordDto } from "../../lib/tauri";
import { dividiNomeCognomeIntelligente } from "./nomeCognome";
import {
  type DatiIndirizzoConfronto,
  sonoIndirizziCompatibili,
  indirizzoStrutturatoCompatibile,
  normalizzaIndirizzo,
  pulisciCap,
  testoConfronto,
} from "./indirizzoUtils";

export {
  type DatiIndirizzoConfronto,
  sonoIndirizziCompatibili,
  indirizzoStrutturatoCompatibile,
  normalizzaIndirizzo,
  pulisciCap,
  testoConfronto,
};

export interface IndiceBatchEstratti {
  perCf: Map<string, Set<number>>;
  perNome: Map<string, Set<number>>;
  perTelefono: Map<string, Set<number>>;
  perEmail: Map<string, Set<number>>;
}

export interface IndiceClientiEsistenti {
  perCf: Map<string, RecordDto>;
  perNome: Map<string, RecordDto[]>;
  perTelefono: Map<string, RecordDto[]>;
  perEmail: Map<string, RecordDto[]>;
}

export interface DedupClienteMerge {
  canonico: RecordDto;
  duplicati: RecordDto[];
  fields: Campi;
  motivo: string;
}

export interface DedupClientiAutoPlan {
  merges: DedupClienteMerge[];
  sospetti: number;
  protetti: number;
}

/** Normalizza il numero di telefono rimuovendo spazi, prefissi e caratteri non numerici */
export function pulisciTelefono(t: string): string {
  let s = t.trim().replace(/\D/g, ""); // tiene solo i numeri
  if (s.startsWith("39") && s.length > 9) {
    s = s.slice(2);
  }
  if (s.startsWith("0039") && s.length > 11) {
    s = s.slice(4);
  }
  return s;
}

function pulisciEmail(s: string): string {
  return s.trim().toLowerCase();
}

function contieneOContenuto(a: string, b: string): boolean {
  return !!a && !!b && (a.includes(b) || b.includes(a));
}

function cfValido(s: string): boolean {
  return s.trim().toUpperCase().length === 16;
}

function stessoLuogo(a: ExtractedClient, b: ExtractedClient): boolean {
  const aCap = pulisciCap(a.cap);
  const bCap = pulisciCap(b.cap);
  const aCitta = testoConfronto(a.citta);
  const bCitta = testoConfronto(b.citta);
  const aProv = testoConfronto(a.prov);
  const bProv = testoConfronto(b.prov);

  if (aCap && bCap && aCap !== bCap) return false;
  if (aCitta && bCitta && aCitta !== bCitta) return false;
  if (aProv && bProv && aProv !== bProv) return false;
  return !!(aCap || bCap || aCitta || bCitta || aProv || bProv);
}

function indirizzoCompatibile(a: string, b: string): boolean {
  return indirizzoStrutturatoCompatibile(a, b);
}

export function scegliPiuCompleto(a: string, b: string): string {
  const A = a.trim();
  const B = b.trim();
  if (!A) return B;
  if (!B) return A;
  const aNorm = testoConfronto(A);
  const bNorm = testoConfronto(B);
  if (contieneOContenuto(aNorm, bNorm) || indirizzoCompatibile(A, B)) return B.length >= A.length ? B : A;
  return B;
}

function valoreStringa(r: RecordDto, campo: string): string {
  return String(r.data[campo] ?? "").trim();
}

function estrattoDaRecord(r: RecordDto): ExtractedClient {
  return {
    nome: valoreStringa(r, "nome"),
    indirizzo: valoreStringa(r, "indirizzo"),
    citta: valoreStringa(r, "citta"),
    prov: valoreStringa(r, "prov"),
    cap: valoreStringa(r, "cap"),
    regione: valoreStringa(r, "regione"),
    telefono: valoreStringa(r, "telefono"),
    email: valoreStringa(r, "email"),
    cf: valoreStringa(r, "cf"),
    note_spedizione: valoreStringa(r, "note_spedizione"),
  };
}

function distanzaUno(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 7) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && ++diff > 1) return false;
  }
  return diff === 1;
}

export function telefonoCompatibile(a: string, b: string): boolean {
  const A = pulisciTelefono(a);
  const B = pulisciTelefono(b);
  if (!A || !B) return false;
  if (A === B) return true;
  if (A.length >= 7 && B.length >= 7 && (A.includes(B) || B.includes(A))) return true;
  return distanzaUno(A, B);
}

function luogoCompatibileRecord(a: RecordDto, b: RecordDto): boolean {
  return stessoLuogo(estrattoDaRecord(a), estrattoDaRecord(b));
}

/** Costruisce i dati per il confronto strutturato da un ExtractedClient. */
function datiIndirizzoDaEstratto(e: ExtractedClient): DatiIndirizzoConfronto {
  return { indirizzo: e.indirizzo, cap: e.cap, citta: e.citta, prov: e.prov };
}

function stessoClienteAuto(a: RecordDto, b: RecordDto): string | null {
  const A = estrattoDaRecord(a);
  const B = estrattoDaRecord(b);
  const cfA = A.cf.trim().toUpperCase();
  const cfB = B.cf.trim().toUpperCase();
  if (cfValido(cfA) && cfValido(cfB) && cfA !== cfB) return null;
  if (cfValido(cfA) && cfA === cfB) return "cf";

  const nomeA = normalizzaNome(A.nome);
  const nomeB = normalizzaNome(B.nome);
  if (!nomeA || nomeA !== nomeB) return null;

  const emailA = pulisciEmail(A.email);
  const emailB = pulisciEmail(B.email);
  if (emailA && emailA === emailB) return "email";

  // Confronto strutturato completo (include civico rigoroso, odonomastico, cap, città)
  const indirizzoOk = sonoIndirizziCompatibili(datiIndirizzoDaEstratto(A), datiIndirizzoDaEstratto(B));
  const stessoLuogoOk = luogoCompatibileRecord(a, b);
  const telefonoOk = telefonoCompatibile(A.telefono, B.telefono);
  const cfParziale = cfValido(cfA) !== cfValido(cfB);

  if (indirizzoOk) return telefonoOk ? "telefono+indirizzo" : "indirizzo";
  if (telefonoOk && (stessoLuogoOk || indirizzoOk)) return "telefono";
  if (cfParziale && (indirizzoOk || telefonoOk)) return "cf-parziale";
  return null;
}

function contaRiferimentiCliente(ordini: RecordDto[], altriRecord: RecordDto[] = []): Map<string, number> {
  const out = new Map<string, number>();
  for (const ordine of ordini) {
    const id = String(ordine.data.cliente_id ?? "");
    if (id) out.set(id, (out.get(id) ?? 0) + 1);
  }
  for (const rec of altriRecord) {
    for (const [campo, value] of Object.entries(rec.data)) {
      if (!campo.toLowerCase().includes("cliente")) continue;
      const ids = Array.isArray(value) ? value : [value];
      for (const raw of ids) {
        const id = String(raw ?? "");
        if (id) out.set(id, (out.get(id) ?? 0) + 1);
      }
    }
  }
  return out;
}

function completezzaCliente(r: RecordDto): number {
  return ["nome", "indirizzo", "citta", "prov", "cap", "regione", "telefono", "email", "cf", "note_spedizione"]
    .filter((campo) => valoreStringa(r, campo)).length;
}

function scegliCanonico(cluster: RecordDto[], riferimenti: Map<string, number>): RecordDto {
  return [...cluster].sort((a, b) => {
    const cfDiff = Number(cfValido(valoreStringa(b, "cf"))) - Number(cfValido(valoreStringa(a, "cf")));
    if (cfDiff) return cfDiff;
    const refDiff = (riferimenti.get(b.id) ?? 0) - (riferimenti.get(a.id) ?? 0);
    if (refDiff) return refDiff;
    const fullDiff = completezzaCliente(b) - completezzaCliente(a);
    if (fullDiff) return fullDiff;
    return a.id.localeCompare(b.id);
  })[0];
}

function patchMergeClienti(canonico: RecordDto, duplicati: RecordDto[]): Campi {
  const patch: Campi = {};
  const base = { ...canonico.data };

  function current(campo: string): string {
    return String((patch[campo] ?? base[campo] ?? "") as string).trim();
  }

  function setIfChanged(campo: string, value: string) {
    const pulito = value.trim();
    if (pulito && pulito !== current(campo)) patch[campo] = pulito;
  }

  for (const dup of duplicati) {
    const d = estrattoDaRecord(dup);
    const candidato = {
      nome: d.nome,
      indirizzo: d.indirizzo,
      citta: d.citta,
      prov: d.prov,
      cap: pulisciCap(d.cap),
      regione: d.regione,
      telefono: d.telefono,
      email: d.email,
      cf: d.cf.trim().toUpperCase(),
      note_spedizione: d.note_spedizione,
    };

    for (const [campo, value] of Object.entries(candidato)) {
      if (!current(campo)) setIfChanged(campo, value);
    }

    if (!cfValido(current("cf")) && cfValido(candidato.cf)) {
      setIfChanged("cf", candidato.cf);
    }
    if (indirizzoStrutturatoCompatibile(current("indirizzo"), candidato.indirizzo)) {
      setIfChanged("indirizzo", scegliPiuCompleto(current("indirizzo"), candidato.indirizzo));
    }
    if (current("telefono") && candidato.telefono && pulisciTelefono(candidato.telefono).length > pulisciTelefono(current("telefono")).length) {
      if (telefonoCompatibile(current("telefono"), candidato.telefono)) {
        setIfChanged("telefono", candidato.telefono);
      }
    }
  }

  return patch;
}

/** Normalizza il nome rimuovendo accenti, titoli e ordinando le parole alfabeticamente */
export function normalizzaNome(n: string): string {
  let s = n.trim().toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // rimuove accenti

  // Rimuove titoli professionali all'inizio o isolati
  s = s.replace(/\b(DR|DR\.SSA|DOTT|DOTT\.SSA|SIG|SIG\.RA|SIG\.R|SIG\.R\.A)\b/g, "");

  // Estrae le parole, le pulisce e le ordina
  return s.split(/\s+/)
    .map(w => w.trim())
    .filter(Boolean)
    .sort()
    .join(" ");
}


/** Determina se una riga estratta dagli Excel deve essere scartata preventivamente */
export function rigaDaScartare(c: { nome: string; telefono: string; indirizzo: string; email: string }): boolean {
  const name = c.nome.trim().toUpperCase();
  const tel = c.telefono.trim();
  const ind = c.indirizzo.trim();
  const email = c.email.trim();

  // Nome troppo corto
  if (name.length <= 3) return true;

  // Nessun contatto o indirizzo (categoria vuoti)
  if (!tel && !ind && !email) return true;

  // Parole di test o annullamento
  const paroleJunk = ["TEST", "PROVA", "ANNULLATO", "DA SPEDIRE", "DA RITIRARE", "DA CONSEGNARE", "FUSTINO", "INTEGRATORI", "INTEGRATORE", "SPEDIZIONE"];
  if (paroleJunk.some(w => name.includes(w))) return true;

  // Note commerciali (es. "1 KERIBA", "2 SCATOLA DI...")
  if (/^\d+\s+(KERIBA|SCATOLA|SCAT|FLACONE|FLAC|PZ|PEZZI)/.test(name)) return true;
  if (name.includes("PAZIENTE NUOVO") || name.includes("SCATOLA DI") || name.includes("SCATOLA KERIBA")) return true;

  return false;
}

/** Unisce due record duplicati tenendo il dato più recente (B) e arricchendolo con A */
export function unisciClienti(A: ExtractedClient, B: ExtractedClient): ExtractedClient {
  return {
    nome: B.nome.trim() || A.nome.trim(),
    indirizzo: scegliPiuCompleto(A.indirizzo, B.indirizzo),
    citta: scegliPiuCompleto(A.citta, B.citta),
    prov: B.prov.trim() || A.prov.trim(),
    cap: pulisciCap(B.cap) || pulisciCap(A.cap),
    regione: scegliPiuCompleto(A.regione, B.regione),
    telefono: B.telefono.trim() || A.telefono.trim(),
    email: B.email.trim() || A.email.trim(),
    cf: B.cf.trim() || A.cf.trim(),
    note_spedizione: scegliPiuCompleto(A.note_spedizione, B.note_spedizione),
  };
}

function stessoClienteEstratto(a: ExtractedClient, b: ExtractedClient): boolean {
  const aCF = a.cf.trim().toUpperCase();
  const bCF = b.cf.trim().toUpperCase();
  if (aCF && bCF && aCF.length === 16 && aCF === bCF) return true;
  if (aCF && bCF && aCF.length === 16 && bCF.length === 16 && aCF !== bCF) return false;

  const aNome = normalizzaNome(a.nome);
  const bNome = normalizzaNome(b.nome);
  const aTel = pulisciTelefono(a.telefono);
  const bTel = pulisciTelefono(b.telefono);
  const aEmail = pulisciEmail(a.email);
  const bEmail = pulisciEmail(b.email);

  if (aNome && aNome === bNome) {
    if (aTel && bTel && aTel === bTel) return true;
    if (aEmail && bEmail && aEmail === bEmail) return true;
    if (aTel && bTel && aTel !== bTel) return false;

    const aInd = normalizzaIndirizzo(a.indirizzo);
    const bInd = normalizzaIndirizzo(b.indirizzo);
    if (aInd && bInd && !indirizzoCompatibile(a.indirizzo, b.indirizzo)) {
      return stessoLuogo(a, b);
    }

    const aCap = pulisciCap(a.cap);
    const bCap = pulisciCap(b.cap);
    if (!aInd && !bInd && aCap && bCap && aCap !== bCap) return false;

    const aCitta = testoConfronto(a.citta);
    const bCitta = testoConfronto(b.citta);
    if (!aInd && !bInd && aCitta && bCitta && aCitta !== bCitta) return false;

    const aProv = testoConfronto(a.prov);
    const bProv = testoConfronto(b.prov);
    if (!aInd && !bInd && aProv && bProv && aProv !== bProv) return false;

    return true;
  }

  if (aTel && bTel && aTel === bTel) {
    const aWords = aNome.split(" ");
    const bWords = bNome.split(" ");
    return aWords.some((w) => w.length > 3 && bWords.includes(w));
  }

  return false;
}

function aggiungiIndiceSet(mappa: Map<string, Set<number>>, chiave: string, idx: number) {
  if (!chiave) return;
  let set = mappa.get(chiave);
  if (!set) {
    set = new Set<number>();
    mappa.set(chiave, set);
  }
  set.add(idx);
}

function aggiungiIndiceLista(mappa: Map<string, RecordDto[]>, chiave: string, rec: RecordDto) {
  if (!chiave) return;
  const lista = mappa.get(chiave);
  if (lista) lista.push(rec);
  else mappa.set(chiave, [rec]);
}

export function creaIndiceBatchEstratti(): IndiceBatchEstratti {
  return {
    perCf: new Map(),
    perNome: new Map(),
    perTelefono: new Map(),
    perEmail: new Map(),
  };
}

export function indicizzaBatchEstratto(indice: IndiceBatchEstratti, cliente: ExtractedClient, idx: number) {
  const cf = cliente.cf.trim().toUpperCase();
  if (cf.length === 16) aggiungiIndiceSet(indice.perCf, cf, idx);
  aggiungiIndiceSet(indice.perNome, normalizzaNome(cliente.nome), idx);
  aggiungiIndiceSet(indice.perTelefono, pulisciTelefono(cliente.telefono), idx);
  aggiungiIndiceSet(indice.perEmail, pulisciEmail(cliente.email), idx);
}

export function trovaDuplicatoBatch(
  candidato: ExtractedClient,
  batch: ExtractedClient[],
): number {
  return batch.findIndex((esistente) => stessoClienteEstratto(candidato, esistente));
}

export function trovaDuplicatoBatchIndicizzato(
  candidato: ExtractedClient,
  batch: ExtractedClient[],
  indice: IndiceBatchEstratti,
): number {
  const candidati = new Set<number>();
  const cf = candidato.cf.trim().toUpperCase();
  if (cf.length === 16) {
    for (const idx of indice.perCf.get(cf) ?? []) candidati.add(idx);
  }
  for (const idx of indice.perNome.get(normalizzaNome(candidato.nome)) ?? []) candidati.add(idx);
  for (const idx of indice.perTelefono.get(pulisciTelefono(candidato.telefono)) ?? []) candidati.add(idx);
  for (const idx of indice.perEmail.get(pulisciEmail(candidato.email)) ?? []) candidati.add(idx);

  for (const idx of candidati) {
    const esistente = batch[idx];
    if (esistente && stessoClienteEstratto(candidato, esistente)) return idx;
  }
  return -1;
}

export function creaIndiceClientiEsistenti(dbClients: RecordDto[]): IndiceClientiEsistenti {
  const indice: IndiceClientiEsistenti = {
    perCf: new Map(),
    perNome: new Map(),
    perTelefono: new Map(),
    perEmail: new Map(),
  };

  for (const db of dbClients) {
    const cf = String(db.data.cf ?? "").trim().toUpperCase();
    if (cf.length === 16) indice.perCf.set(cf, db);
    aggiungiIndiceLista(indice.perNome, normalizzaNome(String(db.data.nome ?? "")), db);
    aggiungiIndiceLista(indice.perTelefono, pulisciTelefono(String(db.data.telefono ?? "")), db);
    aggiungiIndiceLista(indice.perEmail, pulisciEmail(String(db.data.email ?? "")), db);
  }

  return indice;
}

/** Trova una corrispondenza tra un cliente estratto e quelli esistenti nel DB */
export function trovaCorrispondenzaIndicizzata(
  ext: ExtractedClient,
  indice: IndiceClientiEsistenti,
): RecordDto | null {
  const extCF = ext.cf.trim().toUpperCase();
  const extNomeNorm = normalizzaNome(ext.nome);
  const extTelClean = pulisciTelefono(ext.telefono);
  const extEmailClean = pulisciEmail(ext.email);

  // 1. Confronto per Codice Fiscale (se valido e presente)
  if (extCF && extCF.length === 16) {
    const match = indice.perCf.get(extCF);
    if (match) return match;
  }

  // 2. Confronto per Nome Normalizzato
  if (extNomeNorm) {
    for (const db of indice.perNome.get(extNomeNorm) ?? []) {
      // Controlla conflitti su telefono o indirizzo per escludere omonimi
      const dbTelClean = pulisciTelefono((db.data.telefono as string) || "");
      const dbEmailClean = pulisciEmail((db.data.email as string) || "");
      const dbIndClean = normalizzaIndirizzo((db.data.indirizzo as string) || "");
      const extIndClean = normalizzaIndirizzo(ext.indirizzo);
      const dbCapClean = pulisciCap((db.data.cap as string) || "");
      const extCapClean = pulisciCap(ext.cap);
      const dbCittaClean = testoConfronto((db.data.citta as string) || "");
      const extCittaClean = testoConfronto(ext.citta);
      const dbProvClean = testoConfronto((db.data.prov as string) || "");
      const extProvClean = testoConfronto(ext.prov);

      if (dbTelClean && extTelClean && dbTelClean === extTelClean) {
        return db;
      }
      if (dbEmailClean && extEmailClean && dbEmailClean === extEmailClean) {
        return db;
      }

      // Se hanno telefoni diversi attivi senza altre prove forti, sono probabilmente omonimi diversi
      if (dbTelClean && extTelClean && dbTelClean !== extTelClean) {
        continue;
      }
      // Se hanno indirizzi diversi e strutturati, sono omonimi diversi solo quando
      // anche il luogo diverge. Civici diversi sulla stessa strada indicano spesso
      // un dato storico aggiornato, non una nuova anagrafica.
      if (
        dbIndClean &&
        extIndClean &&
        !indirizzoCompatibile(String(db.data.indirizzo ?? ""), ext.indirizzo) &&
        !stessoLuogo(
          {
            ...ext,
            indirizzo: String(db.data.indirizzo ?? ""),
            citta: String(db.data.citta ?? ""),
            prov: String(db.data.prov ?? ""),
            cap: String(db.data.cap ?? ""),
          },
          ext
        )
      ) {
        continue;
      }
      if (!dbIndClean && !extIndClean && dbCapClean && extCapClean && dbCapClean !== extCapClean) {
        continue;
      }
      if (!dbIndClean && !extIndClean && dbCittaClean && extCittaClean && dbCittaClean !== extCittaClean) {
        continue;
      }
      if (!dbIndClean && !extIndClean && dbProvClean && extProvClean && dbProvClean !== extProvClean) {
        continue;
      }

      return db;
    }
  }

  // 3. Confronto per Telefono (se il nome ha parole in comune significnative)
  if (extTelClean) {
    for (const db of indice.perTelefono.get(extTelClean) ?? []) {
      const dbNomeNorm = normalizzaNome((db.data.nome as string) || "");
      const dbWords = dbNomeNorm.split(" ");
      const extWords = extNomeNorm.split(" ");
      // Devono condividere almeno una parola significativa (> 3 lettere)
      const condividonoParola = dbWords.some(w => w.length > 3 && extWords.includes(w));
      if (condividonoParola) {
        return db;
      }
    }
  }

  if (extEmailClean) {
    for (const db of indice.perEmail.get(extEmailClean) ?? []) {
      const dbNomeNorm = normalizzaNome((db.data.nome as string) || "");
      if (dbNomeNorm && dbNomeNorm === extNomeNorm) return db;
    }
  }

  return null;
}

export function trovaCorrispondenza(
  ext: ExtractedClient,
  dbClients: RecordDto[]
): RecordDto | null {
  return trovaCorrispondenzaIndicizzata(ext, creaIndiceClientiEsistenti(dbClients));
}

export function pianificaDedupClientiAuto(
  dbClients: RecordDto[],
  ordini: RecordDto[],
  altriRecordCollegati: RecordDto[] = [],
): DedupClientiAutoPlan {
  const gruppi = new Map<string, RecordDto[]>();
  for (const cliente of dbClients) {
    if (cliente.deleted) continue;
    const nome = normalizzaNome(String(cliente.data.nome ?? ""));
    if (!nome) continue;
    const lista = gruppi.get(nome);
    if (lista) lista.push(cliente);
    else gruppi.set(nome, [cliente]);
  }

  const riferimenti = contaRiferimentiCliente(ordini, altriRecordCollegati);
  const merges: DedupClienteMerge[] = [];
  let sospetti = 0;
  const protetti = 0;

  for (const gruppo of gruppi.values()) {
    if (gruppo.length < 2) continue;

    const parent = gruppo.map((_, i) => i);
    const motivi = new Map<string, string>();
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a: number, b: number, motivo: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) return;
      parent[rb] = ra;
      motivi.set(`${Math.min(a, b)}:${Math.max(a, b)}`, motivo);
    };

    for (let i = 0; i < gruppo.length; i++) {
      for (let j = i + 1; j < gruppo.length; j++) {
        const motivo = stessoClienteAuto(gruppo[i], gruppo[j]);
        if (motivo) union(i, j, motivo);
      }
    }

    const cluster = new Map<number, RecordDto[]>();
    for (let i = 0; i < gruppo.length; i++) {
      const root = find(i);
      const lista = cluster.get(root);
      if (lista) lista.push(gruppo[i]);
      else cluster.set(root, [gruppo[i]]);
    }

    let haMerge = false;
    for (const membri of cluster.values()) {
      if (membri.length < 2) continue;
      haMerge = true;
      const canonico = scegliCanonico(membri, riferimenti);
      const duplicati = membri.filter((m) => m.id !== canonico.id);
      merges.push({
        canonico,
        duplicati,
        fields: patchMergeClienti(canonico, duplicati),
        motivo: [...motivi.values()][0] ?? "somiglianza-forte",
      });
    }
    if (!haMerge) sospetti++;
  }

  return { merges, sospetti, protetti };
}

/** Prepara un update che completa solo i campi attualmente vuoti del record esistente. */
export function campiVuotiDaCompletare(db: RecordDto, candidato: Campi): Campi {
  const patch: Campi = {};
  for (const [campo, valore] of Object.entries(candidato)) {
    const nuovo = typeof valore === "string" ? valore.trim() : valore;
    if (nuovo === "" || nuovo === null || nuovo === undefined) continue;

    const attualeRaw = db.data[campo];
    const attuale = typeof attualeRaw === "string" ? attualeRaw.trim() : attualeRaw;
    if (attuale === "" || attuale === null || attuale === undefined) {
      patch[campo] = nuovo;
    }
  }
  return patch;
}

/** Compatibilità per gli export: usa il riconoscitore condiviso dei form/import. */
export function dividiNomeCognome(nomeCompleto: string): { nome: string; cognome: string } {
  return dividiNomeCognomeIntelligente(nomeCompleto);
}
