use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapDto {
    pub onboarded: bool,
    pub device_id: String,
    pub device_nome: String,
    pub data_dir: Option<String>,
    pub data_dir_status: String,
    pub identity: Option<IdentityDto>,
    pub reconnect_required: bool,
    pub pending_restore: bool,
    /// `none`, `waiting` oppure `ready`. `pending_restore` resta per compatibilità
    /// con frontend precedenti e vale solo quando il payload è pronto.
    pub restore_status: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OperationLockDto {
    pub active: bool,
    pub own: bool,
    pub device_id: String,
    pub device_nome: String,
    pub utente_nome: String,
    pub azione: String,
    pub timestamp: u64,
    pub expires_in_ms: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IdentityDto {
    pub user_id: String,
    pub nome: String,
    pub avatar_tipo: String,
    pub avatar_valore: String,
    pub device_id: String,
    pub device_nome: String,
    pub data_dir: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDto {
    pub id: String,
    pub nome: String,
    pub avatar_tipo: String,
    pub avatar_valore: String,
}

/// Un dispositivo nella panoramica sincronizzazione.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DispositivoDto {
    pub device_id: String,
    pub nome: String,
    /// Utente che usa il dispositivo: id (per inviargli un messaggio) + nome + avatar.
    pub user_id: String,
    pub user_nome: String,
    pub avatar_tipo: String,
    pub avatar_valore: String,
    /// Ultima attività (ms epoch) derivata dagli eventi; 0 se sconosciuta.
    pub last_ms: u64,
    pub is_current: bool,
}

/// Panoramica sincronizzazione (UI-SPEC §7.11).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOverviewDto {
    pub devices: Vec<DispositivoDto>,
    pub last_event_ms: u64,
    pub data_dir: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RitiroDispositivoResult {
    pub device_id: String,
    pub device_nome: String,
    pub user_id: String,
    pub user_nome: String,
    pub backup_path: String,
    pub events_removed: usize,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RestoreAckDto {
    pub device_id: String,
    pub device_nome: String,
    pub user_nome: String,
    pub ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreCoordinationDto {
    pub restore_id: String,
    pub expected: Vec<DispositivoDto>,
    pub acks: Vec<RestoreAckDto>,
    pub acknowledged: usize,
    pub expected_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OttimizzazioneDatabaseResult {
    pub generation_id: String,
    pub backup_path: String,
    pub dedup_clienti: DedupClientiResult,
    pub postazioni_senza_ack: usize,
    pub tombstone_rimosse: usize,
    pub eventi_rimossi: usize,
    pub file_log_rimossi: usize,
    pub snapshot_rimossi: usize,
    pub byte_liberati: u64,
    pub record_conservati: usize,
}

/// Prezzo suggerito risolto dal listino.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrezzoSuggeritoDto {
    pub prezzo: i64,
    /// Codice della fonte: `medico_prodotto` | `agente_prodotto` | `categoria` | `default`.
    pub fonte: String,
    pub regola_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrezzoSuggeritoProdottoDto {
    pub prodotto_id: String,
    pub prezzo: i64,
    pub fonte: String,
    pub regola_id: Option<String>,
}

/// Riga del Giornaliero (testata ordine arricchita: numero, totale, residuo, nomi).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrdineDto {
    pub id: String,
    /// Numero leggibile `ANNO-progressivo` (es. `2026-0001`), derivato dall'HLC.
    pub numero: String,
    pub provvisorio: bool,
    pub data: String,
    pub medico_id: String,
    pub medico_nome: String,
    pub agente_id: String,
    pub agente_nome: String,
    pub cliente_id: String,
    pub cliente_nome: String,
    pub cliente_citta: String,
    pub cliente_regione: String,
    pub cliente_telefono: String,
    pub stato: String,
    /// Stato pagamento **effettivo** (override manuale se impostato, altrimenti
    /// derivato dai pagamenti). Valori: `da_saldare | saldato | saldato_da_verificare |
    /// da_controllare | omaggio_sostituzione | in_attesa_accredito`.
    pub stato_pagamento: String,
    pub sollecito: bool,
    /// Segnalazione manuale per il triage (FASE 4E): `""` (nessuna) | `urgente` |
    /// `anomalia`. Mostrata sotto lo stato; messaggi/incident veri → FASE 6.
    pub marcatore: String,
    pub note: String,
    pub motivo_rifiuto: String,
    pub totale: i64,
    /// Acconto **previsto/concordato** (un piano, auto dal medico): NON è un incasso.
    pub acconto: i64,
    /// Incassato = somma dei pagamenti registrati per l'ordine, in centesimi.
    pub incassato: i64,
    /// `residuo = totale − incassato`.
    pub residuo: i64,
    /// Ordine omaggio/campione: escluso dal calcolo provvigioni.
    pub omaggio: bool,
    /// Numero di colli per la spedizione (FASE 4): override `colli` sull'ordine se
    /// valorizzato, altrimenti = numero di righe/prodotti dell'ordine.
    pub colli: i64,
    /// Linee presenti nell'ordine = categorie distinte dei prodotti delle sue righe
    /// (FASE 4D): es. `["Immunoterapia"]` o `["Diagnostica", "Immunoterapia"]` per gli
    /// ordini misti. Base per il filtro per linea del Giornaliero unificato.
    pub linee: Vec<String>,
    /// Numeri/lotti compilati sulle righe ordine, usati da ricerche e spedizioni.
    pub numeri_lotto: Vec<String>,
    /// `true` se esiste un pagamento **acconto** saldato (FASE 5A): l'ordine ha
    /// l'acconto **incassato** e sale in cima alla coda di produzione.
    pub acconto_incassato: bool,
    /// Data dell'incasso dell'acconto (`YYYY-MM-DD`, vuota se non incassato). FASE 5A.
    pub data_acconto: String,
    /// Data di invio in produzione (`YYYY-MM-DD`, vuota finché non inviato). FASE 5A.
    pub data_produzione: String,
    /// Data di arrivo in Italia dalla produzione (`YYYY-MM-DD`, vuota). FASE 5A.
    pub data_arrivo_it: String,
    /// Fallback legacy per la data **prevista** di consegna dalla produzione (col J del file
    /// Laboratorio). Il valore puntuale vive su `riga_ordine.data_prevista`; questo campo resta
    /// solo come fallback per ordini/lotti storici.
    pub data_prevista: String,
    /// Lotto di produzione (sessione di invio): tutti gli ordini mandati insieme con
    /// «Manda in produzione» condividono lo stesso id. Vuoto finché non inviato. Base del
    /// raggruppamento della vista «In lavorazione» (FASE 5B), sul modello dei lotti
    /// spedizione.
    pub lotto_produzione: String,
    /// `true` se il lotto è stato **unito** ad un altro (`lotto_produzione_pre` salvato):
    /// l'unione è reversibile con `produzione_lotto_separa`. FASE 5B.
    pub lotto_produzione_unito: bool,
    /// Stato sintetico già derivato mentre `ordini_lista` attraversa le righe: permette
    /// ai consumatori leggeri (es. Spotlight) di riconoscere la coda senza ricaricarle.
    pub produzione_operativa: bool,
}

/// Una riga d'ordine ancora **da spedire** (FASE 4).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RigaDaSpedireDto {
    pub riga_id: String,
    pub prodotto_id: String,
    pub prodotto_nome: String,
    pub qta: i64,
    pub prezzo: i64,
    pub paziente: String,
    /// Numero/lotto del **singolo vaccino** (Laboratorio): è per-riga, non per-collo. Si
    /// compila qui o nell'editor ordine; alla spedizione viene confermato/ritoccato. FASE 7.
    pub numero: String,
}

/// Numero/lotto per una riga, passato dal frontend alla creazione spedizione (FASE 7):
/// ogni vaccino ha il suo numero (non più uno unico per collo).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RigaNumeroIn {
    pub riga_id: String,
    pub numero: String,
}

/// Un ordine con almeno una riga da spedire, con i dati di destinazione (FASE 4).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrdineDaSpedireDto {
    pub ordine_id: String,
    pub numero: String,
    pub data: String,
    pub stato: String,
    pub cliente_id: String,
    pub cliente_nome: String,
    pub medico_nome: String,
    pub agente_nome: String,
    pub indirizzo: String,
    pub cap: String,
    pub citta: String,
    pub prov: String,
    pub regione: String,
    pub telefono: String,
    pub email: String,
    /// Residuo dell'ordine (totale − incassato), in centesimi.
    pub residuo: i64,
    /// Acconto totale ordine, usato solo per proporzionare il COD delle spedizioni parziali.
    pub acconto: i64,
    /// Mezzo dell'incasso **alla consegna** suggerito automaticamente: dedotto dalla
    /// **prima rata utile non saldata** su conto di transito dell'ordine
    /// (`""` = nessuno/prepagato | `contrassegno` | `assegno`). FASE 4.
    pub cod_mezzo: String,
    /// Importo di quella rata (centesimi); è il valore proposto per il contrassegno.
    pub cod_importo: i64,
    /// Note di spedizione predefinite del cliente (auto-importate nel modale). FASE 4B.
    pub note_spedizione: String,
    /// Colli proposti = righe da spedire (override `colli` ordine se presente).
    pub colli: i64,
    /// Categoria/linea dell'ordine (Immunoterapia/Diagnostica/Keriba). Serve al filtro
    /// «Da spedire»: di default si mostra solo Immunoterapia, le altre con lo switch. FASE 5E.
    pub categoria: String,
    /// Data di invio in produzione (vuota se non ancora prodotto). Ordina la coda «Da
    /// spedire»: gli «In produzione» in cima, dal più vecchio al più nuovo.
    pub data_produzione: String,
    pub righe: Vec<RigaDaSpedireDto>,
}

/// Una riga inclusa in una spedizione effettuata (FASE 4).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpedizioneRigaDto {
    pub riga_id: String,
    pub ordine_id: String,
    pub ordine_numero: String,
    pub prodotto_nome: String,
    pub qta: i64,
    pub prezzo: i64,
    pub cliente_nome: String,
    /// Linea dell'ordine: numero vaccino e colli appartengono solo all'Immunoterapia.
    pub categoria: String,
    /// Persona a cui appartiene il vaccino, mostrata nei dettagli del collo. La distinta
    /// CORRIERE_A mantiene una riga per spedizione e non separa più i vaccini per paziente.
    pub paziente: String,
    /// Numero/lotto del singolo vaccino (per la rimozione singola e il dettaglio). FASE 7.
    pub numero: String,
}

