export type AvatarTipo = "preset" | "custom" | "iniziali";

export interface UserDto {
  id: string;
  nome: string;
  avatarTipo: AvatarTipo;
  avatarValore: string;
}

export interface Identity {
  userId: string;
  nome: string;
  avatarTipo: AvatarTipo;
  avatarValore: string;
  deviceId: string;
  deviceNome: string;
  dataDir: string;
}

export interface Bootstrap {
  onboarded: boolean;
  deviceId: string;
  deviceNome: string;
  dataDir: string | null;
  dataDirStatus: "ok" | "missing_or_empty" | "not_configured";
  identity: Identity | null;
  reconnectRequired: boolean;
  pendingRestore: boolean;
  restoreStatus: "none" | "waiting" | "ready";
}

export interface OperationLockStatus {
  active: boolean;
  own: boolean;
  deviceId: string;
  deviceNome: string;
  utenteNome: string;
  azione: string;
  timestamp: number;
  expiresInMs: number;
}

export interface SnapshotInfo {
  pathInZip: string;
  deviceId: string;
  deviceNome: string;
  seq: number;
  modifiedMs: number;
  bytes: number;
  records: number;
  purged: number;
  watermarks: number;
  recommended: boolean;
  safe: boolean;
}

/** Record generico (anagrafiche, ordini…): i campi vivono in `data`. */
export interface RecordDto {
  id: string;
  /** Versione HLC informativa del record; i form salvano patch LWW per campo. */
  revision: string;
  data: Record<string, unknown>;
  deleted: boolean;
}

export type Campi = Record<string, unknown>;

export type CanaleComunicazione = "email" | "whatsapp";
export type StatoComunicazione =
  | "bozza"
  | "da_revisionare"
  | "in_coda"
  | "sospeso"
  | "in_invio"
  | "invio_azionato"
  | "consegna_verificata"
  | "fallito"
  | "annullato";

export interface AllegatoComunicazioneInput {
  nome: string;
  mime: string;
  dimensione: number;
  /** Riferimento gestito dall'app; il binario non viene scritto nel log eventi. */
  riferimento: string;
  /** SHA-256 esadecimale della versione da inviare. */
  sha256: string;
}

export interface DocumentoCacheSalvaInput {
  nome: string;
  mime: "application/pdf" | "image/png";
  dati: number[];
}

export interface ComunicazioneCreaInput {
  idempotencyKey: string;
  destinatarioEntita: string;
  destinatarioId: string;
  canale: CanaleComunicazione;
  recapito: string;
  oggetto?: string;
  corpo: string;
  modelloId?: string;
  modelloVersioneId?: string;
  modelloVersione?: number;
  origineEntita?: string;
  origineId?: string;
  origineRevision?: string;
  origineFingerprint?: string;
  originiCorrelate?: Array<{ id: string; fingerprint: string }>;
  origineSnapshot?: unknown;
  tipoModello?: string;
  campagnaId?: string;
  reinvioDi?: string;
  allegati?: AllegatoComunicazioneInput[];
}

export interface Comunicazione {
  id: string;
  revision: string;
  stato: StatoComunicazione;
  canale: CanaleComunicazione;
  destinatarioEntita: string;
  destinatarioId: string;
  recapito: string;
  oggetto: string;
  corpo: string;
  modelloId: string;
  modelloVersioneId: string;
  modelloVersione: number;
  origineEntita: string;
  origineId: string;
  origineFingerprint: string;
  originiCorrelate?: Array<{ id: string; fingerprint: string }>;
  tipoModello: string;
  campagnaId: string;
  reinvioDi: string;
  allegati: AllegatoComunicazioneInput[];
  tentativi: number;
  ultimoErrore: string;
  erroreCodice?: string;
  erroreFase?: string;
  esitoAmbiguo: boolean;
  proprietarioUtenteId: string;
  proprietarioUtenteNome: string;
  proprietarioDispositivoId: string;
  proprietarioDispositivoNome: string;
  inviataMs: number;
  riferimentoEsterno: string;
  copiaPostaInviata: boolean;
  creataMs: number;
  statoAggiornatoMs: number;
}

export interface ComunicazioneInvioErrore {
  id: string;
  campagnaId: string;
  canale: CanaleComunicazione;
  destinatario: string;
  oggetto: string;
  messaggio: string;
  erroreCodice?: string;
  erroreFase?: string;
  esitoAmbiguo: boolean;
}

