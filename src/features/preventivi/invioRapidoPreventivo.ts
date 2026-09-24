import {
  api,
  type AllegatoComunicazioneInput,
  type CanaleComunicazione,
  type Comunicazione,
  type ComunicazioneCreaInput,
  type ModelloComunicazione,
  type Preventivo,
} from "../../lib/tauri";
import { centsToEurStr } from "../../lib/money";
import { creaIdCasuale } from "../../lib/idCasuale";
import { formattaDataLocale } from "../../lib/date";
import { toast } from "../../ui/toast/store";
import {
  emailComunicazioneValida,
  telefonoWhatsappValido,
} from "../comunicazioni/recapiti";
import { risolviModello } from "../comunicazioni/modelliComunicazione";
import { variabiliNomeDestinatario } from "../comunicazioni/apriComunicazione";
import {
  preparaAllegatiPreventivo,
  rilasciaAllegatiPreventivo,
  type AllegatiPreventivoPerCanale,
} from "./allegatiPreventivo";

export interface DestinatarioPreventivo {
  destinatarioEntita: "cliente" | "medico";
  destinatarioId: string;
  destinatarioNome: string;
}

export interface EsitoInvioRapidoPreventivo {
  canali: CanaleComunicazione[];
  comunicazioni: Comunicazione[];
}

export interface DipendenzeInvioRapidoPreventivo {
  listaModelli: () => Promise<ModelloComunicazione[]>;
  preparaAllegati: (
    preventivo: Preventivo,
    canali: readonly CanaleComunicazione[],
  ) => Promise<AllegatiPreventivoPerCanale>;
  rilasciaAllegati?: (allegati: AllegatiPreventivoPerCanale) => Promise<void>;
  creaBozza: (input: ComunicazioneCreaInput) => Promise<Comunicazione>;
  mettiInCoda: (id: string) => Promise<Comunicazione>;
  creaChiaveIntento: () => string;
}

const dipendenzeDefault: DipendenzeInvioRapidoPreventivo = {
  listaModelli: () => api.modelliComunicazioneLista(),
  preparaAllegati: preparaAllegatiPreventivo,
  rilasciaAllegati: rilasciaAllegatiPreventivo,
  creaBozza: (input) => api.comunicazioneCreaBozza(input),
  mettiInCoda: (id) => api.comunicazioneMettiInCoda(id),
  creaChiaveIntento: () => `preventivo-rapido:${creaIdCasuale()}`,
};

const inviiInCorso = new Set<string>();

export function destinatarioPreventivo(
  preventivo: Preventivo,
): DestinatarioPreventivo {
  const medico =
    !!preventivo.medicoId &&
    (!preventivo.clienteId || preventivo.linee.includes("Diagnostica"));
  return {
    destinatarioEntita: medico ? "medico" : "cliente",
    destinatarioId: medico ? preventivo.medicoId : preventivo.clienteId,
    destinatarioNome: medico ? preventivo.medicoNome : preventivo.clienteNome,
  };
}

export function variabiliPreventivo(
  preventivo: Preventivo,
): Record<string, string> {
  const destinatario = destinatarioPreventivo(preventivo);
  return {
    ...variabiliNomeDestinatario(destinatario.destinatarioNome),
    numero_preventivo: preventivo.numeroPreventivo,
    data_preventivo: preventivo.creatoMs
      ? formattaDataLocale(preventivo.creatoMs)
      : "",
    totale_preventivo: `€ ${centsToEurStr(preventivo.totale)}`,
    riferimento_ordine: `ordine ${preventivo.ordineNumero}`,
    nome_medico: preventivo.medicoNome,
    nome_agente: preventivo.agenteNome,
  };
}

function canaliDisponibiliPreventivo(
  preventivo: Preventivo,
): CanaleComunicazione[] {
  return [
    ...(emailComunicazioneValida(preventivo.email) ? (["email"] as const) : []),
    ...(telefonoWhatsappValido(preventivo.telefono)
      ? (["whatsapp"] as const)
      : []),
  ];
}

function modelloInvioPreventivo(
  modelli: ModelloComunicazione[],
): ModelloComunicazione {
  const disponibili = modelli.filter(
    (modello) => modello.attivo && modello.tipo === "preventivo",
  );
  const modello =
    disponibili.find((item) => item.predefinito) ?? disponibili[0];
  if (!modello) {
    throw new Error(
      "non è disponibile alcun modello attivo per l’invio del preventivo",
    );
  }
  return modello;
}

