import { totaleRigheForm, type RigaForm } from "../giornaliero/righeOrdine";
import { oggiIso } from "../../lib/date";
import type { ConfigurazioneDocumenti, Preventivo, RecordDto } from "../../lib/tauri";

/** Dati mantenuti soltanto nel renderer finché l'utente non conferma
 *  "Salva e visualizza". Non corrispondono ancora a un ordine sincronizzato. */
export interface BozzaPreventivoDaZero {
  data: string;
  linea: string;
  clienteId: string;
  medicoId: string;
  agenteId: string;
  note: string;
  righe: RigaForm[];
}

function testoRecord(record: RecordDto | undefined, campo: string): string {
  return String(record?.data[campo] ?? "");
}

/** Crea lo snapshot locale mostrato dall'editor prima che ordine e preventivo esistano. */
export function preventivoDaBozza(
  bozza: BozzaPreventivoDaZero,
  configurazione: ConfigurazioneDocumenti,
  clienti: RecordDto[],
  medici: RecordDto[],
  agenti: RecordDto[],
): Preventivo {
  const cliente = clienti.find((record) => record.id === bozza.clienteId);
  const medico = medici.find((record) => record.id === bozza.medicoId);
  const agente = agenti.find((record) => record.id === bozza.agenteId);
  const destinatario = cliente ?? medico;
  const nomeDestinatario = testoRecord(destinatario, "nome");
  const indirizzo = testoRecord(destinatario, "indirizzo");
  const citta = testoRecord(destinatario, "citta");
  const cap = testoRecord(destinatario, "cap");
  const prov = testoRecord(destinatario, "prov");
  const codiceFiscale = testoRecord(destinatario, "cf");
  const telefono = testoRecord(destinatario, "telefono");
  const email = testoRecord(destinatario, "email");
  const totale = totaleRigheForm(bozza.righe);

  return {
    id: "",
    revision: "",
    esiste: false,
    preventivoNelCestino: false,
    ordineId: "",
    ordineAttivo: true,
    ordineRevision: "",
    ordineNumero: "",
    ordineData: bozza.data || oggiIso(),
    creatoMs: 0,
    ordineStato: "Nuovo",
    linee: [bozza.linea],
    clienteId: bozza.clienteId,
    clienteNome: testoRecord(cliente, "nome"),
    clienteIndirizzo: testoRecord(cliente, "indirizzo"),
    clienteCitta: testoRecord(cliente, "citta"),
    clienteCap: testoRecord(cliente, "cap"),
    clienteProv: testoRecord(cliente, "prov"),
    spedizioneNome: nomeDestinatario,
    spedizioneIndirizzo: indirizzo,
    spedizioneCitta: citta,
    spedizioneCap: cap,
    spedizioneProv: prov,
    spedizioneEmail: email,
    spedizioneTelefono: telefono,
    spedizioneNote: testoRecord(destinatario, "note_spedizione"),
    spedizioneCodiceFiscale: codiceFiscale,
    fatturazioneNome: nomeDestinatario,
    fatturazioneIndirizzo: indirizzo,
    fatturazioneCitta: citta,
    fatturazioneCap: cap,
    fatturazioneProv: prov,
    fatturazionePiva: testoRecord(destinatario, "piva"),
    fatturazioneCodiceFiscale: codiceFiscale,
    fatturazioneDiversa: false,
    medicoId: bozza.medicoId,
    medicoNome: testoRecord(medico, "nome"),
    agenteId: bozza.agenteId,
    agenteNome: testoRecord(agente, "nome"),
    email,
    telefono,
    numeroPreventivo: "",
    validitaGiorni: configurazione.validitaDefaultGiorni,
    condizioniPagamento: "",
    introduzione: "Come da accordi, riportiamo di seguito la nostra proposta.",
    note: bozza.note,
    scontoPercentuale: 0,
    acconto: 0,
    totale,
    fingerprintCorrente: "",
    ultimaModificaMs: 0,
    ultimaModificaUtente: "",
    ultimaModificaDispositivo: "",
    ultimoInvioMs: 0,
    ultimoInvioCanale: "",
    ultimoInvioFingerprint: "",
    ultimoInvioComunicazioneId: "",
    ultimoSollecitoMs: 0,
    indicazioneInvio: "mai_inviato",
    versioneModello: configurazione.versioneModello,
    righe: bozza.righe.map((riga) => ({
      id: riga.key,
      revision: "",
      prodottoId: riga.prodottoId,
      prodottoNome: riga.prodottoNome,
      categoria: bozza.linea,
      qta: riga.qta,
      prezzo: riga.prezzo === "" ? 0 : Math.round(Number(riga.prezzo) * 100),
      paziente: riga.paziente,
      tipoTest: riga.tipoTest,
      ml: riga.ml,
      codice: riga.codice,
      formulazione: riga.formulazione,
      posologia: riga.posologia,
      numero: riga.numero,
      allergeni: riga.allergeni,
    })),
    pagamenti: [],
    utilizziProdotti: [],
  };
}