export interface WhatsappUltimoEsito {
  riuscito: boolean;
  codice: string;
  fase: string;
  messaggio: string;
  esitoAmbiguo: boolean;
  attivitaUtente: boolean;
  durataMs: number;
  avvenutoMs: number;
}

export interface WhatsappDiagnostica {
  protocolloRegistrato: boolean;
  finestraRilevata: boolean;
  processo: string;
  pacchetto: string;
  versione: string;
  identificazioneFallback: boolean;
  campioniPrestazioni: number;
  medianaMs: number;
  percentile95Ms: number;
  ultimoEsito: WhatsappUltimoEsito | null;
}

export interface WhatsappVerificaInput {
  nome: string;
  telefono: string;
}

export interface WhatsappVerificaProva {
  testo: Comunicazione;
  allegato: Comunicazione;
  diagnostica: WhatsappDiagnostica;
}

export type TipoModelloComunicazione =
  | "preventivo"
  | "sollecito_preventivo"
  | "sollecito_pagamento"
  | "preavviso_spedizione";

export interface VariabileModelloComunicazione {
  chiave: string;
  etichetta: string;
}

export interface ModelloComunicazione {
  id: string;
  revision: string;
  versioneId: string;
  versione: number;
  tipo: TipoModelloComunicazione;
  tipoLabel: string;
  titolo: string;
  oggetto: string;
  corpo: string;
  attivo: boolean;
  predefinito: boolean;
  variabiliUsate: string[];
  variabiliDisponibili: VariabileModelloComunicazione[];
  aggiornatoMs: number;
  aggiornatoDaUtente: string;
  aggiornatoDaDispositivo: string;
}

export interface ModelloComunicazioneSalvaInput {
  id?: string;
  tipo: TipoModelloComunicazione;
  titolo: string;
  oggetto: string;
  corpo: string;
  attivo?: boolean;
}

export type SicurezzaTrasportoEmail = "ssl_tls" | "starttls";

export interface ConfigurazioneEmailCampi {
  nomeMittente: string;
  indirizzoMittente: string;
  smtpHost: string;
  smtpPort: number;
  smtpSicurezza: SicurezzaTrasportoEmail;
  smtpUsername: string;
  replyToAbilitato: boolean;
  replyTo: string;
  firma: string;
  salvaPostaInviata: boolean;
  imapHost: string;
  imapPort: number;
  imapSicurezza: SicurezzaTrasportoEmail;
  destinatarioProva: string;
}

export interface ConfigurazioneEmail extends ConfigurazioneEmailCampi {
  revision: string;
  configurata: boolean;
  passwordPresenteLocale: boolean;
  passwordAltroUtenteLocale: boolean;
  aggiornataMs: number;
  ultimaProva: ProvaEmail | null;
}

export interface ProvaEmail {
  destinatario: string;
  inviataMs: number;
  smtpAccettata: boolean;
  copiaPostaInviata: boolean;
  avviso: string;
}

export interface ConfigurazioneEmailSalvaInput extends ConfigurazioneEmailCampi {
  /** Assente o vuota mantiene la password protetta già presente su questo PC. */
  password?: string;
}

export interface RecordIdInput {
  id: string;
}

export interface OrdineSalvaRigaInput {
  id?: string;
  fields: Campi;
}

export interface OrdineSalvaBaseInput {
  id?: string;
  /** Adegua nello stesso batch il rimborso extra ancora richiesto. */
  rimborsoExtra?: { id: string; importo: number };
  expectedRighe: RecordIdInput[];
  fields: Campi;
  righe: OrdineSalvaRigaInput[];
}

export interface OrdineSalvaBaseResult {
  id: string;
  ordine: RecordDto;
  righe: RecordDto[];
}

export type IndicazioneInvioPreventivo =
  | "mai_inviato"
  | "inviato"
  | "modificato_dopo_invio";

interface ConfigurazioneDocumentiCampi {
  denominazione: string;
  indirizzo: string;
  localita: string;
  telefono: string;
  email: string;
  sito: string;
  validitaDefaultGiorni: number;
  condizioniDefault: string;
}

export interface ConfigurazioneDocumenti
  extends ConfigurazioneDocumentiCampi {
  revision: string;
  esiste: boolean;
  aggiornataMs: number;
  versioneModello: number;
}