/// Una spedizione effettuata: un collo verso un destinatario, con le righe spedite
/// (anche di più ordini dello stesso cliente). FASE 4.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpedizioneDto {
    pub id: String,
    /// Fotografia semantica usata dagli avvisi: cambia se cambiano data,
    /// corriere, destinatario o numeri delle righe, non quando si salva l'esito.
    pub comunicazione_fingerprint: String,
    /// Lotto = sessione di creazione (un id condiviso da tutte le spedizioni create
    /// insieme in un «Crea spedizione»); le Effettuate si raggruppano per questo.
    pub lotto: String,
    pub data: String,
    pub corriere_id: String,
    pub corriere_nome: String,
    /// Numero interno del vaccino (da Laboratorio); il suffisso corriere è solo nell'export.
    pub numero: String,
    pub colli: i64,
    pub peso: i64,
    pub servizi: String,
    /// Preavviso telefonico attivo per questa spedizione.
    pub preavviso: bool,
    /// Mezzo di incasso alla consegna: `""` (prepagato) | `contrassegno` | `assegno`.
    pub mezzo: String,
    /// Importo contrassegno/assegno in centesimi (può essere parziale, non tutto il saldo).
    pub contrassegno: i64,
    pub note: String,
    pub cliente_id: String,
    pub cliente_nome: String,
    // --- Info collo (mostrate solo al click sul collo) ---
    pub medico_nome: String,
    pub agente_nome: String,
    pub indirizzo: String,
    pub cap: String,
    pub citta: String,
    pub prov: String,
    pub regione: String,
    pub telefono: String,
    pub email: String,
    /// Profilo di esportazione del corriere (`gls` | `corriere_a`), per l'export distinta.
    pub corriere_profilo: String,
    /// True se questa spedizione è stata fusa in un altro lotto (`lotto_pre` salvato): il
    /// gruppo è "unito" e può essere separato con `lotto_separa`.
    pub unito: bool,
    /// True se altri colli con lo stesso destinatario sono stati uniti in questo collo.
    pub destinatari_uniti: bool,
    pub avvisato: bool,
    pub ultimo_avviso_canale: Option<String>,
    pub ultimo_avviso_ms: Option<u64>,
    pub n_righe: usize,
    pub righe: Vec<SpedizioneRigaDto>,
    pub pagamenti: Vec<PagamentoSpedizioneDto>,
}

