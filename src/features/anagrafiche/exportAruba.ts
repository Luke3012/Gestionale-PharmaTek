import type { RecordDto } from "../../lib/tauri";
import { calcolaCodiceFiscale } from "../../lib/codice-fiscale";
import { dividiNomeCognome } from "./deduplicazione";

export interface RigaAruba {
  id: string;
  nome: string;
  cognome: string;
  cf: string;
  telefono: string;
  email: string;
  indirizzo: string;
  civico: string;
  citta: string;
  prov: string;
  cap: string;
}

export interface PreparazioneAruba {
  righe: RigaAruba[];
  codiciProvvisoriGenerati: number;
}

export function filtraClientiAruba(clienti: RecordDto[], generaFake: boolean): RecordDto[] {
  return generaFake
    ? clienti
    : clienti.filter((cliente) => String(cliente.data.cf ?? "").trim().length > 0);
}

function normalizzaCfAruba(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/** Un marcatore arrivato tardi non vale se si riferisce a un CF diverso da quello
 * corrente. I marker legacy, privi dello snapshot CF, restano compatibili. */
export function clienteGiaEsportatoAruba(cliente: RecordDto): boolean {
  if (!cliente.data.aruba_esportato_il) return false;
  if (!("aruba_cf_esportato" in cliente.data)) return true;
  return normalizzaCfAruba(cliente.data.aruba_cf_esportato) === normalizzaCfAruba(cliente.data.cf);
}

/** La migrazione dal vecchio cutoff locale non deve assorbire clienti il cui CF è
 * stato inserito o cambiato dopo l'ultimo export. */
export function clienteDaMigrareArubaLegacy(cliente: RecordDto, ultimoIdLegacy: string): boolean {
  const cf = String(cliente.data.cf ?? "").trim();
  return (
    !!ultimoIdLegacy &&
    cliente.id <= ultimoIdLegacy &&
    !!cf &&
    !clienteGiaEsportatoAruba(cliente) &&
    !cliente.data.aruba_ricandidato_il
  );
}

function hashStabile(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Produce un CF formalmente valido ma chiaramente provvisorio. La stessa
 * anagrafica genera sempre lo stesso valore, anche tra anteprima e salvataggio.
 */
export function generaCodiceFiscaleProvvisorio(id: string, nomeCompleto: string): string {
  const { nome, cognome } = dividiNomeCognome(nomeCompleto);
  const seed = hashStabile(`${id}|${nomeCompleto.trim().toUpperCase()}`);
  const start = Date.UTC(1950, 0, 1);
  const giorni = 51 * 365 + 13;
  const dataNascita = new Date(start + (seed % giorni) * 86_400_000);
  const sesso = (seed & 1) === 0 ? "M" : "F";
  const risultato = calcolaCodiceFiscale({
    nome: nome || "MARIO",
    cognome: cognome || "ROSSI",
    dataNascita,
    sesso,
    comuneNascita: "roma",
  });

  if (!risultato?.cf) {
    throw new Error("Impossibile generare il codice fiscale provvisorio per Aruba.");
  }
  return risultato.cf;
}

export function splitIndirizzoCivico(indirizzo: string): { via: string; civico: string } {
  const s = indirizzo.trim();
  if (!s) return { via: "", civico: "" };

  const commaIdx = s.lastIndexOf(",");
  if (commaIdx !== -1) {
    const via = s.slice(0, commaIdx).trim();
    const civico = s.slice(commaIdx + 1).trim();
    if (/^\d+[a-zA-Z\/]?\w*$/.test(civico)) return { via, civico };
  }

  const match = s.match(/^(.+?)\s+(\d+[a-zA-Z]?)$/);
  if (match) return { via: match[1].trim(), civico: match[2] };
  return { via: s, civico: "" };
}

/** Aruba accetta un solo recapito. Nei dati storici il campo telefono può contenere
 * fisso e cellulare concatenati: se presente scegliamo sempre il mobile italiano. */
export function telefonoPreferitoAruba(value: unknown): string {
  const telefono = String(value ?? "").trim();
  if (!telefono) return "";

  // Nei file storici i recapiti distinti usano soprattutto " - " e " / ".
  // Richiedere gli spazi evita di scambiare per separatore il trattino interno
  // di un singolo numero (es. 055-123).
  const segmenti = telefono
    .split(/\s+(?:[-–—/]\s+)|[;|,\n]+/)
    .map((segmento) => segmento.trim())
    .filter(Boolean);
  const candidati = segmenti.flatMap((segmento) =>
    segmento.match(/(?:(?:\+|00)\s*\d{2}[\s.-]*)?\d(?:[\s.-]*\d){5,12}/g) ?? []
  ).map((numero) => numero.trim());

  const mobile = candidati.find((numero) => {
    let cifre = numero.replace(/\D/g, "");
    if (cifre.startsWith("0039")) cifre = cifre.slice(4);
    else if (cifre.startsWith("39") && cifre.length > 10) cifre = cifre.slice(2);
    return /^3\d{8,9}$/.test(cifre);
  });

  return mobile ?? candidati[0] ?? segmenti[0] ?? "";
}

export function preparaRigheAruba(clienti: RecordDto[]): PreparazioneAruba {
  let codiciProvvisoriGenerati = 0;
  const righe = clienti.map((cliente): RigaAruba => {
    const nomeCompleto = String(cliente.data.nome ?? "").trim();
    const cfReale = String(cliente.data.cf ?? "").trim().toUpperCase();
    const provvisorio = !cfReale;
    const { nome, cognome } = dividiNomeCognome(nomeCompleto);
    const { via, civico } = splitIndirizzoCivico(String(cliente.data.indirizzo ?? ""));

    if (provvisorio) codiciProvvisoriGenerati += 1;

    return {
      id: cliente.id,
      nome,
      cognome: `${cognome}${provvisorio ? " (FAKE)" : ""}`,
      cf: cfReale || generaCodiceFiscaleProvvisorio(cliente.id, nomeCompleto),
      telefono: telefonoPreferitoAruba(cliente.data.telefono),
      email: String(cliente.data.email ?? "").trim(),
      indirizzo: via,
      civico,
      citta: String(cliente.data.citta ?? "").trim(),
      prov: String(cliente.data.prov ?? cliente.data.provincia ?? "").trim(),
      cap: String(cliente.data.cap ?? "").trim(),
    };
  });

  return { righe, codiciProvvisoriGenerati };
}