export interface ConfigurazioneDocumentiSalvaInput
  extends ConfigurazioneDocumentiCampi {
  revision?: string;
}

export interface PreventivoRiga {
  id: string;
  revision: string;
  prodottoId: string;
  prodottoNome: string;
  categoria: string;
  qta: number;
  prezzo: number;
  paziente: string;
  tipoTest: string;
  ml: string;
  codice: string;
  formulazione: string;
  posologia: string;
  numero: string;
  allergeni: string[];
}

export interface UtilizzoProdottoPreventivo {
  prodottoId: string;
  usiCliente: number;
  usiMedico: number;
}

export interface Preventivo {
  id: string;
  revision: string;
  esiste: boolean;
  ordineId: string;
  ordineRevision: string;
  ordineNumero: string;
  ordineData: string;
  /** Istante di creazione del preventivo, distinto dalla data operativa dell'ordine. */
  creatoMs: number;
  ordineStato: string;
  linee: string[];
  clienteId: string;
  clienteNome: string;
  clienteIndirizzo: string;
  clienteCitta: string;
  clienteCap: string;
  clienteProv: string;
  spedizioneNome: string;
  spedizioneIndirizzo: string;
  spedizioneCitta: string;
  spedizioneCap: string;
  spedizioneProv: string;
  spedizioneEmail: string;
  spedizioneTelefono: string;
  spedizioneNote: string;
  spedizioneCodiceFiscale: string;
  fatturazioneNome: string;
  fatturazioneIndirizzo: string;
  fatturazioneCitta: string;
  fatturazioneCap: string;
  fatturazioneProv: string;
  fatturazionePiva: string;
  fatturazioneCodiceFiscale: string;
  medicoId: string;
  medicoNome: string;
  agenteId: string;
  agenteNome: string;
  email: string;
  telefono: string;
  numeroPreventivo: string;
  validitaGiorni: number;
  condizioniPagamento: string;
  introduzione: string;
  note: string;
  /** Sconto commerciale reale mostrato nel documento; non altera il totale contabile. */
  scontoPercentuale: number;
  acconto: number;
  totale: number;
  fingerprintCorrente: string;
  ultimaModificaMs: number;
  ultimaModificaUtente: string;
  ultimaModificaDispositivo: string;
  ultimoInvioMs: number;
  ultimoInvioCanale: string;
  ultimoInvioFingerprint: string;
  ultimoInvioComunicazioneId: string;
  ultimoSollecitoMs: number;
  indicazioneInvio: IndicazioneInvioPreventivo;
  versioneModello: number;
  righe: PreventivoRiga[];
  pagamenti: Pagamento[];
  utilizziProdotti: UtilizzoProdottoPreventivo[];
}

export interface PreventivoRigaSalvaInput {
  id?: string;
  revision?: string;
  prodottoId?: string;
  prodottoNome?: string;
  qta: number;
  prezzo: number;
  paziente?: string;
  tipoTest?: string;
  ml?: string;
  codice?: string;
  formulazione?: string;
  posologia?: string;
  numero?: string;
  allergeni?: string[];
}

export interface PreventivoSalvaInput {
  ordineId: string;
  ordineRevision: string;
  preventivoRevision?: string;
  linea: string;
  validitaGiorni: number;
  condizioniPagamento?: string;
  introduzione?: string;
  note?: string;
  scontoPercentuale?: number;
  acconto: number;
  righe: PreventivoRigaSalvaInput[];
}

export interface AliasPreventivo {
  id: string;
  alias: string;
  prodottoId: string;
}

export interface SchedaClienteCampi {
  dataRicezione: string;
  pazienti: string;
  infoSpedizione: string;
  contatti: string;
  intestatarioNome: string;
  intestatarioCodiceFiscale: string;
  intestatarioDataNascita: string;
  intestatarioLuogoNascita: string;
  intestatarioIndirizzo: string;
  importoTotale: number;
  importoAcconto: number;
  dataContabileValuta: string;
  modalitaSaldo: string;
  note: string;
  preventivoWhatsapp: boolean;
  preventivoEmail: boolean;
  mantenimento: boolean;
  npp: boolean;
  pazienteNuovo: boolean;
}