/// Pagamento collegato a un ordine in una spedizione (FASE 4).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PagamentoSpedizioneDto {
    pub conto_id: String,
    pub tipo: String,
    pub importo: i64,
    pub saldato: bool,
    pub conto_nome: String,
    pub conto_tipo: String,
    pub scadenza: String,
}

/// Riepilogo incassi su un **conto** (esclusi gli acconti): quanto già incassato e quanto
/// resta da incassare (FASE 4).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RiepilogoContoDto {
    pub conto_id: String,
    pub conto_nome: String,
    /// `banca | contrassegno | assegno`.
    pub conto_tipo: String,
    pub gia_incassato: i64,
    pub da_incassare: i64,
    pub totale: i64,
}

/// Riepilogo incassi di un **agente** sulle spedizioni del lotto, con dettaglio per conto
/// (per il drill-down). Esclusi gli acconti (FASE 4).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiepilogoAgenteDto {
    pub agente_id: String,
    pub agente_nome: String,
    pub gia_incassato: i64,
    pub da_incassare: i64,
    pub totale: i64,
    pub conti: Vec<RiepilogoContoDto>,
}

/// Riepilogo incassi di un **lotto** di spedizioni: per conto e per agente, con i totali
/// (già incassato + da incassare), **esclusi gli acconti** (FASE 4).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpedizioneRiepilogoDto {
    pub gia_incassato: i64,
    pub da_incassare: i64,
    pub totale: i64,
    pub per_conto: Vec<RiepilogoContoDto>,
    pub per_agente: Vec<RiepilogoAgenteDto>,
}

