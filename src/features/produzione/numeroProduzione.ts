// Seme del «N° di produzione iniziale» Laboratorio (FASE 5/6). Prima era una preferenza
// per-PC in localStorage: due PC potevano partire da numeri diversi alla prima
// assegnazione. Ora vive nel **modello dati condiviso**, come singoletto
// `impostazioni/__app__` (id fisso e deterministico → conflict-free fra dispositivi),
// così tutti i PC concordano. Il numero effettivo resta comunque derivato dai dati
// (`max(numero_produzione esistenti) + 1`); questo è solo il punto di partenza.
import { api } from "../../lib/tauri";

const ENTITA = "impostazioni";
const ID = "__app__";
const CAMPO = "numero_produzione_base";

/** Legge il seme condiviso (default 1). Migra una volta l'eventuale valore legacy
 *  in localStorage se il record condiviso non esiste ancora. */
export async function leggiBaseProduzione(): Promise<number> {
  try {
    const rec = await api.recordGet(ENTITA, ID);
    const v = rec?.data?.[CAMPO];
    if (typeof v === "number" && v >= 1) return Math.round(v);
    // Migrazione leggera dal vecchio valore per-PC (una sola volta).
    const legacy = leggiLegacy();
    if (legacy > 1) {
      await salvaBaseProduzione(legacy);
      return legacy;
    }
  } catch {
    /* offline o non disponibile: ricade sul default */
  }
  return 1;
}

/** Salva il seme condiviso (upsert idempotente sul singoletto). */
export async function salvaBaseProduzione(n: number): Promise<void> {
  const val = Math.max(1, Math.round(n || 1));
  await api.recordCreateId(ENTITA, ID, { [CAMPO]: val });
}

function leggiLegacy(): number {
  try {
    const raw = localStorage.getItem("pt.numeroProduzioneBase");
    if (raw) {
      const n = Number(JSON.parse(raw));
      if (Number.isFinite(n) && n >= 1) return Math.round(n);
    }
  } catch {
    /* ignora */
  }
  return 1;
}