export interface SchedaCliente extends SchedaClienteCampi {
  id: string;
  revision: string;
  esiste: boolean;
  ordineId: string;
  ordineRevision: string;
  ordineNumero: string;
  clienteNome: string;
  medicoNome: string;
  agenteNome: string;
  aggiornataMs: number;
  versioneModello: number;
}

export interface SchedaClienteSalvaInput extends SchedaClienteCampi {
  ordineId: string;
  ordineRevision: string;
  schedaRevision?: string;
}

export interface ProduzioneRigaPatchInput {
  id: string;
  fields: Campi;
}

export interface DedupClienteMergeInput {
  canonicoId: string;
  duplicatiIds: string[];
  fields: Campi;
  snapshots: Record<string, Campi>;
}

export interface DedupClientiResult {
  gruppi: number;
  mergeSaltati: number;
  campiCompletati: number;
  riferimentiRiassegnati: number;
  clientiPurgati: number;
}

export interface CestinoItem {
  entity: string;
  id: string;
  data: Record<string, unknown>;
  deletedMs: number;
}

export interface StoricoVoce {
  ms: number;
  user: string;
  device: string;
  op: "created" | "field_set" | "deleted" | "restored" | "purged";
  field?: string;
  value?: unknown;
}

export interface PrezzoSuggerito {
  prezzo: number; // centesimi
  fonte: "medico_prodotto" | "agente_prodotto" | "categoria" | "default";
  regolaId: string | null;
}

export interface PrezzoSuggeritoProdotto extends PrezzoSuggerito {
  prodottoId: string;
}

/** Riga del Giornaliero (testata ordine arricchita). */
export interface OrdineDto {
  id: string;
  numero: string;
  provvisorio: boolean;
  data: string;
  medicoId: string;
  medicoNome: string;
  agenteId: string;
  agenteNome: string;
  clienteId: string;
  clienteNome: string;
  clienteCitta: string;
  clienteRegione: string;
  clienteTelefono: string;
  stato: string;
  /** Stato pagamento effettivo (derivato + override): da_saldare | saldato | … */
  statoPagamento: string;
  sollecito: boolean;
  /** Segnalazione manuale (FASE 4E): "" | "urgente" | "anomalia" | "sollecito". */
  marcatore: string;
  note: string;
  motivoRifiuto: string;
  totale: number;
  /** Acconto previsto/concordato (un piano, non un incasso). */
  acconto: number;
  /** Somma dei pagamenti registrati, in centesimi. */
  incassato: number;
  /** residuo = totale − incassato. */
  residuo: number;
  omaggio: boolean;
  /** Colli per la spedizione (override o = n° prodotti dell'ordine). FASE 4. */
  colli: number;
  /** Linee presenti = categorie distinte dei prodotti delle righe (FASE 4D).
   * Es. ["Immunoterapia"] o ["Diagnostica","Immunoterapia"] per gli ordini misti. */
  linee: string[];
  /** Numeri/lotti compilati sulle righe ordine, ricercabili anche da Giornaliero/Spotlight. */
  numeriLotto: string[];
  /** Esiste un pagamento acconto saldato: l'ordine ha l'acconto incassato (FASE 5A). */
  accontoIncassato: boolean;
  /** Data dell'incasso dell'acconto (YYYY-MM-DD, "" se non incassato). FASE 5A. */
  dataAcconto: string;
  /** Data di invio in produzione (YYYY-MM-DD, "" se non inviato). FASE 5A. */
  dataProduzione: string;
  /** Data di arrivo in Italia dalla produzione (YYYY-MM-DD, ""). FASE 5A. */
  dataArrivoIt: string;
  /** Data prevista di consegna (col J Laboratorio): decisa una volta per lotto, "" se mai esportato. FASE 5C. */
  dataPrevista: string;
  /** Lotto di produzione (sessione di invio): ordini mandati insieme. "" se non inviato. FASE 5B. */
  lottoProduzione: string;
  /** true se il lotto è stato unito ad un altro (separabile). FASE 5B. */
  lottoProduzioneUnito: boolean;
}

/** Una riga d'ordine ancora da spedire (FASE 4). */
export interface RigaDaSpedire {
  rigaId: string;
  prodottoId: string;
  prodottoNome: string;
  qta: number;
  prezzo: number;
  paziente: string;
  /** Numero/lotto del singolo vaccino (Laboratorio): per-riga, non per-collo. FASE 7. */
  numero: string;
}