/// Un pagamento di un ordine: **atteso** (pianificato, non ancora incassato) oppure
/// **saldato** (incassato). Acconto, saldo e rate sono tutti pagamenti di questa entità.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagamentoDto {
    pub id: String,
    /// Versione HLC informativa; le modifiche ordinarie usano patch LWW per campo.
    pub revision: String,
    pub ordine_id: String,
    /// `acconto | saldo | rata`.
    pub tipo: String,
    pub importo: i64,
    /// `false` = atteso / in attesa di incasso, `true` = incassato.
    pub saldato: bool,
    /// Scadenza prevista (`YYYY-MM-DD`) finché atteso; vuota altrimenti.
    pub scadenza: String,
    pub conto_id: String,
    pub conto_nome: String,
    /// `banca | contrassegno | assegno`.
    pub conto_tipo: String,
    /// IBAN del conto selezionato, se è un conto bancario.
    pub conto_iban: String,
    /// Data di incasso reale (impostata al saldo).
    pub data: String,
    pub verificato: bool,
    pub distinta_id: String,
    /// Se accreditato da una distinta corriere, nome del **conto reale** dove sono
    /// arrivati i soldi (la fotografia sulla distinta). Vuoto se non accreditato.
    pub conto_accredito_nome: String,
    pub note: String,
    pub scad_da_spedizione: bool,
    pub scad_rel_giorni: i64,
    pub spedizione_id: String,
}