function allegatiCanale(
  allegati: AllegatiPreventivoPerCanale,
  canale: CanaleComunicazione,
): AllegatoComunicazioneInput[] {
  return allegati[canale] ?? [];
}

export async function inviaPreventivoRapido(
  preventivo: Preventivo,
  dipendenze: DipendenzeInvioRapidoPreventivo = dipendenzeDefault,
): Promise<EsitoInvioRapidoPreventivo> {
  const destinatario = destinatarioPreventivo(preventivo);
  if (!destinatario.destinatarioId || !destinatario.destinatarioNome) {
    throw new Error("il preventivo non ha un destinatario valido");
  }

  const canali = canaliDisponibiliPreventivo(preventivo);
  if (!canali.length) {
    throw new Error(
      "il destinatario non ha un indirizzo e-mail o un numero WhatsApp valido",
    );
  }

  const [esitoModelli, esitoAllegati] = await Promise.allSettled([
    dipendenze.listaModelli(),
    dipendenze.preparaAllegati(preventivo, canali),
  ]);
  if (esitoAllegati.status === "rejected") throw esitoAllegati.reason;
  const allegati = esitoAllegati.value;
  if (esitoModelli.status === "rejected") {
    await dipendenze.rilasciaAllegati?.(allegati);
    throw esitoModelli.reason;
  }

  try {
    const modello = modelloInvioPreventivo(esitoModelli.value);
    const variabili = variabiliPreventivo(preventivo);
    const oggetto = risolviModello(modello.oggetto, variabili);
    const corpo = risolviModello(modello.corpo, variabili);
    const mancanti = new Set([
      ...corpo.mancanti,
      ...(canali.includes("email") ? oggetto.mancanti : []),
    ]);
    if (mancanti.size) {
      throw new Error(
        `nel modello mancano i dati: ${[...mancanti].join(", ")}`,
      );
    }

    const intento = dipendenze.creaChiaveIntento();
    const comunicazioni: Comunicazione[] = [];
    for (const canale of canali) {
      comunicazioni.push(
        await dipendenze.creaBozza({
          idempotencyKey: `${intento}:${canale}`,
          destinatarioEntita: destinatario.destinatarioEntita,
          destinatarioId: destinatario.destinatarioId,
          canale,
          recapito:
            canale === "email"
              ? preventivo.email.trim()
              : preventivo.telefono.trim(),
          oggetto: canale === "email" ? oggetto.testo.trim() : "",
          corpo: corpo.testo.trim(),
          modelloId: modello.id,
          modelloVersioneId: modello.versioneId,
          modelloVersione: modello.versione,
          origineEntita: "preventivo",
          origineId: preventivo.id,
          origineRevision: preventivo.revision,
          origineFingerprint: preventivo.fingerprintCorrente,
          origineSnapshot: preventivo,
          tipoModello: "preventivo",
          allegati: allegatiCanale(allegati, canale),
          campagnaId: canali.length > 1 ? intento : "",
        }),
      );
    }

    for (const comunicazione of comunicazioni) {
      if (
        comunicazione.stato === "bozza" ||
        comunicazione.stato === "da_revisionare"
      ) {
        await dipendenze.mettiInCoda(comunicazione.id);
      }
    }
    return { canali, comunicazioni };
  } finally {
    await dipendenze.rilasciaAllegati?.(allegati);
  }
}

export async function avviaInvioRapidoPreventivo(
  preventivo: Preventivo,
  dipendenze: DipendenzeInvioRapidoPreventivo = dipendenzeDefault,
): Promise<boolean> {
  if (inviiInCorso.has(preventivo.id)) return false;
  inviiInCorso.add(preventivo.id);
  try {
    const esito = await inviaPreventivoRapido(preventivo, dipendenze);
    toast.success(
      esito.canali.length === 1
        ? "Invio preventivo avviato."
        : `${esito.canali.length} invii del preventivo avviati in sequenza.`,
    );
    return true;
  } catch (error) {
    const messaggio = error instanceof Error ? error.message : String(error);
    toast.error(`Invio preventivo non riuscito: ${messaggio}`);
    return false;
  } finally {
    inviiInCorso.delete(preventivo.id);
  }
}