/** Recapito del collo, mostrato anche nel dettaglio della spedizione. */
interface DatiDestinatarioSpedizione {
  clienteId: string;
  clienteNome: string;
  medicoNome: string;
  agenteNome: string;
  indirizzo: string;
  cap: string;
  citta: string;
  prov: string;
  regione: string;
  telefono: string;
  email: string;
}

/** Un ordine con righe da spedire + dati di destinazione (FASE 4). */
export interface OrdineDaSpedire extends DatiDestinatarioSpedizione {
  ordineId: string;
  numero: string;
  data: string;
  stato: string;
  /** Residuo dell'ordine (totale − incassato), in centesimi. */
  residuo: number;
  /** Acconto totale ordine, usato per proporzionare il COD delle spedizioni parziali. */
  acconto: number;
  /** Mezzo COD suggerito (dalla 1ª rata non saldata su transito): "" | contrassegno | assegno. */
  codMezzo: string;
  /** Importo di quella rata in centesimi (proposto per il contrassegno). */
  codImporto: number;
  /** Note di spedizione predefinite del cliente (auto nel modale). */
  noteSpedizione: string;
  colli: number;
  /** Categoria/linea dell'ordine (Immunoterapia/Diagnostica/Keriba). */
  categoria: string;
  /** Data invio in produzione (vuota se non prodotto): ordina la coda «Da spedire». */
  dataProduzione: string;
  righe: RigaDaSpedire[];
}

/** Risultato della lettura locale dei file del laboratorio (FASE 13). */
export interface BollettazioneFile {
  name: string;
  rows: number;
  error?: string | null;
}

export interface BollettazioneTotals {
  ready: number;
  review: number;
  notFound: number;
  alreadyRegistered: number;
  validRows: number;
  failedFiles: number;
}

export interface BollettazioneMatch {
  rowId: string;
  orderId: string;
  orderNumber: string;
  orderDate: string;
  patient: string;
  doctor: string;
  productName: string;
  score: number;
  reason: string;
  expectedRowRevision: string;
  expectedOrderRevision: string;
  proposedFields: Record<string, unknown>;
  conflicts: BollettazioneConflict[];
}

export interface BollettazioneConflict {
  field: string;
  label: string;
  current: unknown;
  proposed: unknown;
  /** Etichetta leggibile per i valori tecnici (es. ID prodotto), se disponibile. */
  currentDisplay?: string;
  /** Etichetta leggibile proposta dal file, se disponibile. */
  proposedDisplay?: string;
  blocking: boolean;
}

export type BollettazioneRowStatus =
  | "pronto"
  | "da_controllare"
  | "non_trovato"
  | "gia_registrato";

export interface BollettazioneRow {
  source: string;
  sourceRow: number;
  reference: string;
  patient: string;
  doctor: string;
  treatment: string;
  status: BollettazioneRowStatus;
  reason: string;
  selectedMatch?: BollettazioneMatch | null;
  alternatives: BollettazioneMatch[];
  conflicts: BollettazioneConflict[];
  quantityIssue: boolean;
}

export interface BollettazioneAnalisi {
  files: BollettazioneFile[];
  rows: BollettazioneRow[];
  totals: BollettazioneTotals;
}

export interface BollettazioneConfermaRiga {
  sourceReference: string;
  rowId: string;
  orderId: string;
  expectedRowRevision: string;
  expectedOrderRevision: string;
  acceptedFields: Record<string, unknown>;
}

export interface BollettazioneSpedizione {
  data: string;
  corriereId: string;
  colli: number;
  peso: number;
  servizi: string;
  preavviso: boolean;
  mezzo: string;
  contrassegno: number;
  note: string;
  rowIds: string[];
}

export interface BollettazioneConfermaInput {
  mode: "arrivato_it" | "spedizione";
  dataArrivo: string;
  rows: BollettazioneConfermaRiga[];
  shipments?: BollettazioneSpedizione[];
}

export interface BollettazioneConfermaResult {
  mode: "arrivato_it" | "spedizione";
  updatedRows: number;
  shipments: Spedizione[];
}