/// Riga della vista unica **Crediti** (Contabilità → Crediti): un pagamento con i
/// dati dell'ordine, sia atteso sia saldato. Sostituisce le due viste separate.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagamentoVistaDto {
    pub id: String,
    pub revision: String,
    pub ordine_id: String,
    pub ordine_numero: String,
    pub cliente_id: String,
    pub cliente_nome: String,
    pub medico_id: String,
    pub medico_nome: String,
    pub agente_id: String,
    pub agente_nome: String,
    /// `acconto | saldo | rata`.
    pub tipo: String,
    pub importo: i64,
    pub saldato: bool,
    pub scadenza: String,
    pub data: String,
    pub conto_id: String,
    pub conto_nome: String,
    pub conto_tipo: String,
    /// Conto reale di accredito se coperto da una distinta corriere (vuoto altrimenti).
    pub conto_accredito_nome: String,
    /// Stato dell'ordine (per distinguere credito **potenziale** — ordine Nuovo — da
    /// credito **atteso** — ordine impegnato, ≥ Confermato).
    pub ordine_stato: String,
    /// Linee/categorie dei prodotti dell'ordine (per il filtro per categoria nei Crediti).
    pub linee: Vec<String>,
    pub verificato: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProrogaPagamentoInput {
    pub id: String,
    pub revision: String,
    pub vecchia_scadenza: String,
    pub nuova_scadenza: String,
}

/// Una **distinta corriere** (FASE 3C): un bonifico cumulativo con cui un corriere (o
/// un versamento assegni) accredita su un conto reale uno o più pagamenti incassati su
/// conto di **transito** (contrassegno/assegno). `conto_id` è la **fotografia** del
/// conto reale al momento dell'accredito (non un riferimento vivo all'anagrafica):
/// cambiare in seguito il conto del corriere non sposta le distinte passate.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DistintaDto {
    pub id: String,
    /// Corriere che ha versato il bonifico (vuoto per un versamento assegni).
    pub corriere_id: String,
    pub corriere_nome: String,
    pub data_distinta: String,
    pub data_accredito: String,
    /// Somma dei pagamenti coperti (centesimi), snapshot alla creazione.
    pub importo: i64,
    pub conto_id: String,
    pub conto_nome: String,
    /// Numero di pagamenti coperti dalla distinta.
    pub n_pagamenti: usize,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PagamentoDistintaAtteso {
    pub id: String,
    pub ordine_id: String,
    pub importo: i64,
    pub conto_id: String,
    pub conto_tipo: String,
}

/// Un pagamento su conto di **transito** (contrassegno/assegno) saldato ma **non ancora
/// accreditato** (`distinta_id` vuoto): candidato a essere coperto da una distinta. La
/// stessa forma serve anche per elencare i pagamenti **già** coperti da una distinta.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContrassegnoApertoDto {
    pub id: String,
    pub ordine_id: String,
    pub ordine_numero: String,
    pub cliente_nome: String,
    pub agente_nome: String,
    /// `acconto | saldo | rata`.
    pub tipo: String,
    pub importo: i64,
    pub conto_id: String,
    pub conto_nome: String,
    /// `contrassegno | assegno`.
    pub conto_tipo: String,
    /// Data di incasso del pagamento.
    pub data: String,
}

/// Una rata in ingresso dalla UI (dialog "Rateizza"): importi già calcolati e
/// (eventualmente) ritoccati a mano nell'anteprima. Diventano pagamenti `rata` attesi.
#[derive(Deserialize)]
pub struct RataInput {
    pub importo: i64,
    pub scadenza: String,
}