/** Una riga inclusa in una spedizione effettuata (FASE 4). */
export interface SpedizioneRiga {
  rigaId: string;
  ordineId: string;
  ordineNumero: string;
  prodottoNome: string;
  qta: number;
  prezzo: number;
  clienteNome: string;
  /** Linea dell'ordine; numero vaccino e colli sono propri dell'Immunoterapia. */
  categoria?: string;
  /** Persona a cui appartiene il vaccino; usata per raggruppare la distinta CORRIERE_A. */
  paziente: string;
  /** Numero/lotto del singolo vaccino (per la rimozione singola e il dettaglio). FASE 7. */
  numero: string;
}

/** Una spedizione effettuata: un collo verso un destinatario (FASE 4). */
export interface Spedizione extends DatiDestinatarioSpedizione {
  id: string;
  /** Fotografia semantica dell'avviso di spedizione, calcolata una volta dal backend. */
  comunicazioneFingerprint?: string;
  /** Lotto = sessione di creazione (raggruppa le spedizioni create insieme). */
  lotto: string;
  data: string;
  corriereId: string;
  corriereNome: string;
  numero: string;
  colli: number;
  peso: number;
  servizi: string;
  preavviso: boolean;
  /** Incasso alla consegna: "" (prepagato) | contrassegno | assegno. */
  mezzo: string;
  /** Importo contrassegno/assegno in centesimi (anche parziale). */
  contrassegno: number;
  note: string;
  /** Profilo distinta del corriere: "gls" | "carrai". */
  corriereProfilo: string;
  /** True se la spedizione è stata fusa in un altro lotto (gruppo "unito", separabile). */
  unito: boolean;
  /** True se altri colli con lo stesso destinatario sono uniti in questo collo. */
  destinatariUniti: boolean;
  nRighe: number;
  righe: SpedizioneRiga[];
  pagamenti: PagamentoSpedizione[];
}

export interface PagamentoSpedizione {
  contoId: string;
  tipo: string;
  importo: number;
  saldato: boolean;
  contoNome: string;
  contoTipo: string;
  scadenza: string;
}

/** Riepilogo incassi su un conto (esclusi acconti). FASE 4. */
export interface RiepilogoConto {
  contoId: string;
  contoNome: string;
  contoTipo: string;
  giaIncassato: number;
  daIncassare: number;
  totale: number;
}

/** Riepilogo incassi di un agente (con dettaglio per conto). FASE 4. */
export interface RiepilogoAgente {
  agenteId: string;
  agenteNome: string;
  giaIncassato: number;
  daIncassare: number;
  totale: number;
  conti: RiepilogoConto[];
}

/** Riepilogo incassi di un lotto di spedizioni (esclusi acconti). FASE 4. */
export interface SpedizioneRiepilogo {
  giaIncassato: number;
  daIncassare: number;
  totale: number;
  perConto: RiepilogoConto[];
  perAgente: RiepilogoAgente[];
}

/** Un pagamento di un ordine: atteso (saldato=false) o incassato (saldato=true). */
export interface Pagamento {
  id: string;
  /** Presente sui pagamenti persistiti; le bozze locali non hanno revisione. */
  revision?: string;
  ordineId: string;
  tipo: "acconto" | "saldo" | "rata";
  importo: number;
  saldato: boolean;
  scadenza: string;
  contoId: string;
  contoNome: string;
  contoTipo: string; // banca | contrassegno | assegno
  /** IBAN del conto bancario selezionato, quando disponibile. */
  contoIban?: string;
  data: string;
  verificato: boolean;
  distintaId: string;
  /** Se accreditato da una distinta corriere, nome del conto reale (vuoto altrimenti). */
  contoAccreditoNome: string;
  note: string;
  scadDaSpedizione: boolean;
  scadRelGiorni: number;
}

/** Riga della vista unica Crediti (Contabilità → Crediti): atteso + saldato. */
export interface PagamentoVista {
  id: string;
  revision: string;
  ordineId: string;
  ordineNumero: string;
  clienteId: string;
  clienteNome: string;
  medicoId: string;
  medicoNome: string;
  agenteId: string;
  agenteNome: string;
  tipo: string;
  importo: number;
  saldato: boolean;
  scadenza: string;
  data: string;
  contoId: string;
  contoNome: string;
  contoTipo: string;
  /** Conto reale di accredito se coperto da una distinta corriere (vuoto altrimenti). */
  contoAccreditoNome: string;
  /** Stato dell'ordine: distingue credito potenziale (Nuovo) da atteso (≥ Confermato). */
  ordineStato: string;
  /** Linee/categorie dei prodotti dell'ordine (per il filtro per categoria nei Crediti). */
  linee: string[];
  verificato: boolean;
}