/// Un **rimborso** (FASE 3D): un flusso di denaro **in uscita** verso un cliente/ente,
/// indipendente dai pagamenti in entrata. `stato` è **derivato**: *richiesto* finché
/// `data_rimborso` è vuota, *effettuato* quando è valorizzata. `origine = extra` indica
/// un rimborso nato da un ordine pagato in eccesso (`incassato > totale`): conserva
/// `ordine_id` ma **non altera** i pagamenti né i totali Crediti.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RimborsoDto {
    pub id: String,
    pub data_richiesta: String,
    pub importo: i64,
    pub ragione_sociale: String,
    pub motivo: String,
    pub iban: String,
    pub conto_id: String,
    pub conto_nome: String,
    /// Vuota = *richiesto*; valorizzata = *effettuato*.
    pub data_rimborso: String,
    pub note: String,
    /// Ordine collegato (solo per `origine = extra`), vuoto altrimenti.
    pub ordine_id: String,
    /// Numero leggibile dell'ordine collegato (se presente).
    pub ordine_numero: String,
    /// Cliente dell'ordine collegato; vuoto per i rimborsi manuali.
    pub cliente_id: String,
    /// `manuale | extra`.
    pub origine: String,
    /// Stato derivato: `richiesto | effettuato`.
    pub stato: String,
}

/// Pre-compilazione di un rimborso **extra** a partire da un ordine pagato in eccesso:
/// importo = `incassato − totale`, ragione sociale e IBAN presi dal cliente dell'ordine.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RimborsoExtraDto {
    pub ordine_id: String,
    pub ordine_numero: String,
    /// Eccedenza in centesimi (`incassato − totale`); 0 se non c'è eccesso.
    pub importo: i64,
    pub ragione_sociale: String,
    pub iban: String,
}

/// Una riga del report provvigioni: un ordine con la sua provvigione.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvvigioneOrdineDto {
    pub ordine_id: String,
    pub numero: String,
    pub data: String,
    pub cliente_id: String,
    pub cliente_nome: String,
    pub stato: String,
    /// Base di calcolo = totale (importo) dell'ordine, in centesimi.
    pub base: i64,
    /// Provvigione calcolata, in centesimi.
    pub provvigione: i64,
    /// `true` se l'ordine ha raggiunto la soglia di maturazione dell'agente.
    pub maturato: bool,
    /// `true` se l'ordine ha un **acconto incassato** (anche se non ancora spedito):
    /// abilita il pagamento anticipato della provvigione (switch nel modale «Paga»).
    pub acconto_incassato: bool,
}

/// Provvigioni di un singolo agente nel periodo richiesto.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvvigioneAgenteDto {
    pub agente_id: String,
    pub agente_nome: String,
    pub provv_tipo: String,
    pub provv_valore: f64,
    /// Soglia di maturazione configurata: `spedizione` (default) | `chiuso`.
    pub maturazione: String,
    pub ordini: Vec<ProvvigioneOrdineDto>,
    pub n_ordini: usize,
    /// Somma delle provvigioni dei soli ordini **maturati** (ciò che si paga).
    pub totale_maturato: i64,
    /// Somma di tutte le provvigioni (maturate + non ancora), in centesimi.
    pub totale_potenziale: i64,
}

/// Riepilogo provvigioni per agente/periodo (FASE 2).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvvigioniReportDto {
    pub agenti: Vec<ProvvigioneAgenteDto>,
    pub totale_maturato: i64,
    pub totale_potenziale: i64,
    pub totale_pagato: i64,
}

// --- Dashboard (FASE 6B): KPI + serie per i grafici ---------------------------

/// Un punto della serie «andamento ordini & incassi» (un bucket temporale).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashPuntoDto {
    /// Chiave ordinabile del bucket (ISO: `YYYY-MM` mensile o `YYYY-MM-DD` giornaliero).
    pub iso: String,
    /// Etichetta breve da mostrare sull'asse (`gen`, `feb`… oppure `gg/mm`).
    pub etichetta: String,
    pub ordini: i64,
    /// Valore ordini del bucket, in centesimi.
    pub valore: i64,
    /// Incassato (pagamenti saldati) nel bucket, in centesimi.
    pub incassato: i64,
}