export interface ProrogaPagamentoInput {
  id: string;
  revision: string;
  vecchiaScadenza: string;
  nuovaScadenza: string;
}

/** Una rata in input al comando pagamenti_rateizza (importi calcolati lato UI). */
export interface RataInput {
  importo: number;
  scadenza: string;
}

/** Una distinta corriere (FASE 3C): bonifico cumulativo che accredita contrassegni/assegni. */
export interface Distinta {
  id: string;
  corriereId: string;
  corriereNome: string;
  dataDistinta: string;
  dataAccredito: string;
  importo: number;
  contoId: string;
  contoNome: string;
  nPagamenti: number;
}

/** Un pagamento su conto di transito da accreditare (o già coperto da una distinta). */
export interface ContrassegnoAperto {
  id: string;
  ordineId: string;
  ordineNumero: string;
  clienteNome: string;
  agenteNome: string;
  tipo: string;
  importo: number;
  contoId: string;
  contoNome: string;
  contoTipo: string; // contrassegno | assegno
  data: string;
}

/** Un rimborso (FASE 3D): flusso di denaro in uscita. Stato derivato richiesto/effettuato. */
export interface Rimborso {
  id: string;
  dataRichiesta: string;
  importo: number;
  ragioneSociale: string;
  motivo: string;
  iban: string;
  contoId: string;
  contoNome: string;
  /** Vuota = richiesto; valorizzata = effettuato. */
  dataRimborso: string;
  note: string;
  /** Ordine collegato (solo origine = extra). */
  ordineId: string;
  ordineNumero: string;
  /** Cliente dell'ordine collegato; vuoto per i rimborsi manuali. */
  clienteId: string;
  origine: "manuale" | "extra";
  /** Stato derivato: richiesto | effettuato. */
  stato: "richiesto" | "effettuato";
}

/** Pre-compilazione di un rimborso "extra" da un ordine pagato in eccesso. */
export interface RimborsoExtra {
  ordineId: string;
  ordineNumero: string;
  /** Eccedenza in centesimi (incassato − totale), 0 se non c'è eccesso. */
  importo: number;
  ragioneSociale: string;
  iban: string;
}

/** Una riga del report provvigioni (un ordine). Importi in centesimi. */
export interface ProvvigioneOrdine {
  ordineId: string;
  numero: string;
  data: string;
  clienteId: string;
  clienteNome: string;
  stato: string;
  base: number;
  provvigione: number;
  maturato: boolean;
  /** `true` se l'ordine ha un acconto incassato (pagamento provvigione anticipato). */
  accontoIncassato: boolean;
}

/** Provvigioni di un agente nel periodo. */
export interface ProvvigioneAgente {
  agenteId: string;
  agenteNome: string;
  provvTipo: string;
  provvValore: number;
  maturazione: string;
  ordini: ProvvigioneOrdine[];
  nOrdini: number;
  totaleMaturato: number;
  totalePotenziale: number;
}

export interface ProvvigioniReport {
  agenti: ProvvigioneAgente[];
  totaleMaturato: number;
  totalePotenziale: number;
  totalePagato: number;
}

// ---- Dashboard (FASE 6B) ----
export interface DashPunto {
  iso: string;
  etichetta: string;
  ordini: number;
  /** centesimi */
  valore: number;
  /** centesimi */
  incassato: number;
}

export interface DashFetta {
  chiave: string;
  n: number;
  /** centesimi */
  valore: number;
}

export interface DashAgente {
  agenteId: string;
  agenteNome: string;
  /** centesimi */
  valore: number;
  /** centesimi */
  provvigioni: number;
}

export interface DashboardStats {
  ordiniN: number;
  ordiniValore: number;
  provvMaturato: number;
  provvPotenziale: number;
  daSaldareSpediti: number;
  daSaldareNonSpediti: number;
  inProduzione: number;
  inArrivo: number;
  andamento: DashPunto[];
  perStato: DashFetta[];
  perRegione: DashFetta[];
  topAgenti: DashAgente[];
}

export interface DashboardPanels {
  ultimiOrdini: OrdineDto[];
  pagamentiScaduti: PagamentoVista[];
}

export type TipoSuggerimento =
  | "rimborso"
  | "distinta"
  | "provvigione"
  | "produzione"
  | "spedizione"
  | "duplicati";

export interface SuggerimentoCollegamento {
  path: string;
  tab?: string;
  apriId?: string;
  azione?: string;
  agenteId?: string;
  rimborsoStati?: string[];
  produzioneAcconto?: string;
  provvigioniOrdina?: string;
}

export interface Suggerimento {
  id: string;
  tipo: TipoSuggerimento;
  titolo: string;
  dettaglio: string;
  azioneLabel: string;
  priorita: number;
  collegamento: SuggerimentoCollegamento;
  riferimentoData: string;
  aggiornatoMs: number;
}

export interface SuggerimentiBundle {
  suggerimenti: Suggerimento[];
  nascosti: string[];
  tipiInPausa: TipoSuggerimento[];
}

export interface SuggerimentiPreferenzeInput {
  tipiAbilitati: TipoSuggerimento[];
  notificheAttive: boolean;
  giorniAvviso: Record<TipoSuggerimento, number>;
}

export interface Dispositivo {
  deviceId: string;
  nome: string;
  userId: string;
  userNome: string;
  avatarTipo: AvatarTipo;
  avatarValore: string;
  lastMs: number;
  isCurrent: boolean;
}

export interface SyncOverview {
  devices: Dispositivo[];
  lastEventMs: number;
  dataDir: string | null;
}

export interface RitiroDispositivoResult {
  deviceId: string;
  deviceNome: string;
  userId: string;
  userNome: string;
  backupPath: string;
  eventsRemoved: number;
}

export interface BackupInfo {
  nome: string;
  path: string;
  size: number;
  ms: number;
}

export interface RestoreAck {
  deviceId: string;
  deviceNome: string;
  userNome: string;
  ms: number;
}

export interface RestoreCoordination {
  restoreId: string;
  expected: Dispositivo[];
  acks: RestoreAck[];
  acknowledged: number;
  expectedCount: number;
}

export interface OttimizzazioneDatabaseResult {
  generationId: string;
  backupPath: string;
  dedupClienti: DedupClientiResult;
  postazioniSenzaAck: number;
  tombstoneRimosse: number;
  eventiRimossi: number;
  fileLogRimossi: number;
  snapshotRimossi: number;
  byteLiberati: number;
  recordConservati: number;
}

export interface OperationProgress {
  id: string;
  kind: "backup" | "demo" | string;
  progress: number;
  message: string;
  done: boolean;
}

export interface InstallLatest {
  version: string;
}

export interface RemoteControlStatus {
  disabled: boolean;
  message: string;
  updatedAt: string;
  fromCache: boolean;
  premiumEnabled: boolean;
}

export type PuliziaModalita = "inutili" | "clienti_morti" | "movimenti_periodo";
export type PuliziaPreset =
  "anno" | "prima_anno" | "mesi_12" | "mesi_24" | "mesi_36" | "custom";

export interface PuliziaDatiArgs {
  modalita: PuliziaModalita;
  preset: PuliziaPreset;
  anno?: number | null;
  dal?: string | null;
  al?: string | null;
}

export interface PuliziaBlocco {
  titolo: string;
  dettaglio: string;
}

export interface PuliziaPreview {
  modalita: PuliziaModalita;
  preset: PuliziaPreset;
  dal: string;
  al: string;
  descrizione: string;
  conferma: string;
  totaleRecord: number;
  conteggi: Record<string, number>;
  blocchi: PuliziaBlocco[];
}

export interface PuliziaResult {
  purgati: number;
  conteggi: Record<string, number>;
  notificheRipulite: number;
  tombstoneRimosse: number;
  eventiRimossi: number;
  compattato: boolean;
  backup: BackupInfo;
}

export type OnboardingMode = "create" | "use" | "reconfigure";

export interface FinishOnboardingArgs {
  dataDir: string;
  mode: OnboardingMode;
  userId?: string;
  nome: string;
  avatarTipo: AvatarTipo;
  avatarValore: string;
}

export interface ExtractedClient {
  nome: string;
  indirizzo: string;
  citta: string;
  prov: string;
  cap: string;
  regione: string;
  telefono: string;
  email: string;
  cf: string;
  note_spedizione: string;
}

// ---- Comandi ----