/// Una fetta di distribuzione (per stato / per regione): chiave + conteggio + valore.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashFettaDto {
    pub chiave: String,
    pub n: i64,
    /// Valore aggregato della fetta, in centesimi.
    pub valore: i64,
}

/// Un agente nella classifica «top agenti» della dashboard.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashAgenteDto {
    pub agente_id: String,
    pub agente_nome: String,
    /// Valore ordini dell'agente nel periodo, in centesimi.
    pub valore: i64,
    /// Provvigioni **maturate** dell'agente nel periodo, in centesimi.
    pub provvigioni: i64,
}

/// Bundle completo della dashboard per un periodo `[dal, al]` (FASE 6B). I valori
/// «correnti» (da saldare, produzione) ignorano il periodo: fotografano lo stato attuale.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardStatsDto {
    // KPI nel periodo
    pub ordini_n: i64,
    pub ordini_valore: i64,
    /// Provvigioni maturate = soglia di stato raggiunta **oppure** già pagate all'agente.
    pub provv_maturato: i64,
    pub provv_potenziale: i64,
    // KPI correnti (stato attuale, fuori periodo)
    /// «Da saldare»: somma dei pagamenti **attesi** (come il tab Crediti), esclusi i
    /// preventivi (ordini «Nuovo») e i Rifiutati. Split per stato spedito dell'ordine.
    pub da_saldare_spediti: i64,
    pub da_saldare_non_spediti: i64,
    /// Numero di **prodotti** (righe d'ordine) in produzione / arrivati in Italia — non di
    /// ordini né di lotti (lo stato di produzione vive sulla riga, FASE 7).
    pub in_produzione: i64,
    pub in_arrivo: i64,
    // Serie e distribuzioni nel periodo
    pub andamento: Vec<DashPuntoDto>,
    pub per_stato: Vec<DashFettaDto>,
    pub per_regione: Vec<DashFettaDto>,
    pub top_agenti: Vec<DashAgenteDto>,
}

/// Pannelli operativi della dashboard: piccole liste già limitate lato backend.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardPanelsDto {
    pub ultimi_ordini: Vec<OrdineDto>,
    pub pagamenti_scaduti: Vec<PagamentoVistaDto>,
}

/// Collegamento già risolto verso un flusso esistente. Il frontend lo traduce
/// direttamente nel normale `DeepLink`, senza introdurre azioni parallele.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SuggerimentoCollegamentoDto {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tab: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apri_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub azione: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agente_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rimborso_stati: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub produzione_acconto: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provvigioni_ordina: Option<String>,
}

/// Azione utile derivata dallo stato corrente. Non è un record applicativo:
/// l'id incorpora la fotografia minima delle sorgenti e cambia solo quando il
/// suggerimento deve tornare proponibile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggerimentoDto {
    pub id: String,
    /// `rimborso`, `distinta`, `provvigione`, `produzione`, `spedizione`, `preventivo`.
    pub tipo: String,
    pub titolo: String,
    pub dettaglio: String,
    pub azione_label: String,
    /// Punteggio 0..100: prima urgenza, poi anzianità/importo.
    pub priorita: i64,
    pub collegamento: SuggerimentoCollegamentoDto,
    /// Data operativa più vecchia del gruppo, usata soltanto per la soglia locale
    /// dell'avviso. Vuota quando la sorgente non possiede una data di dominio.
    pub riferimento_data: String,
    /// Ultima modifica sostanziale delle sorgenti: impone una breve rivalidazione
    /// prima che il suggerimento possa diventare una notifica.
    pub aggiornato_ms: i64,
}

/// Il motore restituisce insieme i suggerimenti correnti e gli id nascosti dal
/// team. Il notificatore può così fondere la rilevazione duplicati locale, che
/// riusa il matcher TypeScript esistente, senza una seconda lettura dello stato.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggerimentiBundleDto {
    pub suggerimenti: Vec<SuggerimentoDto>,
    pub nascosti: Vec<String>,
    pub tipi_in_pausa: Vec<String>,
}

/// Preferenze FASE 14 ricevute dal singolo PC. Non sono mai scritte nella
/// proiezione condivisa e vengono validate prima di raggiungere il motore.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggerimentiPreferenzeInput {
    pub tipi_abilitati: Vec<String>,
    pub notifiche_attive: bool,
    pub giorni_avviso: HashMap<String, i64>,
    #[serde(default)]
    pub anno: i32,
}

/// Record generico verso il frontend (qualunque entità: anagrafiche, ordini…).
#[derive(Serialize)]
pub struct RecordDto {
    pub id: String,
    /// Revisione opaca del record (HLC dell'ultima modifica).
    pub revision: String,
    pub data: serde_json::Map<String, serde_json::Value>,
    pub deleted: bool,
}

/// Riga già esistente nello snapshot locale, usata per individuare le eliminazioni.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordIdInput {
    pub id: String,
}

/// Stato desiderato di una riga d'ordine. `id = None` crea una nuova riga.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrdineSalvaRigaInput {
    pub id: Option<String>,
    pub fields: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrdineSalvaRimborsoInput {
    pub id: String,
    pub importo: i64,
}

/// Salva testata e righe come un'unica operazione logica con patch per campo.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrdineSalvaBaseInput {
    pub id: Option<String>,
    #[serde(default)]
    pub rimborso_extra: Option<OrdineSalvaRimborsoInput>,
    pub expected_righe: Vec<RecordIdInput>,
    pub fields: serde_json::Map<String, serde_json::Value>,
    pub righe: Vec<OrdineSalvaRigaInput>,
}

/// Patch dei soli dati compilabili nel modale "Prepara la produzione".
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProduzioneRigaPatchInput {
    pub id: String,
    pub fields: serde_json::Map<String, serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrdineSalvaBaseResult {
    pub id: String,
    pub ordine: RecordDto,
    pub righe: Vec<RecordDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DedupClienteMergeInput {
    pub canonico_id: String,
    pub duplicati_ids: Vec<String>,
    #[serde(default)]
    pub fields: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub snapshots: HashMap<String, serde_json::Map<String, serde_json::Value>>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DedupClientiResult {
    pub gruppi: usize,
    pub merge_saltati: usize,
    pub campi_completati: usize,
    pub riferimenti_riassegnati: usize,
    pub clienti_purgati: usize,
}

/// Un elemento del Cestino (record soft-deleted, con la sua entità).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CestinoDto {
    pub entity: String,
    pub id: String,
    pub data: serde_json::Map<String, serde_json::Value>,
    /// Quando è stato eliminato (ms epoch, approssimato dall'ultimo aggiornamento).
    pub deleted_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PuliziaDatiArgs {
    /// inutili | clienti_morti | movimenti_periodo
    pub modalita: String,
    /// anno | prima_anno | mesi_12 | mesi_24 | mesi_36 | custom
    pub preset: String,
    pub anno: Option<i64>,
    pub dal: Option<String>,
    pub al: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PuliziaBloccoDto {
    pub titolo: String,
    pub dettaglio: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PuliziaPreviewDto {
    pub modalita: String,
    pub preset: String,
    pub dal: String,
    pub al: String,
    pub descrizione: String,
    pub conferma: String,
    pub totale_record: usize,
    pub conteggi: BTreeMap<String, usize>,
    pub blocchi: Vec<PuliziaBloccoDto>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PuliziaResultDto {
    pub purgati: usize,
    pub conteggi: BTreeMap<String, usize>,
    pub notifiche_ripulite: usize,
    pub tombstone_rimosse: usize,
    pub eventi_rimossi: usize,
    pub compattato: bool,
    pub backup: crate::backup::BackupInfo,
}

/// Una voce dello storico di un record.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoricoDto {
    pub ms: u64,
    pub user: String,
    pub device: String,
    /// `created | field_set | deleted | restored | purged`.
    pub op: String,
    pub field: Option<String>,
    pub value: Option<serde_json::Value>,
}
