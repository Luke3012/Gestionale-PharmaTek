//! Invio WhatsApp Desktop tramite Windows UI Automation.
//!
//! I punti di interazione vengono ricavati dai controlli riconosciuti: il click
//! viene eseguito soltanto dopo aver verificato finestra, conversazione,
//! compositore, testo preparato e pulsante di invio.

use std::collections::VecDeque;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::core::{w, BOOL, PCWSTR, PWSTR};
use windows::Win32::Foundation::{
    CloseHandle, GlobalFree, ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS, HANDLE, HGLOBAL, HWND,
    LPARAM, POINT,
};
use windows::Win32::Storage::Packaging::Appx::GetPackageFamilyName;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, IDataObject, CLSCTX_INPROC_SERVER,
    COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, SetClipboardData,
};
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};
use windows::Win32::System::Ole::{OleGetClipboard, OleSetClipboard, CF_HDROP, CF_UNICODETEXT};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
    CREATE_NO_WINDOW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationCondition, IUIAutomationElement,
    IUIAutomationInvokePattern, IUIAutomationTextPattern, IUIAutomationValuePattern,
    IUIAutomationWindowPattern, PropertyConditionFlags_MatchSubstring, TreeScope_Children,
    TreeScope_Descendants, UIA_ButtonControlTypeId, UIA_ControlTypePropertyId,
    UIA_EditControlTypeId, UIA_InvokePatternId, UIA_NamePropertyId, UIA_TextControlTypeId,
    UIA_TextPatternId, UIA_ValuePatternId, UIA_WindowPatternId, WindowVisualState_Minimized,
    UIA_PROPERTY_ID,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    mouse_event, GetLastInputInfo, SendInput, SetActiveWindow, INPUT, INPUT_0, INPUT_KEYBOARD,
    KEYBDINPUT, KEYEVENTF_KEYUP, LASTINPUTINFO, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    VIRTUAL_KEY, VK_A, VK_BACK, VK_CONTROL, VK_END, VK_ESCAPE, VK_RETURN, VK_V,
};
use windows::Win32::UI::Shell::DROPFILES;
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumWindows, FindWindowW, GetAncestor, GetCursorPos, GetForegroundWindow,
    GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SetCursorPos,
    SetForegroundWindow, SetWindowPos, ShowWindowAsync, WindowFromPoint, GA_ROOT, HWND_NOTOPMOST,
    HWND_TOPMOST, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_MINIMIZE, SW_RESTORE,
};

const ATTESA_APERTURA: Duration = Duration::from_secs(12);
const ATTESA_NORMALIZZAZIONE: Duration = Duration::from_secs(3);
const ATTESA_DEEPLINK_MINIMA: Duration = Duration::from_millis(250);
const PASSO_ATTESA: Duration = Duration::from_millis(60);
const QUIETE_UTENTE: Duration = Duration::from_millis(600);
const ATTESA_QUIETE_DOPO_APERTURA: Duration = Duration::from_secs(2);
const ATTESA_ANTEPRIMA_ALLEGATO: Duration = Duration::from_secs(5);
const ATTESA_CHIUSURA_ALLEGATO: Duration = Duration::from_secs(3);
const MARCATORE_APERTURA_CHAT: &str = "·pt";
const FASE_FINESTRA: &str = "finestra";
const FASE_CHAT: &str = "chat";
const FASE_COMPOSITORE: &str = "compositore";
const FASE_TESTO: &str = "testo";
const FASE_ALLEGATO: &str = "allegato";
const FASE_INVIO: &str = "invio";
const FASE_VERIFICA: &str = "verifica_finale";
const FASE_SICUREZZA: &str = "sicurezza";

#[derive(Debug, Clone, Default)]
struct FinestraWhatsappCache {
    hwnd: isize,
    pid: u32,
    processo: String,
    pacchetto: String,
    percorso: String,
    trovata_con_fallback: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsappUltimoEsitoDto {
    pub riuscito: bool,
    pub codice: String,
    pub fase: String,
    pub messaggio: String,
    pub esito_ambiguo: bool,
    pub attivita_utente: bool,
    pub durata_ms: u64,
    pub avvenuto_ms: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsappDiagnosticaDto {
    pub protocollo_registrato: bool,
    pub finestra_rilevata: bool,
    pub processo: String,
    pub pacchetto: String,
    pub versione: String,
    pub identificazione_fallback: bool,
    pub campioni_prestazioni: usize,
    pub mediana_ms: u64,
    pub percentile_95_ms: u64,
    pub ultimo_esito: Option<WhatsappUltimoEsitoDto>,
}

static FINESTRA_WHATSAPP_CACHE: OnceLock<Mutex<FinestraWhatsappCache>> = OnceLock::new();
static ULTIMO_ESITO_WHATSAPP: OnceLock<Mutex<Option<WhatsappUltimoEsitoDto>>> = OnceLock::new();
static PRESTAZIONI_WHATSAPP: OnceLock<Mutex<VecDeque<u64>>> = OnceLock::new();

fn cache_finestra() -> &'static Mutex<FinestraWhatsappCache> {
    FINESTRA_WHATSAPP_CACHE.get_or_init(|| Mutex::new(FinestraWhatsappCache::default()))
}

fn ultimo_esito() -> &'static Mutex<Option<WhatsappUltimoEsitoDto>> {
    ULTIMO_ESITO_WHATSAPP.get_or_init(|| Mutex::new(None))
}

fn prestazioni() -> &'static Mutex<VecDeque<u64>> {
    PRESTAZIONI_WHATSAPP.get_or_init(|| Mutex::new(VecDeque::with_capacity(64)))
}

fn riepiloga_prestazioni(campioni: &VecDeque<u64>) -> (u64, u64) {
    if campioni.is_empty() {
        return (0, 0);
    }
    let mut ordinati = campioni.iter().copied().collect::<Vec<_>>();
    ordinati.sort_unstable();
    let mediana = ordinati[ordinati.len() / 2];
    let indice_95 = ((ordinati.len() - 1) * 95).div_ceil(100);
    (mediana, ordinati[indice_95])
}

const NOMI_INVIA: &[&str] = &["Invia", "Invia messaggio", "Send", "Send message"];
const NOMI_INVIA_ALLEGATO: &[&str] = &["Invia 1 selezionato", "Send 1 selected"];
const NOMI_CHIUDI_ALLEGATO: &[&str] = &[
    "Chiudi",
    "Close attachment preview",
    "Close media preview",
    "Close document preview",
];
const NOMI_CONFERMA_INTERRUZIONE: &[&str] = &[
    "Interrompi",
    "Interrompi azione",
    "Annulla invio",
    "Abbandona",
    "Scarta",
    "Elimina",
    "Conferma",
    "Sì",
    "Si",
    "Stop",
    "Stop action",
    "Discard",
    "Discard action",
    "Leave",
    "Yes",
];
const PREFISSI_COMPOSITORE: &[&str] = &[
    "Digita un messaggio",
    "Scrivi un messaggio",
    "Type a message",
    "Write a message",
];
const NOMI_DIDASCALIA: &[&str] = &[
    "Didascalia",
    "Aggiungi una didascalia",
    "Scrivi una didascalia",
    "Scrivi un messaggio",
    "Caption",
    "Add a caption",
    "Type a caption",
    "Type a message",
];
const NOMI_VOCALE: &[&str] = &[
    "Messaggio vocale",
    "Registra messaggio vocale",
    "Registra un messaggio vocale",
    "Voice message",
    "Record voice message",
    "Record a voice message",
];

#[derive(Clone)]
struct ControlliCompositore {
    finestra: IUIAutomationElement,
    compositore: IUIAutomationElement,
    invia: IUIAutomationElement,
}

#[derive(Debug)]
pub(super) struct ErroreWhatsAppWindows {
    pub messaggio: String,
    pub codice: String,
    pub fase: String,
    /// True soltanto se il pulsante è già stato azionato e l'esito non è
    /// verificabile: in quel caso il gestionale non deve ritentare da solo.
    pub esito_ambiguo: bool,
    /// L'operatore ha ripreso mouse o tastiera: l'elemento deve restare in
    /// coda, senza essere contato o mostrato come fallimento.
    pub attivita_utente: bool,
}

#[derive(Debug)]
pub(super) struct DestinazioneWhatsAppWindows {
    nome_compositore: String,
}

struct ComApartment;

impl ComApartment {
    fn init() -> Result<Self, ErroreWhatsAppWindows> {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .ok()
                .map_err(|error| {
                    errore(
                        false,
                        format!("Windows UI Automation non disponibile: {error}"),
                    )
                })?;
        }
        Ok(Self)
    }
}

struct RipristinoAppunti(Option<IDataObject>);

impl Drop for RipristinoAppunti {
    fn drop(&mut self) {
        if let Some(precedente) = self.0.take() {
            let _ = unsafe { OleSetClipboard(&precedente) };
        }
    }
}

struct AppuntiAperti;

impl Drop for AppuntiAperti {
    fn drop(&mut self) {
        let _ = unsafe { CloseClipboard() };
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

fn classifica_errore(messaggio: &str) -> (&'static str, &'static str) {
    let testo = messaggio.to_lowercase();
    if testo.contains("pc in uso")
        || testo.contains("primo piano")
        || testo.contains("mouse")
        || testo.contains("tastiera")
    {
        ("pc_in_uso", FASE_SICUREZZA)
    } else if testo.contains("non risulta associato") || testo.contains("destinatario") {
        ("chat_non_verificata", FASE_CHAT)
    } else if testo.contains("allegato")
        || testo.contains("anteprima")
        || testo.contains("didascalia")
        || testo.contains("documento")
    {
        ("allegato_non_verificato", FASE_ALLEGATO)
    } else if testo.contains("pulsante invia") || testo.contains("comando invia") {
        ("invio_non_verificato", FASE_INVIO)
    } else if testo.contains("compositore") || testo.contains("campo messaggio") {
        ("compositore_non_verificato", FASE_COMPOSITORE)
    } else if testo.contains("testo") || testo.contains("appunti") {
        ("testo_non_verificato", FASE_TESTO)
    } else if testo.contains("finestra") || testo.contains("automation") {
        ("finestra_non_verificata", FASE_FINESTRA)
    } else if esito_finale_in_verifica(&testo) {
        ("esito_non_verificato", FASE_VERIFICA)
    } else {
        ("automazione_non_riuscita", FASE_VERIFICA)
    }
}

fn esito_finale_in_verifica(testo: &str) -> bool {
    testo.contains("svuot") || testo.contains("ricevuto") || testo.contains("verifica la chat")
}

fn errore(esito_ambiguo: bool, messaggio: impl Into<String>) -> ErroreWhatsAppWindows {
    let messaggio = messaggio.into();
    let (codice, fase) = classifica_errore(&messaggio);
    ErroreWhatsAppWindows {
        messaggio,
        codice: codice.into(),
        fase: fase.into(),
        esito_ambiguo,
        attivita_utente: false,
    }
}

fn errore_attivita_utente() -> ErroreWhatsAppWindows {
    ErroreWhatsAppWindows {
        messaggio: "Invio WhatsApp in attesa: il PC è in uso. La coda riprenderà automaticamente."
            .into(),
        codice: "pc_in_uso".into(),
        fase: FASE_SICUREZZA.into(),
        esito_ambiguo: false,
        attivita_utente: true,
    }
}

fn errore_annullamento() -> ErroreWhatsAppWindows {
    ErroreWhatsAppWindows {
        messaggio: "Invio WhatsApp annullato.".into(),
        codice: "invio_annullato".into(),
        fase: FASE_SICUREZZA.into(),
        esito_ambiguo: false,
        attivita_utente: false,
    }
}

fn registra_esito(riuscito: bool, error: Option<&ErroreWhatsAppWindows>, durata: Duration) {
    let durata_ms = durata.as_millis().min(u128::from(u64::MAX)) as u64;
    let (codice, fase, messaggio, esito_ambiguo, attivita_utente) = error
        .map(|value| {
            (
                value.codice.clone(),
                value.fase.clone(),
                value.messaggio.clone(),
                value.esito_ambiguo,
                value.attivita_utente,
            )
        })
        .unwrap_or_else(|| {
            (
                "ok".into(),
                "completato".into(),
                String::new(),
                false,
                false,
            )
        });
    *ultimo_esito()
        .lock()
        .expect("whatsapp diagnostics poisoned") = Some(WhatsappUltimoEsitoDto {
        riuscito,
        codice,
        fase,
        messaggio,
        esito_ambiguo,
        attivita_utente,
        durata_ms,
        avvenuto_ms: super::now_ms(),
    });
    if riuscito {
        let mut campioni = prestazioni().lock().expect("whatsapp performance poisoned");
        if campioni.len() == 64 {
            campioni.pop_front();
        }
        campioni.push_back(durata_ms);
    }
}

pub(super) fn registra_errore_esterno(codice: &str, fase: &str, messaggio: &str, durata: Duration) {
    registra_esito(
        false,
        Some(&ErroreWhatsAppWindows {
            messaggio: messaggio.into(),
            codice: codice.into(),
            fase: fase.into(),
            esito_ambiguo: false,
            attivita_utente: false,
        }),
        durata,
    );
}

pub(super) fn registra_collaudo_completato(durata: Duration) {
    registra_esito(true, None, durata);
    if let Some(esito) = ultimo_esito()
        .lock()
        .expect("whatsapp diagnostics poisoned")
        .as_mut()
    {
        esito.codice = "collaudo_completato".into();
        esito.fase = "collaudo".into();
    }
}

pub(super) fn marcatore_input_utente() -> Option<u32> {
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        ..Default::default()
    };
    if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        return None;
    }
    Some(info.dwTime)
}

fn inattivita_utente() -> Option<Duration> {
    let ultimo_input = marcatore_input_utente()?;
    let trascorsi = unsafe { GetTickCount() }.wrapping_sub(ultimo_input);
    Some(Duration::from_millis(u64::from(trascorsi)))
}

pub(super) fn pc_pronto_per_whatsapp() -> bool {
    inattivita_utente().is_some_and(|durata| durata >= QUIETE_UTENTE)
}

pub(super) fn pc_pronto_per_whatsapp_con_autorizzazione(autorizzazione_input: Option<u32>) -> bool {
    pc_pronto_per_whatsapp()
        || autorizzazione_input
            .zip(marcatore_input_utente())
            .is_some_and(|(autorizzato, corrente)| autorizzato == corrente)
}

fn verifica_pc_libero(autorizzazione_input: Option<u32>) -> Result<(), ErroreWhatsAppWindows> {
    if pc_pronto_per_whatsapp_con_autorizzazione(autorizzazione_input) {
        Ok(())
    } else {
        Err(errore_attivita_utente())
    }
}

/// L'attivazione del protocollo `whatsapp://` può produrre un breve input
/// sintetico di Windows. Non differiamo subito l'invio: aspettiamo che il
/// marcatore si stabilizzi, continuando però a interrompere se l'operatore usa
/// davvero mouse o tastiera oltre la breve finestra di assestamento.
fn attendi_pc_libero_dopo_apertura(
    autorizzazione_input: Option<u32>,
) -> Result<(), ErroreWhatsAppWindows> {
    let scadenza = Instant::now() + ATTESA_QUIETE_DOPO_APERTURA;
    loop {
        if pc_pronto_per_whatsapp_con_autorizzazione(autorizzazione_input) {
            return Ok(());
        }
        if Instant::now() >= scadenza {
            return Err(errore_attivita_utente());
        }
        thread::sleep(PASSO_ATTESA);
    }
}

fn verifica_input_invariato(marcatore: Option<u32>) -> Result<(), ErroreWhatsAppWindows> {
    if marcatore
        .zip(marcatore_input_utente())
        .is_some_and(|(prima, adesso)| prima == adesso)
    {
        Ok(())
    } else {
        Err(errore_attivita_utente())
    }
}

fn diagnostica_tempi(attiva: bool, iniziato: Instant, fase: &str) {
    if attiva {
        eprintln!("whatsapp-ui {} ms: {fase}", iniziato.elapsed().as_millis());
    }
}

fn condizione_proprieta(
    automation: &IUIAutomation,
    property: UIA_PROPERTY_ID,
    value: &VARIANT,
) -> windows::core::Result<IUIAutomationCondition> {
    unsafe { automation.CreatePropertyCondition(property, value) }
}

fn condizione_proprieta_contiene(
    automation: &IUIAutomation,
    property: UIA_PROPERTY_ID,
    value: &str,
) -> windows::core::Result<IUIAutomationCondition> {
    unsafe {
        automation.CreatePropertyConditionEx(
            property,
            &VARIANT::from(value),
            PropertyConditionFlags_MatchSubstring,
        )
    }
}

fn condizione_controllo(
    automation: &IUIAutomation,
    control_type: i32,
) -> windows::core::Result<IUIAutomationCondition> {
    condizione_proprieta(
        automation,
        UIA_ControlTypePropertyId,
        &VARIANT::from(control_type),
    )
}

fn elementi_per_controllo(
    automation: &IUIAutomation,
    finestra: &IUIAutomationElement,
    control_type: i32,
) -> windows::core::Result<Vec<IUIAutomationElement>> {
    let condizione = condizione_controllo(automation, control_type)?;
    let elementi = unsafe { finestra.FindAll(TreeScope_Descendants, &condizione)? };
    let mut trovati = Vec::new();
    let mut chiavi = std::collections::HashSet::new();
    for indice in 0..unsafe { elementi.Length()? } {
        let elemento = unsafe { elementi.GetElement(indice)? };
        let rettangolo = unsafe { elemento.CurrentBoundingRectangle() }.unwrap_or_default();
        let chiave = (
            nome(&elemento),
            rettangolo.left,
            rettangolo.top,
            rettangolo.right,
            rettangolo.bottom,
        );
        if chiavi.insert(chiave) {
            trovati.push(elemento);
        }
    }
    Ok(trovati)
}

fn compositore_messaggio(
    automation: &IUIAutomation,
    finestra: &IUIAutomationElement,
) -> windows::core::Result<Option<IUIAutomationElement>> {
    let condizioni_nome = PREFISSI_COMPOSITORE
        .iter()
        .map(|prefisso| {
            condizione_proprieta_contiene(automation, UIA_NamePropertyId, prefisso).map(Some)
        })
        .collect::<windows::core::Result<Vec<_>>>()?;
    let condizione_nome = unsafe { automation.CreateOrConditionFromNativeArray(&condizioni_nome)? };
    let condizione_tipo = condizione_controllo(automation, UIA_EditControlTypeId.0)?;
    let condizione = unsafe { automation.CreateAndCondition(&condizione_tipo, &condizione_nome)? };
    Ok(
        unsafe { finestra.FindFirst(TreeScope_Descendants, &condizione) }
            .ok()
            .filter(elemento_visibile)
            .filter(elemento_con_area_valida),
    )
}

fn compositore_messaggio_fallback(
    automation: &IUIAutomation,
    finestra: &IUIAutomationElement,
) -> windows::core::Result<Option<IUIAutomationElement>> {
    let rettangolo_finestra = unsafe { finestra.CurrentBoundingRectangle()? };
    let mut candidati = elementi_per_controllo(automation, finestra, UIA_EditControlTypeId.0)?
        .into_iter()
        .filter(elemento_visibile)
        .filter_map(|elemento| {
            let rettangolo = unsafe { elemento.CurrentBoundingRectangle() }.ok()?;
            let larghezza = rettangolo.right.saturating_sub(rettangolo.left);
            let altezza = rettangolo.bottom.saturating_sub(rettangolo.top);
            let nella_meta_inferiore = rettangolo.top
                >= rettangolo_finestra.top
                    + (rettangolo_finestra.bottom - rettangolo_finestra.top) / 2;
            let ha_pattern_testo = unsafe {
                elemento.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            }
            .is_ok()
                || unsafe {
                    elemento.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
                }
                .is_ok();
            (larghezza >= 120
                && (18..=320).contains(&altezza)
                && nella_meta_inferiore
                && ha_pattern_testo)
                .then_some((
                    unsafe { elemento.CurrentHasKeyboardFocus() }
                        .map(|value| value.as_bool())
                        .unwrap_or(false),
                    rettangolo.bottom,
                    elemento,
                ))
        })
        .collect::<Vec<_>>();
    candidati.sort_by_key(|(focus, bottom, _)| (*focus, *bottom));
    Ok(candidati.pop().map(|(_, _, elemento)| elemento))
}

fn nome_indica_compositore_messaggio(value: &str) -> bool {
    let value = value.to_lowercase();
    PREFISSI_COMPOSITORE
        .iter()
        .any(|prefisso| value.contains(&prefisso.to_lowercase()))
}

fn condizione_pulsanti_per_nomi(
    automation: &IUIAutomation,
    nomi: &[&str],
) -> windows::core::Result<IUIAutomationCondition> {
    let condizioni_nome = nomi
        .iter()
        .map(|nome| {
            condizione_proprieta(automation, UIA_NamePropertyId, &VARIANT::from(*nome)).map(Some)
        })
        .collect::<windows::core::Result<Vec<_>>>()?;
    let condizione_nome = unsafe { automation.CreateOrConditionFromNativeArray(&condizioni_nome)? };
    let condizione_tipo = condizione_controllo(automation, UIA_ButtonControlTypeId.0)?;
    unsafe { automation.CreateAndCondition(&condizione_tipo, &condizione_nome) }
}

fn pulsanti_per_nomi(
    automation: &IUIAutomation,
    finestra: &IUIAutomationElement,
    nomi: &[&str],
) -> windows::core::Result<Vec<IUIAutomationElement>> {
    let condizione = condizione_pulsanti_per_nomi(automation, nomi)?;
    let elementi = unsafe { finestra.FindAll(TreeScope_Descendants, &condizione)? };
    let mut trovati = Vec::new();
    let mut chiavi = std::collections::HashSet::new();
    for indice in 0..unsafe { elementi.Length()? } {
        let elemento = unsafe { elementi.GetElement(indice)? };
        let rettangolo = unsafe { elemento.CurrentBoundingRectangle() }.unwrap_or_default();
        let chiave = (
            nome(&elemento),
            rettangolo.left,
            rettangolo.top,
            rettangolo.right,
            rettangolo.bottom,
        );
        if chiavi.insert(chiave) {
            trovati.push(elemento);
        }
    }
    Ok(trovati)
}

fn primo_pulsante_per_nomi(
    automation: &IUIAutomation,
    finestra: &IUIAutomationElement,
    nomi: &[&str],
) -> windows::core::Result<Option<IUIAutomationElement>> {
    let condizione = condizione_pulsanti_per_nomi(automation, nomi)?;
    Ok(
        unsafe { finestra.FindFirst(TreeScope_Descendants, &condizione) }
            .ok()
            .filter(|pulsante| {
                unsafe { pulsante.CurrentIsEnabled() }
                    .map(|value| value.as_bool())
                    .unwrap_or(false)
                    && elemento_visibile(pulsante)
            }),
    )
}

fn pulsanti_compositore(
    automation: &IUIAutomation,
    finestra: &IUIAutomationElement,
    richiedi_invia: bool,
) -> windows::core::Result<Vec<IUIAutomationElement>> {
    let nomi = if richiedi_invia {
        NOMI_INVIA.to_vec()
    } else {
        NOMI_INVIA
            .iter()
            .chain(NOMI_VOCALE.iter())
            .copied()
            .collect::<Vec<_>>()
    };
    pulsanti_per_nomi(automation, finestra, &nomi)
}

fn controlli_per_compositore(
    automation: &IUIAutomation,
    finestra: &IUIAutomationElement,
    compositore: IUIAutomationElement,
    richiedi_invia: bool,
) -> windows::core::Result<Option<ControlliCompositore>> {
    // WebView2 può lasciare per pochi istanti nell'albero il compositore della
    // chat precedente con rettangolo vuoto. Non deve diventare un errore
    // definitivo: scartandolo qui il ciclo di ricerca può prendere il nodo
    // corrente senza introdurre attese aggiuntive.
    if !elemento_con_area_valida(&compositore) {
        return Ok(None);
    }
    if !richiedi_invia {
        // Nelle build recenti il contenteditable corrente e i pulsanti
        // microfono/Invia possono provenire da due snapshot UIA diversi: il
        // primo ha coordinate reali, i secondi coordinate fuori schermo.
        // Per preparare il testo basta il compositore verificato; l'invio del
        // testo usa Enter soltanto dopo focus, destinatario e contenuto esatto.
        return Ok(Some(ControlliCompositore {
            finestra: finestra.clone(),
            invia: compositore.clone(),
            compositore,
        }));
    }
    let walker = unsafe { automation.ControlViewWalker()? };
    let mut antenato = compositore.clone();
    for _ in 0..6 {
        let Ok(padre) = (unsafe { walker.GetParentElement(&antenato) }) else {
            break;
        };
        let pulsanti = pulsanti_compositore(automation, &padre, richiedi_invia)?;
        if let Some(invia) = trova_pulsanti_compositore(&pulsanti, richiedi_invia)
            .into_iter()
            .find(|pulsante| pulsante_accanto_al_compositore(pulsante, &compositore))
        {
            return Ok(Some(ControlliCompositore {
                finestra: finestra.clone(),
                compositore,
                invia,
            }));
        }
        antenato = padre;
    }
    if richiedi_invia {
        let mut candidati =
            elementi_per_controllo(automation, finestra, UIA_ButtonControlTypeId.0)?
                .into_iter()
                .filter(elemento_visibile)
                .filter(|pulsante| pulsante_accanto_al_compositore(pulsante, &compositore))
                .filter(|pulsante| {
                    unsafe { pulsante.CurrentIsEnabled() }
                        .map(|value| value.as_bool())
                        .unwrap_or(false)
                        && unsafe {
                            pulsante.GetCurrentPatternAs::<IUIAutomationInvokePattern>(
                                UIA_InvokePatternId,
                            )
                        }
                        .is_ok()
                })
                .collect::<Vec<_>>();
        candidati.sort_by_key(|pulsante| {
            unsafe { pulsante.CurrentBoundingRectangle() }
                .map(|rettangolo| rettangolo.left)
                .unwrap_or_default()
        });
        if let Some(invia) = candidati.pop() {
            return Ok(Some(ControlliCompositore {
                finestra: finestra.clone(),
                compositore,
                invia,
            }));
        }
    }
    Ok(None)
}

fn controlli_compositore_focalizzato(
    automation: &IUIAutomation,
    finestra: &IUIAutomationElement,
    richiedi_invia: bool,
    numero: &str,
    destinatario: &str,
    corpo: &str,
) -> windows::core::Result<Option<ControlliCompositore>> {
    let compositore = match unsafe { automation.GetFocusedElement() } {
        Ok(elemento)
            if elemento_visibile(&elemento)
                && elemento_con_area_valida(&elemento)
                && unsafe { elemento.CurrentControlType() }
                    .map(|tipo| tipo == UIA_EditControlTypeId)
                    .unwrap_or(false)
                && nome_indica_compositore_messaggio(&nome(&elemento))
                && ((numero.is_empty() && destinatario.is_empty())
                    || (!corpo.is_empty()
                        && compositore_contiene_testo(automation, &elemento, corpo))
                    || finestra_mostra_destinatario(
                        automation,
                        finestra,
                        &elemento,
                        numero,
                        destinatario,
                    )) =>
        {
            elemento
        }
        _ => return Ok(None),
    };
    controlli_per_compositore(automation, finestra, compositore, richiedi_invia)
}

fn nome(element: &IUIAutomationElement) -> String {
    unsafe { element.CurrentName() }
        .map(|value| value.to_string())
        .unwrap_or_default()
}

fn normalizza_testo(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(|riga| {
            let riga = riga.trim_start();
            // WhatsApp converte automaticamente "- " a inizio riga in un
            // elenco ricco. UI Automation restituisce quindi un pallino anche
            // se il testo affidato al compositore conteneva il trattino. Sono
            // due rappresentazioni dello stesso contenuto visibile.
            ["- ", "• ", "· "]
                .iter()
                .find_map(|prefisso| riga.strip_prefix(prefisso))
                .map(|contenuto| format!("• {}", contenuto.trim_start()))
                .unwrap_or_else(|| riga.to_string())
        })
        .collect::<Vec<_>>()
        .join("\n")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Evita che WhatsApp trasformi `- ` a inizio riga in un elenco rich-text.
/// Quella trasformazione aggiunge un elemento vuoto quando il blocco è seguito
/// da una riga bianca, alterando sia l'impaginazione sia il testo verificato.
fn testo_senza_elenchi_automatici(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(|riga| {
            riga.strip_prefix("- ")
                .map(|contenuto| format!("• {contenuto}"))
                .unwrap_or_else(|| riga.to_string())
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalizza_identita(value: &str) -> String {
    value
        .chars()
        .flat_map(char::to_lowercase)
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn destinazione_allegato_invariata(attesa: &str, attuale: &str) -> bool {
    !attesa.is_empty() && normalizza_identita(attuale) == attesa
}

fn testo_indica_modalita_allegato(value: &str) -> bool {
    let testo = normalizza_identita(value);
    matches!(
        testo.as_str(),
        "didascalia"
            | "aggiungi una didascalia"
            | "scrivi una didascalia"
            | "caption"
            | "add a caption"
            | "type a caption"
            | "anteprima allegato"
            | "anteprima documento"
            | "attachment preview"
            | "document preview"
            | "media preview"
            | "annulla allegato"
            | "rimuovi allegato"
            | "close attachment preview"
            | "discard attachment"
            | "remove attachment"
    ) || (testo.contains("didascalia") && (testo.contains("aggiungi") || testo.contains("scrivi")))
        || (testo.contains("caption") && (testo.contains("add") || testo.contains("type")))
}

fn compositore_didascalia(
    automation: &IUIAutomation,
    finestra: &IUIAutomationElement,
    invia: &IUIAutomationElement,
) -> windows::core::Result<Option<IUIAutomationElement>> {
    let rettangolo_invia = unsafe { invia.CurrentBoundingRectangle() }?;
    let condizioni_nome = NOMI_DIDASCALIA
        .iter()
        .map(|nome| {
            condizione_proprieta(automation, UIA_NamePropertyId, &VARIANT::from(*nome)).map(Some)
        })
        .collect::<windows::core::Result<Vec<_>>>()?;
    let condizione_nome = unsafe { automation.CreateOrConditionFromNativeArray(&condizioni_nome)? };
    let condizione_tipo = condizione_controllo(automation, UIA_EditControlTypeId.0)?;
    let condizione = unsafe { automation.CreateAndCondition(&condizione_tipo, &condizione_nome)? };
    let elementi = unsafe { finestra.FindAll(TreeScope_Descendants, &condizione)? };
    let mut candidati = (0..unsafe { elementi.Length()? })
        .filter_map(|indice| unsafe { elementi.GetElement(indice) }.ok())
        .filter(elemento_visibile)
        .filter_map(|elemento| {
            let nome_elemento = nome(&elemento);
            if !testo_indica_modalita_allegato(&nome_elemento)
                && !nome_indica_compositore_messaggio(&nome_elemento)
            {
                return None;
            }
            let rettangolo = unsafe { elemento.CurrentBoundingRectangle() }.ok()?;
            let valido = rettangolo.right > rettangolo.left
                && rettangolo.bottom > rettangolo.top
                && rettangolo.left < rettangolo_invia.left
                // Il compositore principale resta pubblicato sotto l'overlay.
                // La didascalia è invece interamente sopra al pulsante verde.
                && rettangolo.bottom <= rettangolo_invia.top
                && rettangolo_invia.top.saturating_sub(rettangolo.bottom) <= 400;
            valido.then_some((
                rettangolo_invia.top.saturating_sub(rettangolo.bottom),
                elemento,
            ))
        })
        .collect::<Vec<_>>();
    candidati.sort_by_key(|(distanza, _)| *distanza);
    Ok(candidati.into_iter().next().map(|(_, elemento)| elemento))
}

#[cfg(test)]
fn testo_chiede_interruzione(value: &str) -> bool {
    let testo = normalizza_identita(value);
    testo.contains("interrompere l azione in corso")
        || testo.contains("interrompere l azione corrente")
        || testo.contains("interrompi l azione in corso")
        || testo.contains("annullare l azione in corso")
        || testo.contains("vuoi interrompere")
        || testo.contains("vuoi annullare l invio")
        || testo.contains("vuoi eliminare la selezione")
        || testo.contains("eliminare la selezione")
        || testo.contains("stop the current action")
        || testo.contains("cancel the current action")
        || testo.contains("discard the current action")
        || testo.contains("discard unsent")
        || testo.contains("discard current unsent")
}

fn nome_pulsante_conferma_interruzione(value: &str) -> bool {
    let testo = normalizza_identita(value);
    matches!(
        testo.as_str(),
        "interrompi"
            | "interrompi azione"
            | "annulla invio"
            | "abbandona"
            | "scarta"
            | "elimina"
            | "conferma"
            | "si"
            | "sì"
            | "stop"
            | "stop action"
            | "discard"
            | "discard action"
            | "leave"
            | "yes"
    ) || testo.starts_with("interrompi ")
        || (testo.starts_with("si ") || testo.starts_with("sì ")) && testo.contains("interrompi")
        || testo.starts_with("discard ")
}

fn nome_pulsante_chiudi_allegato(value: &str) -> bool {
    matches!(
        normalizza_identita(value).as_str(),
        "chiudi" | "close attachment preview" | "close media preview" | "close document preview"
    )
}

fn testo_indica_numero_non_whatsapp(value: &str) -> bool {
    let testo = normalizza_identita(value);
    testo.contains("non è su whatsapp")
        || testo.contains("non e su whatsapp")
        || testo.contains("is not on whatsapp")
        || testo.contains("isn t on whatsapp")
        || testo.contains("isnt on whatsapp")
}

fn chiudi_avviso_numero_non_whatsapp(
    automation: &IUIAutomation,
    finestra: &IUIAutomationElement,
) -> bool {
    let Ok(pulsanti) = pulsanti_per_nomi(automation, finestra, &["OK", "Ok"]) else {
        return false;
    };
    let Some(ok) = pulsanti.iter().find(|pulsante| {
        unsafe { pulsante.CurrentIsOffscreen() }
            .map(|value| !value.as_bool())
            .unwrap_or(true)
    }) else {
        return false;
    };
    let chiuso_con_invoke = if let Ok(pattern) =
        unsafe { ok.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) }
    {
        unsafe { pattern.Invoke() }.is_ok()
    } else {
        false
    };
    if !chiuso_con_invoke {
        let Ok(rettangolo) = (unsafe { ok.CurrentBoundingRectangle() }) else {
            return true;
        };
        if rettangolo.right > rettangolo.left && rettangolo.bottom > rettangolo.top {
            let Ok(hwnd) = (unsafe { finestra.CurrentNativeWindowHandle() }) else {
                return false;
            };
            let punto = POINT {
                x: rettangolo.left + (rettangolo.right - rettangolo.left) / 2,
                y: rettangolo.top + (rettangolo.bottom - rettangolo.top) / 2,
            };
            if clicca_punto_whatsapp_verificato(hwnd, punto, "il pulsante OK").is_err() {
                return false;
            }
        }
    }
    true
}

fn rileva_numero_non_whatsapp(automation: &IUIAutomation) -> bool {
    let Ok(finestre) = finestre_whatsapp(automation) else {
        return false;
    };
    for finestra in finestre {
        let condizioni_testo = [
            "non è su WhatsApp",
            "non e su WhatsApp",
            "is not on WhatsApp",
            "isn't on WhatsApp",
        ]
        .iter()
        .filter_map(|frammento| {
            condizione_proprieta_contiene(automation, UIA_NamePropertyId, frammento)
                .ok()
                .map(Some)
        })
        .collect::<Vec<_>>();
        let trovato = if condizioni_testo.is_empty() {
            false
        } else {
            unsafe {
                automation
                    .CreateOrConditionFromNativeArray(&condizioni_testo)
                    .and_then(|condizione| finestra.FindFirst(TreeScope_Descendants, &condizione))
            }
            .ok()
            .filter(elemento_visibile)
            .is_some_and(|elemento| testo_indica_numero_non_whatsapp(&nome(&elemento)))
        };
        if trovato {
            // Chiudere il dialog consente alla coda di passare subito al
            // destinatario successivo. Richiedere anche il suo pulsante OK
            // evita di scambiare per popup una frase presente nella chat.
            if chiudi_avviso_numero_non_whatsapp(automation, &finestra) {
                return true;
            }
        }
    }
    false
}

fn focus_indica_avviso_numero_non_whatsapp(automation: &IUIAutomation) -> bool {
    let Ok(elemento) = (unsafe { automation.GetFocusedElement() }) else {
        return false;
    };
    let nome = nome(&elemento);
    normalizza_identita(&nome) == "ok" || testo_indica_numero_non_whatsapp(&nome)
}

fn cifre(value: &str) -> String {
    value.chars().filter(char::is_ascii_digit).collect()
}

fn intestazione_corrisponde(nome_visibile: &str, numero: &str, destinatario: &str) -> bool {
    let cifre_visibili = cifre(nome_visibile);
    let cifre_numero = cifre(numero);
    let coda_numero = cifre_numero
        .len()
        .checked_sub(8)
        .map(|start| &cifre_numero[start..])
        .unwrap_or(cifre_numero.as_str());
    if coda_numero.len() >= 8 && cifre_visibili.contains(coda_numero) {
        return true;
    }

    let visibile = normalizza_identita(nome_visibile);
    let atteso = normalizza_identita(destinatario);
    if atteso.is_empty() {
        return false;
    }
    if visibile.contains(&atteso) {
        return true;
    }
    let parole = atteso
        .split_whitespace()
        .filter(|parola| parola.chars().count() >= 3)
        .collect::<Vec<_>>();
    let minimo = parole.len().min(2);
    minimo > 0
        && parole
            .iter()
            .filter(|parola| visibile.contains(**parola))
            .count()
            >= minimo
}

fn finestra_mostra_destinatario(
    automation: &IUIAutomation,
    finestra: &IUIAutomationElement,
    compositore: &IUIAutomationElement,
    numero: &str,
    destinatario: &str,
) -> bool {
    if intestazione_corrisponde(&nome(compositore), numero, destinatario) {
        return true;
    }
    let Ok(rettangolo_finestra) = (unsafe { finestra.CurrentBoundingRectangle() }) else {
        return false;
    };
    let Ok(rettangolo_compositore) = (unsafe { compositore.CurrentBoundingRectangle() }) else {
        return false;
    };
    let spazio_sopra = rettangolo_compositore
        .top
        .saturating_sub(rettangolo_finestra.top);
    let limite_intestazione = rettangolo_finestra
        .top
        .saturating_add((spazio_sopra / 3).clamp(120, 360));

    // Nelle versioni recenti di WhatsApp Desktop il nome accessibile del
    // contenteditable è soltanto “Scrivi un messaggio”; destinatario e numero
    // sono nodi separati nell'intestazione della chat.
    [UIA_TextControlTypeId.0, UIA_ButtonControlTypeId.0]
        .into_iter()
        .filter_map(|tipo| elementi_per_controllo(automation, finestra, tipo).ok())
        .flatten()
        .filter(elemento_visibile)
        .any(|elemento| {
            unsafe { elemento.CurrentBoundingRectangle() }.is_ok_and(|rettangolo| {
                rettangolo.bottom > rettangolo.top
                    && rettangolo.top >= rettangolo_finestra.top
                    && rettangolo.bottom <= limite_intestazione
            }) && intestazione_corrisponde(&nome(&elemento), numero, destinatario)
        })
}

fn hwnd_da_cache() -> Option<HWND> {
    let cache = cache_finestra()
        .lock()
        .expect("whatsapp window cache poisoned")
        .clone();
    if cache.hwnd == 0 {
        return None;
    }
    let hwnd = HWND(cache.hwnd as *mut std::ffi::c_void);
    if !unsafe { IsWindow(Some(hwnd)) }.as_bool() || !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        *cache_finestra()
            .lock()
            .expect("whatsapp window cache poisoned") = FinestraWhatsappCache::default();
        return None;
    }
    let mut pid = 0_u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    (pid != 0 && pid == cache.pid).then_some(hwnd)
}

fn percorso_processo(pid: u32) -> Option<String> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buffer = vec![0_u16; 32_768];
    let mut len = buffer.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &mut len,
        )
    };
    let _ = unsafe { CloseHandle(handle) };
    result.ok()?;
    Some(String::from_utf16_lossy(&buffer[..len as usize]))
}

fn famiglia_pacchetto_processo(pid: u32) -> Option<String> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut len = 0_u32;
    let prima_lettura = unsafe { GetPackageFamilyName(handle, &mut len, None) };
    if prima_lettura != ERROR_INSUFFICIENT_BUFFER || len == 0 {
        let _ = unsafe { CloseHandle(handle) };
        return None;
    }
    let mut buffer = vec![0_u16; len as usize];
    let risultato =
        unsafe { GetPackageFamilyName(handle, &mut len, Some(PWSTR(buffer.as_mut_ptr()))) };
    let _ = unsafe { CloseHandle(handle) };
    if risultato != ERROR_SUCCESS || len == 0 {
        return None;
    }
    let fine = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..fine]))
}

fn descrivi_finestra(hwnd: HWND, fallback: bool) -> Option<FinestraWhatsappCache> {
    if hwnd.0.is_null() || !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return None;
    }
    let mut pid = 0_u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return None;
    }
    let percorso = fallback
        .then(|| percorso_processo(pid))
        .flatten()
        .unwrap_or_default();
    let pacchetto = fallback
        .then(|| famiglia_pacchetto_processo(pid))
        .flatten()
        .unwrap_or_default();
    let processo = Path::new(&percorso)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(if fallback { "" } else { "WhatsApp" })
        .to_string();
    Some(FinestraWhatsappCache {
        hwnd: hwnd.0 as isize,
        pid,
        processo,
        pacchetto,
        percorso,
        trovata_con_fallback: fallback,
    })
}

fn salva_cache_finestra(hwnd: HWND, fallback: bool) {
    if let Some(nuova) = descrivi_finestra(hwnd, fallback) {
        *cache_finestra()
            .lock()
            .expect("whatsapp window cache poisoned") = nuova;
    }
}

unsafe extern "system" fn enumera_finestre_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    if unsafe { IsWindowVisible(hwnd) }.as_bool() {
        let finestre = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
        finestre.push(hwnd);
    }
    true.into()
}

fn trova_finestra_whatsapp_per_processo() -> Option<HWND> {
    let mut finestre = Vec::<HWND>::new();
    let _ = unsafe {
        EnumWindows(
            Some(enumera_finestre_callback),
            LPARAM((&mut finestre as *mut Vec<HWND>) as isize),
        )
    };
    let foreground = unsafe { GetForegroundWindow() };
    finestre.sort_by_key(|hwnd| hwnd.0 == foreground.0);
    finestre.into_iter().rev().find(|hwnd| {
        let mut pid = 0_u32;
        unsafe { GetWindowThreadProcessId(*hwnd, Some(&mut pid)) };
        let percorso = percorso_processo(pid).unwrap_or_default().to_lowercase();
        let pacchetto = famiglia_pacchetto_processo(pid)
            .unwrap_or_default()
            .to_lowercase();
        PathBuf::from(&percorso)
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|nome| nome.contains("whatsapp"))
            || percorso.contains("whatsappdesktop")
            || pacchetto.contains("whatsapp")
    })
}

fn finestra_whatsapp_nativa() -> Option<HWND> {
    if let Some(hwnd) = hwnd_da_cache() {
        return Some(hwnd);
    }
    if let Ok(hwnd) = unsafe { FindWindowW(PCWSTR::null(), w!("WhatsApp")) } {
        if !hwnd.0.is_null() && unsafe { IsWindow(Some(hwnd)) }.as_bool() {
            return Some(hwnd);
        }
    }
    trova_finestra_whatsapp_per_processo()
}

/// Ripristina soltanto lo stato discreto precedente al collaudo: se WhatsApp
/// era minimizzato o non era aperto, al termine torna minimizzato; se era già
/// visibile resta aperto. Il gestionale viene riportato davanti dal comando
/// Tauri dopo che il lavoro bloccante è terminato.
pub(super) struct RipristinoVisibilitaDopoCollaudo {
    minimizza_al_termine: bool,
}

impl RipristinoVisibilitaDopoCollaudo {
    pub(super) fn cattura() -> Self {
        let minimizza_al_termine = finestra_whatsapp_nativa().is_none_or(|hwnd| {
            !unsafe { IsWindowVisible(hwnd) }.as_bool() || unsafe { IsIconic(hwnd) }.as_bool()
        });
        Self {
            minimizza_al_termine,
        }
    }
}

impl Drop for RipristinoVisibilitaDopoCollaudo {
    fn drop(&mut self) {
        if !self.minimizza_al_termine {
            return;
        }
        if let Some(hwnd) = finestra_whatsapp_nativa() {
            let _ = unsafe { ShowWindowAsync(hwnd, SW_MINIMIZE) };
        }
    }
}

fn finestre_whatsapp(
    automation: &IUIAutomation,
) -> windows::core::Result<Vec<IUIAutomationElement>> {
    // Percorso più rapido: dopo il primo riconoscimento conserviamo soltanto
    // handle e PID, mai elementi UIA che WebView2 può rendere obsoleti.
    if let Some(hwnd) = hwnd_da_cache() {
        if let Ok(finestra) = unsafe { automation.ElementFromHandle(hwnd) } {
            return Ok(vec![finestra]);
        }
    }
    // Il titolo nativo individua l'unica finestra reale anche quando WebView2
    // pubblica decine di top-level UIA duplicati con handle interni diversi.
    if let Ok(hwnd) = unsafe { FindWindowW(PCWSTR::null(), w!("WhatsApp")) } {
        if !hwnd.0.is_null() {
            if let Ok(finestra) = unsafe { automation.ElementFromHandle(hwnd) } {
                salva_cache_finestra(hwnd, false);
                return Ok(vec![finestra]);
            }
        }
    }
    // Fallback lento, raggiunto soltanto quando cache e titolo esatto non sono
    // disponibili (varianti Store/Business/localizzate di WhatsApp Desktop).
    if let Some(hwnd) = trova_finestra_whatsapp_per_processo() {
        if let Ok(finestra) = unsafe { automation.ElementFromHandle(hwnd) } {
            salva_cache_finestra(hwnd, true);
            return Ok(vec![finestra]);
        }
    }
    let root = unsafe { automation.GetRootElement()? };
    let condizione =
        condizione_proprieta(automation, UIA_NamePropertyId, &VARIANT::from("WhatsApp"))?;
    let elementi = unsafe { root.FindAll(TreeScope_Children, &condizione)? };
    let foreground = unsafe { GetForegroundWindow() };
    let mut finestre = Vec::new();
    let mut handle_visti = std::collections::HashSet::new();
    for indice in 0..unsafe { elementi.Length()? } {
        let elemento = unsafe { elementi.GetElement(indice)? };
        let Ok(hwnd) = (unsafe { elemento.CurrentNativeWindowHandle() }) else {
            continue;
        };
        if hwnd.0.is_null()
            || !handle_visti.insert(hwnd.0 as usize)
            || unsafe { elemento.CurrentIsOffscreen() }
                .map(|value| value.as_bool())
                .unwrap_or(false)
        {
            continue;
        }
        let rettangolo = unsafe { elemento.CurrentBoundingRectangle()? };
        if rettangolo.right <= rettangolo.left || rettangolo.bottom <= rettangolo.top {
            continue;
        }
        let area = i64::from(rettangolo.right - rettangolo.left)
            * i64::from(rettangolo.bottom - rettangolo.top);
        finestre.push((hwnd.0 == foreground.0, area, elemento));
    }
    // WebView2 può pubblicare molte finestre top-level fantasma, tutte col nome
    // "WhatsApp" e con gli stessi discendenti. Scansionarle una dopo l'altra
    // rende un timeout di tre secondi lungo diversi minuti. La finestra in
    // primo piano è quella appena aperta dal deep-link; come fallback usiamo
    // quella visibile con area maggiore.
    finestre.sort_by_key(|(in_primo_piano, area, _)| (*in_primo_piano, *area));
    let risultato = finestre
        .pop()
        .map(|(_, _, finestra)| vec![finestra])
        .unwrap_or_default();
    if let Some(finestra) = risultato.first() {
        if let Ok(hwnd) = unsafe { finestra.CurrentNativeWindowHandle() } {
            salva_cache_finestra(hwnd, true);
        }
    }
    Ok(risultato)
}

fn elemento_visibile(elemento: &IUIAutomationElement) -> bool {
    unsafe { elemento.CurrentIsOffscreen() }
        .map(|value| !value.as_bool())
        .unwrap_or(true)
}

fn elemento_con_area_valida(elemento: &IUIAutomationElement) -> bool {
    unsafe { elemento.CurrentBoundingRectangle() }
        .map(|rettangolo| rettangolo.right > rettangolo.left && rettangolo.bottom > rettangolo.top)
        .unwrap_or(false)
}

struct StatoModalitaAllegato {
    in_modalita_allegato: bool,
    dialog_visibile: bool,
    conferma: Option<IUIAutomationElement>,
    chiudi_anteprima: Option<IUIAutomationElement>,
}

fn stato_modalita_allegato(
    automation: &IUIAutomation,
    finestra: &IUIAutomationElement,
) -> windows::core::Result<StatoModalitaAllegato> {
    if let Ok(elemento) = unsafe { automation.GetFocusedElement() } {
        if elemento_visibile(&elemento) {
            let nome_elemento = nome(&elemento);
            if std::env::var("PHARMATEK_WHATSAPP_DIAGNOSTICA").as_deref() == Ok("1") {
                let tipo = unsafe { elemento.CurrentControlType() }
                    .map(|tipo| tipo.0)
                    .unwrap_or_default();
                eprintln!("whatsapp-ui focus stato allegato: tipo={tipo} nome={nome_elemento:?}");
            }
            let finestra_in_primo_piano = unsafe { finestra.CurrentNativeWindowHandle() }
                .is_ok_and(|hwnd| {
                    !hwnd.0.is_null() && unsafe { GetForegroundWindow() }.0 == hwnd.0
                });
            if nome_indica_compositore_messaggio(&nome_elemento) && finestra_in_primo_piano {
                return Ok(StatoModalitaAllegato {
                    in_modalita_allegato: false,
                    dialog_visibile: false,
                    conferma: None,
                    chiudi_anteprima: None,
                });
            }
            if nome_pulsante_conferma_interruzione(&nome_elemento) {
                return Ok(StatoModalitaAllegato {
                    in_modalita_allegato: false,
                    dialog_visibile: true,
                    conferma: Some(elemento),
                    chiudi_anteprima: None,
                });
            }
            if testo_indica_modalita_allegato(&nome_elemento)
                || NOMI_INVIA_ALLEGATO.contains(&nome_elemento.as_str())
                || nome_pulsante_chiudi_allegato(&nome_elemento)
            {
                return Ok(StatoModalitaAllegato {
                    in_modalita_allegato: true,
                    dialog_visibile: false,
                    conferma: None,
                    chiudi_anteprima: nome_pulsante_chiudi_allegato(&nome_elemento)
                        .then_some(elemento),
                });
            }
        }
    }
    // Nel percorso normale non materializziamo più tutti i nodi Edit/Text/Button
    // di WebView2 (migliaia di proprietà remote): bastano i pochi pulsanti con
    // nome stabile esposti dall'anteprima e dal dialog di conferma.
    let nomi = NOMI_INVIA_ALLEGATO
        .iter()
        .chain(NOMI_CHIUDI_ALLEGATO.iter())
        .chain(NOMI_CONFERMA_INTERRUZIONE.iter())
        .copied()
        .collect::<Vec<_>>();
    let elementi = pulsanti_per_nomi(automation, finestra, &nomi)?;
    let mut stato = StatoModalitaAllegato {
        in_modalita_allegato: false,
        dialog_visibile: false,
        conferma: None,
        chiudi_anteprima: None,
    };
    for elemento in elementi {
        if !elemento_visibile(&elemento) {
            continue;
        }
        let nome_elemento = nome(&elemento);
        if std::env::var("PHARMATEK_WHATSAPP_DIAGNOSTICA").as_deref() == Ok("1") {
            eprintln!("whatsapp-ui pulsante stato allegato: {nome_elemento:?}");
        }
        // La query è stata soddisfatta col nome cacheato dal provider. Durante
        // la transizione WebView2 può già restituire CurrentName vuoto: il nodo
        // resta comunque prova che il guscio allegato è ancora aperto.
        stato.in_modalita_allegato = true;
        stato.dialog_visibile |= nome_pulsante_conferma_interruzione(&nome_elemento);
        if stato.conferma.is_none() && nome_pulsante_conferma_interruzione(&nome_elemento) {
            stato.conferma = Some(elemento);
        } else if nome_pulsante_chiudi_allegato(&nome_elemento) {
            let nuovo_top = unsafe { elemento.CurrentBoundingRectangle() }
                .map(|rettangolo| rettangolo.top)
                .unwrap_or(i32::MAX);
            let sostituisci = stato
                .chiudi_anteprima
                .as_ref()
                .and_then(|corrente| unsafe { corrente.CurrentBoundingRectangle() }.ok())
                .map(|rettangolo| nuovo_top < rettangolo.top)
                .unwrap_or(true);
            if sostituisci {
                stato.chiudi_anteprima = Some(elemento);
            }
        }
    }
    Ok(stato)
}

#[cfg(test)]
fn finestra_in_modalita_allegato(
    automation: &IUIAutomation,
    finestra: &IUIAutomationElement,
) -> windows::core::Result<bool> {
    stato_modalita_allegato(automation, finestra).map(|stato| stato.in_modalita_allegato)
}

fn punto_whatsapp_scoperto(hwnd: HWND, punto: POINT) -> bool {
    if hwnd.0.is_null() || unsafe { GetForegroundWindow() }.0 != hwnd.0 {
        return false;
    }
    let finestra_al_punto = unsafe { WindowFromPoint(punto) };
    if finestra_al_punto.0.is_null() {
        return false;
    }
    unsafe { GetAncestor(finestra_al_punto, GA_ROOT) }.0 == hwnd.0
}

/// Porta realmente WhatsApp davanti anche quando Windows nega un semplice
/// `SetForegroundWindow` a un worker in background. L'aggancio alle code di
/// input dura soltanto per il cambio di z-order; il passaggio TOPMOST viene
/// subito revocato, quindi WhatsApp non resta sopra alle altre applicazioni.
fn porta_whatsapp_in_primo_piano(hwnd: HWND) {
    unsafe {
        let _ = ShowWindowAsync(hwnd, SW_RESTORE);
        let thread_corrente = GetCurrentThreadId();
        let thread_whatsapp = GetWindowThreadProcessId(hwnd, None);
        let foreground = GetForegroundWindow();
        let thread_foreground = if foreground.0.is_null() {
            0
        } else {
            GetWindowThreadProcessId(foreground, None)
        };
        let agganciato_foreground = thread_foreground != 0
            && thread_foreground != thread_corrente
            && AttachThreadInput(thread_corrente, thread_foreground, true).as_bool();
        let agganciato_whatsapp = thread_whatsapp != 0
            && thread_whatsapp != thread_corrente
            && thread_whatsapp != thread_foreground
            && AttachThreadInput(thread_corrente, thread_whatsapp, true).as_bool();

        let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW;
        let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, flags);
        let _ = BringWindowToTop(hwnd);
        let _ = SetActiveWindow(hwnd);
        let _ = SetForegroundWindow(hwnd);
        let _ = SetWindowPos(hwnd, Some(HWND_NOTOPMOST), 0, 0, 0, 0, flags);

        if agganciato_whatsapp {
            let _ = AttachThreadInput(thread_corrente, thread_whatsapp, false);
        }
        if agganciato_foreground {
            let _ = AttachThreadInput(thread_corrente, thread_foreground, false);
        }
    }
}

fn clicca_punto_whatsapp_verificato(
    hwnd: HWND,
    punto: POINT,
    descrizione: &str,
) -> Result<(), ErroreWhatsAppWindows> {
    if !punto_whatsapp_scoperto(hwnd, punto) {
        let mut error = errore_attivita_utente();
        error.messaggio = format!(
            "Invio WhatsApp in attesa: {descrizione} è coperto da un'altra finestra. Nessun clic è stato eseguito."
        );
        return Err(error);
    }
    let mut originale = POINT::default();
    let ripristina = unsafe { GetCursorPos(&mut originale) }.is_ok();
    unsafe { SetCursorPos(punto.x, punto.y) }.map_err(|error| {
        errore(
            false,
            format!("Il controllo WhatsApp non è raggiungibile: {error}"),
        )
    })?;
    thread::sleep(Duration::from_millis(45));
    if !punto_whatsapp_scoperto(hwnd, punto) {
        if ripristina {
            let _ = unsafe { SetCursorPos(originale.x, originale.y) };
        }
        let mut error = errore_attivita_utente();
        error.messaggio = format!(
            "Invio WhatsApp in attesa: {descrizione} non è più visibile. Nessun clic è stato eseguito."
        );
        return Err(error);
    }
    unsafe {
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        thread::sleep(Duration::from_millis(35));
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        thread::sleep(Duration::from_millis(80));
        if ripristina {
            let _ = SetCursorPos(originale.x, originale.y);
        }
    }
    Ok(())
}

fn clicca_elemento_uia(
    elemento: &IUIAutomationElement,
    hwnd: HWND,
) -> Result<(), ErroreWhatsAppWindows> {
    let rettangolo = unsafe { elemento.CurrentBoundingRectangle() }.map_err(|error| {
        errore(
            false,
            format!("Il controllo WhatsApp non è localizzabile: {error}"),
        )
    })?;
    if rettangolo.right <= rettangolo.left || rettangolo.bottom <= rettangolo.top {
        return Err(errore(
            false,
            "Il controllo WhatsApp non espone un'area valida.",
        ));
    }
    clicca_punto_whatsapp_verificato(
        hwnd,
        POINT {
            x: rettangolo.left + (rettangolo.right - rettangolo.left) / 2,
            y: rettangolo.top + (rettangolo.bottom - rettangolo.top) / 2,
        },
        "il controllo richiesto",
    )
}

/// Un tentativo precedente può lasciare WhatsApp nell'anteprima del PDF/PNG.
/// Prima di preparare un nuovo invio usciamo da quella modalità e, quando
/// WhatsApp lo richiede, confermiamo esplicitamente l'interruzione. Il controllo
/// "Chiudi" viene usato soltanto dopo aver riconosciuto la modalità allegato;
/// Escape resta il fallback per versioni che non espongono quel controllo.
fn ripristina_modalita_allegato(
    automation: &IUIAutomation,
    marcatore_input: Option<u32>,
    annullato: &impl Fn() -> bool,
) -> Result<Option<u32>, ErroreWhatsAppWindows> {
    let finestre = finestre_whatsapp(automation).map_err(|error| {
        errore(
            false,
            format!("Verifica dello stato allegato WhatsApp non riuscita: {error}"),
        )
    })?;
    for finestra in finestre {
        let stato = stato_modalita_allegato(automation, &finestra).map_err(|error| {
            errore(
                false,
                format!("Anteprima WhatsApp non verificabile: {error}"),
            )
        })?;
        let mut conferma = stato.conferma;
        let chiudi_anteprima = stato.chiudi_anteprima;
        if !stato.in_modalita_allegato && !stato.dialog_visibile {
            continue;
        }
        if stato.dialog_visibile && conferma.is_none() {
            return Err(errore(
                false,
                "WhatsApp chiede di interrompere l’azione precedente, ma il pulsante di conferma non è riconoscibile.",
            ));
        }
        if annullato() {
            return Err(errore_annullamento());
        }
        verifica_input_invariato(marcatore_input)?;
        let hwnd = unsafe { finestra.CurrentNativeWindowHandle() }.map_err(|error| {
            errore(
                false,
                format!("Finestra WhatsApp non verificabile durante il ripristino: {error}"),
            )
        })?;
        if hwnd.0.is_null() {
            return Err(errore(
                false,
                "WhatsApp non espone una finestra valida per chiudere l’anteprima.",
            ));
        }
        porta_whatsapp_in_primo_piano(hwnd);
        thread::sleep(Duration::from_millis(80));
        let foreground = unsafe { GetForegroundWindow() };
        if foreground.0 != hwnd.0 {
            return Err(errore_attivita_utente());
        }

        let mut marcatore_corrente = marcatore_input;
        let mut tentativi_conferma = 0_u8;
        let mut tentativi_escape = 0_u8;
        if let Some(pulsante) = conferma.take() {
            clicca_elemento_uia(&pulsante, hwnd)?;
            tentativi_conferma = 1;
            thread::sleep(Duration::from_millis(800));
        } else if let Some(pulsante) = chiudi_anteprima {
            clicca_elemento_uia(&pulsante, hwnd)?;
            tentativi_escape = 1;
            thread::sleep(Duration::from_millis(250));
        } else {
            invia_input_tastiera(&[input_tasto(VK_ESCAPE, false), input_tasto(VK_ESCAPE, true)])?;
            tentativi_escape = 1;
        }
        marcatore_corrente = marcatore_input_utente().or(marcatore_corrente);

        let mut scadenza = Instant::now() + ATTESA_CHIUSURA_ALLEGATO;
        loop {
            if annullato() {
                return Err(errore_annullamento());
            }
            verifica_input_invariato(marcatore_corrente)?;
            let stato = stato_modalita_allegato(automation, &finestra).map_err(|error| {
                errore(
                    false,
                    format!("Dialog di interruzione WhatsApp non verificabile: {error}"),
                )
            })?;
            if stato.dialog_visibile && stato.conferma.is_none() {
                return Err(errore(
                    false,
                    "WhatsApp chiede di interrompere l’azione precedente, ma il pulsante di conferma non è riconoscibile.",
                ));
            }
            if let Some(pulsante) = stato.conferma {
                if tentativi_conferma >= 3 {
                    return Err(errore(
                        false,
                        "WhatsApp non ha applicato la conferma di interruzione dell’allegato.",
                    ));
                }
                clicca_elemento_uia(&pulsante, hwnd)?;
                tentativi_conferma += 1;
                marcatore_corrente = marcatore_input_utente().or(marcatore_corrente);
                thread::sleep(Duration::from_millis(800));
                scadenza = Instant::now() + ATTESA_CHIUSURA_ALLEGATO;
                continue;
            }
            if !stato.in_modalita_allegato {
                return Ok(marcatore_corrente);
            }
            if tentativi_escape < 3 {
                if let Some(pulsante) = stato.chiudi_anteprima {
                    clicca_elemento_uia(&pulsante, hwnd)?;
                } else {
                    invia_input_tastiera(&[
                        input_tasto(VK_ESCAPE, false),
                        input_tasto(VK_ESCAPE, true),
                    ])?;
                }
                tentativi_escape += 1;
                marcatore_corrente = marcatore_input_utente().or(marcatore_corrente);
                thread::sleep(Duration::from_millis(250));
                scadenza = Instant::now() + ATTESA_CHIUSURA_ALLEGATO;
                continue;
            }
            if Instant::now() >= scadenza {
                return Err(errore(
                    false,
                    "WhatsApp non ha chiuso l’azione con allegato precedente; nessun nuovo invio è stato avviato.",
                ));
            }
            thread::sleep(PASSO_ATTESA);
        }
    }
    Ok(None)
}

fn valore_compositore(compositore: &IUIAutomationElement) -> Option<String> {
    let pattern: IUIAutomationValuePattern =
        unsafe { compositore.GetCurrentPatternAs(UIA_ValuePatternId) }.ok()?;
    unsafe { pattern.CurrentValue() }
        .ok()
        .map(|value| value.to_string())
}

fn compositore_non_vuoto(compositore: &IUIAutomationElement) -> bool {
    valore_compositore(compositore).is_some_and(|testo| !testo.trim().is_empty())
        || unsafe { compositore.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) }
            .ok()
            .and_then(|pattern| unsafe { pattern.DocumentRange() }.ok())
            .and_then(|intervallo| unsafe { intervallo.GetText(-1) }.ok())
            .is_some_and(|testo| !testo.to_string().trim().is_empty())
}

fn compositore_contiene_testo(
    automation: &IUIAutomation,
    compositore: &IUIAutomationElement,
    corpo: &str,
) -> bool {
    let atteso = normalizza_testo(corpo);

    testi_compositore(automation, compositore)
        .iter()
        .any(|testo| normalizza_testo(testo) == atteso)
}

fn compositore_contiene_frammento(
    automation: &IUIAutomation,
    compositore: &IUIAutomationElement,
    frammento: &str,
) -> bool {
    let atteso = normalizza_testo(frammento);
    !atteso.is_empty()
        && testi_compositore(automation, compositore)
            .iter()
            .any(|testo| normalizza_testo(testo).contains(&atteso))
}

fn testi_compositore(
    automation: &IUIAutomation,
    compositore: &IUIAutomationElement,
) -> Vec<String> {
    let mut testi = Vec::new();

    // WebView2 può lasciare ValuePattern vuoto anche quando il contenuto è
    // visibile. TextPattern riflette invece il testo effettivo del contenteditable.
    if let Some(testo) =
        unsafe { compositore.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) }
            .ok()
            .and_then(|pattern| unsafe { pattern.DocumentRange() }.ok())
            .and_then(|intervallo| unsafe { intervallo.GetText(-1) }.ok())
            .map(|testo| testo.to_string())
    {
        testi.push(testo);
    }

    if let Some(testo) = valore_compositore(compositore) {
        testi.push(testo);
    }

    // Alcune build espongono il contenuto soltanto come nodo Text figlio.
    if let Ok(elementi) = elementi_per_controllo(automation, compositore, UIA_TextControlTypeId.0) {
        testi.extend(elementi.iter().map(nome));
    }
    testi
}

pub(super) fn marcatore_apertura(id: &str) -> String {
    let suffisso = id
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .rev()
        .take(8)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    format!("{MARCATORE_APERTURA_CHAT}{suffisso}")
}

/// Un retry non deve riaprire il protocollo se la bozza tecnica della stessa
/// comunicazione e ancora nel compositore: WhatsApp accoderebbe il marcatore e
/// produrrebbe il loop di puntini osservato dall'utente.
pub(super) fn bozza_contiene_marcatore(marcatore: &str) -> bool {
    let Ok(_com) = ComApartment::init() else {
        return false;
    };
    let Ok(automation) = (unsafe {
        CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
    }) else {
        return false;
    };
    let Ok(finestre) = finestre_whatsapp(&automation) else {
        return false;
    };
    finestre.into_iter().any(|finestra| {
        compositore_messaggio(&automation, &finestra)
            .ok()
            .flatten()
            .is_some_and(|compositore| {
                compositore_contiene_frammento(&automation, &compositore, marcatore)
            })
    })
}

fn trova_pulsanti_compositore(
    pulsanti: &[IUIAutomationElement],
    richiedi_invia: bool,
) -> Vec<IUIAutomationElement> {
    pulsanti
        .iter()
        .filter(|elemento| {
            let nome = nome(elemento);
            nome_pulsante_invia(&nome) || (!richiedi_invia && nome_pulsante_vocale(&nome))
        })
        .cloned()
        .collect()
}

fn nome_pulsante_invia(value: &str) -> bool {
    matches!(
        normalizza_identita(value).as_str(),
        "invia" | "invia messaggio" | "send" | "send message"
    )
}

fn nome_pulsante_vocale(value: &str) -> bool {
    matches!(
        normalizza_identita(value).as_str(),
        "messaggio vocale"
            | "registra messaggio vocale"
            | "registra un messaggio vocale"
            | "voice message"
            | "record voice message"
            | "record a voice message"
    )
}

fn pulsante_accanto_al_compositore(
    pulsante: &IUIAutomationElement,
    compositore: &IUIAutomationElement,
) -> bool {
    let Ok(rettangolo_pulsante) = (unsafe { pulsante.CurrentBoundingRectangle() }) else {
        return false;
    };
    let Ok(rettangolo_compositore) = (unsafe { compositore.CurrentBoundingRectangle() }) else {
        return false;
    };
    rettangolo_compositore.right > rettangolo_compositore.left
        && rettangolo_compositore.bottom > rettangolo_compositore.top
        && rettangolo_pulsante.right > rettangolo_pulsante.left
        && rettangolo_pulsante.bottom > rettangolo_pulsante.top
        && rettangolo_compositore.left < rettangolo_pulsante.left
        && rettangolo_compositore.bottom >= rettangolo_pulsante.top
        && rettangolo_compositore.top <= rettangolo_pulsante.bottom
        && rettangolo_pulsante
            .left
            .saturating_sub(rettangolo_compositore.right)
            <= 250
}

fn trova_controlli(
    automation: &IUIAutomation,
    numero: &str,
    destinatario: &str,
    corpo: &str,
    richiedi_testo_esatto: bool,
    verifica_interruzione: &impl Fn() -> Result<(), ErroreWhatsAppWindows>,
) -> Result<Option<ControlliCompositore>, ErroreWhatsAppWindows> {
    let finestre = finestre_whatsapp(automation).map_err(|error| {
        errore(
            false,
            format!("Ricerca finestra WhatsApp non riuscita: {error}"),
        )
    })?;
    verifica_interruzione()?;
    for finestra in finestre {
        if !richiedi_testo_esatto {
            if let Some(controlli) = controlli_compositore_focalizzato(
                automation,
                &finestra,
                false,
                numero,
                destinatario,
                corpo,
            )
            .map_err(|error| {
                errore(
                    false,
                    format!("Lettura del compositore WhatsApp focalizzato non riuscita: {error}"),
                )
            })? {
                verifica_interruzione()?;
                return Ok(Some(controlli));
            }
        }
        if !richiedi_testo_esatto {
            let compositore = compositore_messaggio(automation, &finestra)
                .map_err(|error| {
                    errore(
                        false,
                        format!("Ricerca del campo messaggio WhatsApp non riuscita: {error}"),
                    )
                })?
                .or_else(|| {
                    compositore_messaggio_fallback(automation, &finestra)
                        .ok()
                        .flatten()
                });
            verifica_interruzione()?;
            if let Some(compositore) = compositore {
                // Il nome dell'anagrafica può differire dal nome account
                // mostrato da WhatsApp e il numero spesso non è presente
                // nell'intestazione. Il marcatore neutro del deep-link rende
                // comunque riconoscibile il compositore appena aperto; prima
                // del click viene sostituito e verificato esattamente.
                let bozza_deeplink_verificata = !corpo.is_empty()
                    && compositore_contiene_frammento(automation, &compositore, corpo);
                let destinatario_verificato = (numero.is_empty() && destinatario.is_empty())
                    || bozza_deeplink_verificata
                    || finestra_mostra_destinatario(
                        automation,
                        &finestra,
                        &compositore,
                        numero,
                        destinatario,
                    );
                if !destinatario_verificato {
                    continue;
                }
                if let Some(controlli) =
                    controlli_per_compositore(automation, &finestra, compositore, false).map_err(
                        |error| {
                            errore(
                                false,
                                format!(
                                    "Ricerca dei controlli WhatsApp vicini al compositore non riuscita: {error}"
                                ),
                            )
                        },
                    )?
                {
                    verifica_interruzione()?;
                    return Ok(Some(controlli));
                }
            }
            continue;
        }
        let compositori = elementi_per_controllo(automation, &finestra, UIA_EditControlTypeId.0)
            .map_err(|error| {
                errore(
                    false,
                    format!("Ricerca del campo messaggio WhatsApp non riuscita: {error}"),
                )
            })?
            .iter()
            .filter(|compositore| compositore_contiene_testo(automation, compositore, corpo))
            .cloned()
            .collect::<Vec<_>>();
        verifica_interruzione()?;
        if compositori.is_empty() {
            continue;
        }
        let pulsanti = pulsanti_compositore(automation, &finestra, richiedi_testo_esatto).map_err(
            |error| {
                errore(
                    false,
                    format!("Ricerca del pulsante Invia WhatsApp non riuscita: {error}"),
                )
            },
        )?;
        verifica_interruzione()?;
        for invia in trova_pulsanti_compositore(&pulsanti, richiedi_testo_esatto) {
            let compositore_accanto = compositori
                .iter()
                .find(|compositore| pulsante_accanto_al_compositore(&invia, compositore));
            if let Some(compositore) = compositore_accanto {
                return Ok(Some(ControlliCompositore {
                    finestra: finestra.clone(),
                    compositore: compositore.clone(),
                    invia,
                }));
            }
        }
        // Le build che localizzano diversamente il nome accessibile del
        // pulsante ricadono qui. Testo esatto e relazione geometrica restano
        // obbligatori; InvokePattern serve soltanto a riconoscere il controllo.
        for compositore in compositori {
            if let Some(controlli) =
                controlli_per_compositore(automation, &finestra, compositore, true).map_err(
                    |error| {
                        errore(
                            false,
                            format!("Ricerca alternativa del pulsante Invia non riuscita: {error}"),
                        )
                    },
                )?
            {
                return Ok(Some(controlli));
            }
        }
    }
    Ok(None)
}

fn trova_controlli_preparabili(
    automation: &IUIAutomation,
    numero: &str,
    destinatario: &str,
    corpo: &str,
    verifica_interruzione: &impl Fn() -> Result<(), ErroreWhatsAppWindows>,
) -> Result<Option<ControlliCompositore>, ErroreWhatsAppWindows> {
    trova_controlli(
        automation,
        numero,
        destinatario,
        corpo,
        false,
        verifica_interruzione,
    )
}

fn trova_controlli_preparabili_focalizzati(
    automation: &IUIAutomation,
    numero: &str,
    destinatario: &str,
    corpo: &str,
    verifica_interruzione: &impl Fn() -> Result<(), ErroreWhatsAppWindows>,
) -> Result<Option<ControlliCompositore>, ErroreWhatsAppWindows> {
    let finestre = finestre_whatsapp(automation).map_err(|error| {
        errore(
            false,
            format!("Ricerca finestra WhatsApp non riuscita: {error}"),
        )
    })?;
    verifica_interruzione()?;
    for finestra in finestre {
        if let Some(controlli) = controlli_compositore_focalizzato(
            automation,
            &finestra,
            false,
            numero,
            destinatario,
            corpo,
        )
        .map_err(|error| {
            errore(
                false,
                format!("Lettura del compositore WhatsApp focalizzato non riuscita: {error}"),
            )
        })? {
            verifica_interruzione()?;
            return Ok(Some(controlli));
        }
    }
    Ok(None)
}

fn controlli_pronti_dopo_scrittura(
    automation: &IUIAutomation,
    preparati: &ControlliCompositore,
    verifica_interruzione: &impl Fn() -> Result<(), ErroreWhatsAppWindows>,
) -> Result<Option<ControlliCompositore>, ErroreWhatsAppWindows> {
    verifica_interruzione()?;
    let testo_presente = compositore_non_vuoto(&preparati.compositore);
    verifica_interruzione()?;
    if !testo_presente {
        return Ok(None);
    }

    // Dopo la scrittura WhatsApp sostituisce il microfono con un nuovo nodo
    // `Invia`. Se il nodo corrente ha coordinate valide lo usiamo: il click non
    // dipende dal focus che WebView2 può perdere dopo Ctrl+A/C. Le build che
    // pubblicano ancora un pulsante UIA obsoleto ricadono invece su Enter.
    if let Ok(Some(mut controlli)) = controlli_per_compositore(
        automation,
        &preparati.finestra,
        preparati.compositore.clone(),
        true,
    ) {
        controlli.finestra = preparati.finestra.clone();
        verifica_interruzione()?;
        return Ok(Some(controlli));
    }
    Ok(Some(preparati.clone()))
}

fn clicca_pulsante_invia(
    controlli: &ControlliCompositore,
    annullato: &impl Fn() -> bool,
) -> Result<(), ErroreWhatsAppWindows> {
    if annullato() {
        return Err(errore_annullamento());
    }
    let abilitato = unsafe { controlli.invia.CurrentIsEnabled() }.map_err(|error| {
        errore(
            false,
            format!("Il pulsante Invia di WhatsApp non è verificabile: {error}"),
        )
    })?;
    if !abilitato.as_bool() {
        return Err(errore(
            false,
            "Il pulsante Invia di WhatsApp non è ancora disponibile.",
        ));
    }

    let rettangolo = unsafe { controlli.invia.CurrentBoundingRectangle() }.map_err(|error| {
        errore(
            false,
            format!("Il pulsante Invia di WhatsApp non è localizzabile: {error}"),
        )
    })?;
    if rettangolo.right <= rettangolo.left || rettangolo.bottom <= rettangolo.top {
        return Err(errore(
            false,
            "WhatsApp non espone un'area valida per il pulsante Invia.",
        ));
    }

    let punto = POINT {
        x: rettangolo.left + (rettangolo.right - rettangolo.left) / 2,
        y: rettangolo.top + (rettangolo.bottom - rettangolo.top) / 2,
    };
    if annullato() {
        return Err(errore_annullamento());
    }
    let hwnd = handle_finestra(controlli)?;
    // WebView2 espone InvokePattern ma, subito dopo la compilazione rapida,
    // può restituire successo senza eseguire alcuna azione. Il click sul
    // rettangolo UIA verificato è deterministico. Subito prima dell'evento
    // controlliamo anche lo z-order: un toast o un'altra app non possono così
    // ricevere accidentalmente il clic destinato a WhatsApp.
    clicca_punto_whatsapp_verificato(hwnd, punto, "il pulsante Invia")
}

fn invia_compositore_con_enter(
    controlli: &ControlliCompositore,
    annullato: &impl Fn() -> bool,
) -> Result<(), ErroreWhatsAppWindows> {
    if annullato() {
        return Err(errore_annullamento());
    }
    let hwnd = handle_finestra(controlli)?;
    if !destinazione_input_verificata(controlli, hwnd) {
        return Err(errore_attivita_utente());
    }
    invia_input_tastiera(&[input_tasto(VK_RETURN, false), input_tasto(VK_RETURN, true)])?;
    thread::sleep(Duration::from_millis(80));
    Ok(())
}

fn input_tasto(tasto: VIRTUAL_KEY, rilascio: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: tasto,
                dwFlags: if rilascio {
                    KEYEVENTF_KEYUP
                } else {
                    Default::default()
                },
                ..Default::default()
            },
        },
    }
}

fn invia_input_tastiera(input: &[INPUT]) -> Result<(), ErroreWhatsAppWindows> {
    let inviati = unsafe { SendInput(input, std::mem::size_of::<INPUT>() as i32) };
    if inviati == input.len() as u32 {
        Ok(())
    } else {
        let errore_windows = windows::core::Error::from_thread();
        Err(errore(
            false,
            format!(
                "WhatsApp ha ricevuto soltanto {inviati} di {} eventi di tastiera: {errore_windows}",
                input.len(),
            ),
        ))
    }
}

fn testo_unicode_dagli_appunti() -> Option<String> {
    if unsafe { OpenClipboard(None) }.is_err() {
        return None;
    }
    let _guard = AppuntiAperti;
    let handle = unsafe { GetClipboardData(CF_UNICODETEXT.0.into()) }.ok()?;
    if handle.0.is_null() {
        return None;
    }
    let memoria = HGLOBAL(handle.0);
    let dimensione = unsafe { GlobalSize(memoria) };
    if dimensione < std::mem::size_of::<u16>() {
        return None;
    }
    let puntatore = unsafe { GlobalLock(memoria) };
    if puntatore.is_null() {
        return None;
    }
    let unita = unsafe {
        std::slice::from_raw_parts(
            puntatore.cast::<u16>(),
            dimensione / std::mem::size_of::<u16>(),
        )
    };
    let fine = unita
        .iter()
        .position(|unita| *unita == 0)
        .unwrap_or(unita.len());
    let testo = String::from_utf16_lossy(&unita[..fine]);
    let _ = unsafe { GlobalUnlock(memoria) };
    Some(testo)
}

fn copia_testo_negli_appunti(testo: &str) -> Result<RipristinoAppunti, ErroreWhatsAppWindows> {
    let precedente = unsafe { OleGetClipboard() }.ok();
    let mut aperti = false;
    for _ in 0..8 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            aperti = true;
            break;
        }
        thread::sleep(Duration::from_millis(15));
    }
    if !aperti {
        return Err(errore(
            false,
            "Gli appunti di Windows sono occupati: il testo WhatsApp non è stato preparato.",
        ));
    }
    let _guard = AppuntiAperti;
    unsafe { EmptyClipboard() }.map_err(|error| {
        errore(
            false,
            format!("Gli appunti di Windows non sono modificabili: {error}"),
        )
    })?;

    let mut unita = testo.encode_utf16().collect::<Vec<_>>();
    unita.push(0);
    let totale = unita.len() * std::mem::size_of::<u16>();
    let memoria = unsafe { GlobalAlloc(GMEM_MOVEABLE, totale) }.map_err(|error| {
        errore(
            false,
            format!("Memoria per il testo WhatsApp non disponibile: {error}"),
        )
    })?;
    let puntatore = unsafe { GlobalLock(memoria) };
    if puntatore.is_null() {
        let _ = unsafe { GlobalFree(Some(memoria)) };
        return Err(errore(
            false,
            "Windows non ha preparato il testo per WhatsApp.",
        ));
    }
    unsafe {
        std::ptr::copy_nonoverlapping(unita.as_ptr(), puntatore.cast::<u16>(), unita.len());
        let _ = GlobalUnlock(memoria);
    }
    if let Err(error) =
        unsafe { SetClipboardData(CF_UNICODETEXT.0.into(), Some(HANDLE(memoria.0))) }
    {
        let _ = unsafe { GlobalFree(Some(memoria)) };
        return Err(errore(
            false,
            format!("Windows non ha messo il testo negli appunti: {error}"),
        ));
    }
    Ok(RipristinoAppunti(precedente))
}

fn verifica_testo_compositore_con_appunti(
    controlli: &ControlliCompositore,
    corpo: &str,
    marcatore_input: Option<u32>,
    annullato: &impl Fn() -> bool,
) -> Result<u32, ErroreWhatsAppWindows> {
    if annullato() {
        return Err(errore_annullamento());
    }
    let hwnd = handle_finestra(controlli)?;
    if !destinazione_input_verificata(controlli, hwnd) {
        return Err(errore_attivita_utente());
    }
    verifica_input_invariato(marcatore_input)?;

    // TextPattern di WebView2 impiega diversi secondi per ogni lettura. Una
    // copia temporanea del contenteditable fornisce invece il testo esatto in
    // pochi millisecondi; gli appunti dell'operatore vengono sempre ripristinati.
    let ripristino_appunti = RipristinoAppunti(unsafe { OleGetClipboard() }.ok());
    let mut aperti = false;
    for _ in 0..8 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            aperti = true;
            break;
        }
        thread::sleep(Duration::from_millis(15));
    }
    if !aperti {
        return Err(errore(
            false,
            "Gli appunti di Windows sono occupati: il testo WhatsApp non è verificabile.",
        ));
    }
    {
        let _guard = AppuntiAperti;
        unsafe { EmptyClipboard() }.map_err(|error| {
            errore(
                false,
                format!("Gli appunti di Windows non sono modificabili: {error}"),
            )
        })?;
    }
    invia_input_tastiera(&[
        input_tasto(VK_CONTROL, false),
        input_tasto(VK_A, false),
        input_tasto(VK_A, true),
        input_tasto(VK_CONTROL, true),
    ])?;
    // WebView2 applica la selezione in una task distinta: separare i due
    // accordi evita che Ctrl+C preceda l'aggiornamento del contenteditable.
    thread::sleep(Duration::from_millis(35));
    invia_input_tastiera(&[
        input_tasto(VK_CONTROL, false),
        input_tasto(windows::Win32::UI::Input::KeyboardAndMouse::VK_C, false),
        input_tasto(windows::Win32::UI::Input::KeyboardAndMouse::VK_C, true),
        input_tasto(VK_CONTROL, true),
    ])?;
    let marcatore = marcatore_input_utente().ok_or_else(|| {
        errore(
            false,
            "Windows non ha confermato la verifica del testo WhatsApp.",
        )
    })?;
    let scadenza = Instant::now() + Duration::from_millis(1_500);
    let atteso = normalizza_testo(corpo);
    loop {
        if annullato() {
            return Err(errore_annullamento());
        }
        verifica_input_invariato(Some(marcatore))?;
        if let Some(testo) = testo_unicode_dagli_appunti() {
            drop(ripristino_appunti);
            if normalizza_testo(&testo) != atteso {
                return Err(errore(
                    false,
                    "WhatsApp non ha confermato il testo esatto; l'invio non è stato premuto.",
                ));
            }
            // Ctrl+A/C lascia selezionata l'intera bozza. Collassiamo la
            // selezione prima di invocare il pulsante, così WebView2 completa
            // il ciclo di modifica e abilita realmente l'azione.
            invia_input_tastiera(&[input_tasto(VK_END, false), input_tasto(VK_END, true)])?;
            thread::sleep(Duration::from_millis(80));
            return marcatore_input_utente().ok_or_else(|| {
                errore(
                    false,
                    "Windows non ha confermato la chiusura della verifica del testo WhatsApp.",
                )
            });
        }
        if Instant::now() >= scadenza {
            return Err(errore(
                false,
                "WhatsApp non ha reso verificabile il testo preparato; l'invio non è stato premuto.",
            ));
        }
        thread::sleep(Duration::from_millis(20));
    }
}

fn copia_file_negli_appunti(path: &Path) -> Result<RipristinoAppunti, ErroreWhatsAppWindows> {
    let precedente = unsafe { OleGetClipboard() }.ok();
    let mut aperti = false;
    for _ in 0..8 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            aperti = true;
            break;
        }
        thread::sleep(Duration::from_millis(25));
    }
    if !aperti {
        return Err(errore(
            false,
            "Gli appunti di Windows sono occupati: l’immagine non è stata preparata.",
        ));
    }
    let _guard = AppuntiAperti;
    unsafe { EmptyClipboard() }.map_err(|error| {
        errore(
            false,
            format!("Gli appunti di Windows non sono modificabili: {error}"),
        )
    })?;

    let mut percorso = path.as_os_str().encode_wide().collect::<Vec<_>>();
    percorso.push(0);
    percorso.push(0);
    let header_len = std::mem::size_of::<DROPFILES>();
    let totale = header_len + percorso.len() * std::mem::size_of::<u16>();
    let memoria = unsafe { GlobalAlloc(GMEM_MOVEABLE, totale) }.map_err(|error| {
        errore(
            false,
            format!("Memoria per l’allegato WhatsApp non disponibile: {error}"),
        )
    })?;
    let puntatore = unsafe { GlobalLock(memoria) };
    if puntatore.is_null() {
        let _ = unsafe { GlobalFree(Some(memoria)) };
        return Err(errore(
            false,
            "Windows non ha preparato l’allegato per WhatsApp.",
        ));
    }
    let header = DROPFILES {
        pFiles: header_len as u32,
        pt: POINT::default(),
        fNC: false.into(),
        fWide: true.into(),
    };
    unsafe {
        std::ptr::copy_nonoverlapping(
            (&header as *const DROPFILES).cast::<u8>(),
            puntatore.cast::<u8>(),
            header_len,
        );
        std::ptr::copy_nonoverlapping(
            percorso.as_ptr().cast::<u8>(),
            puntatore.cast::<u8>().add(header_len),
            percorso.len() * std::mem::size_of::<u16>(),
        );
        let _ = GlobalUnlock(memoria);
    }
    if let Err(error) = unsafe { SetClipboardData(CF_HDROP.0.into(), Some(HANDLE(memoria.0))) } {
        let _ = unsafe { GlobalFree(Some(memoria)) };
        return Err(errore(
            false,
            format!("Windows non ha messo l’allegato negli appunti: {error}"),
        ));
    }
    Ok(RipristinoAppunti(precedente))
}

fn handle_finestra(controlli: &ControlliCompositore) -> Result<HWND, ErroreWhatsAppWindows> {
    let hwnd = unsafe { controlli.finestra.CurrentNativeWindowHandle() }.map_err(|error| {
        errore(
            false,
            format!("WhatsApp non espone la propria finestra nativa: {error}"),
        )
    })?;
    if hwnd.0.is_null() {
        return Err(errore(
            false,
            "WhatsApp non espone una finestra nativa valida.",
        ));
    }
    Ok(hwnd)
}

fn destinazione_input_verificata(controlli: &ControlliCompositore, hwnd: HWND) -> bool {
    let foreground = unsafe { GetForegroundWindow() };
    // Una sessione Windows bloccata/disconnessa può lasciare il focus UIA
    // logico sul compositore ma non avere alcuna finestra in primo piano.
    // In quel caso SendInput viene rifiutato: la coda deve attendere invece di
    // tentare l'invio.
    let in_primo_piano = foreground.0 == hwnd.0;
    let compositore_focalizzato = unsafe { controlli.compositore.CurrentHasKeyboardFocus() }
        .map(|value| value.as_bool())
        .unwrap_or(false);
    in_primo_piano && compositore_focalizzato
}

fn attiva_finestra_e_compositore(
    controlli: &ControlliCompositore,
    annullato: &impl Fn() -> bool,
) -> Result<HWND, ErroreWhatsAppWindows> {
    let hwnd = handle_finestra(controlli)?;
    if annullato() {
        return Err(errore_annullamento());
    }
    porta_whatsapp_in_primo_piano(hwnd);
    unsafe {
        let _ = controlli.compositore.SetFocus();
    }
    thread::sleep(Duration::from_millis(80));
    if destinazione_input_verificata(controlli, hwnd) {
        return Ok(hwnd);
    }

    // SetFocus di UIA può restare soltanto logico quando un'altra finestra ha
    // appena cambiato lo z-order. Un singolo click sul compositore è più
    // deterministico dei ripetuti SetForegroundWindow che facevano lampeggiare
    // WhatsApp; il puntatore viene subito rimesso dov'era.
    let rettangolo =
        unsafe { controlli.compositore.CurrentBoundingRectangle() }.map_err(|error| {
            errore(
                false,
                format!("Il compositore WhatsApp non è localizzabile: {error}"),
            )
        })?;
    if rettangolo.right <= rettangolo.left || rettangolo.bottom <= rettangolo.top {
        return Err(errore(
            false,
            "WhatsApp non espone un'area valida per il campo messaggio.",
        ));
    }
    let punto = POINT {
        x: rettangolo.left + (rettangolo.right - rettangolo.left) / 2,
        y: rettangolo.top + (rettangolo.bottom - rettangolo.top) / 2,
    };
    porta_whatsapp_in_primo_piano(hwnd);
    clicca_punto_whatsapp_verificato(hwnd, punto, "il campo messaggio")?;
    thread::sleep(Duration::from_millis(100));
    if destinazione_input_verificata(controlli, hwnd) {
        return Ok(hwnd);
    }

    if std::env::var("PHARMATEK_WHATSAPP_DIAGNOSTICA").as_deref() == Ok("1") {
        let foreground = unsafe { GetForegroundWindow() };
        let focus = unsafe { controlli.compositore.CurrentHasKeyboardFocus() }
            .map(|value| value.as_bool())
            .unwrap_or(false);
        eprintln!(
            "whatsapp-ui focus non acquisito: hwnd={:?} foreground={:?} focus={focus}",
            hwnd.0, foreground.0
        );
    }
    let mut errore = errore_attivita_utente();
    errore.messaggio =
        "WhatsApp non ha mantenuto il primo piano; la coda riproverà senza modificare altre finestre."
            .into();
    Err(errore)
}

fn sostituisci_testo_compositore(
    controlli: &ControlliCompositore,
    corpo: &str,
    annullato: &impl Fn() -> bool,
) -> Result<u32, ErroreWhatsAppWindows> {
    if annullato() {
        return Err(errore_annullamento());
    }
    let hwnd = attiva_finestra_e_compositore(controlli, annullato)?;
    if annullato() {
        return Err(errore_annullamento());
    }
    if !destinazione_input_verificata(controlli, hwnd) {
        return Err(errore_attivita_utente());
    }

    // È intenzionalmente una sostituzione, non un inserimento: Ctrl+A elimina
    // sia una vecchia bozza sia il testo duplicato da un tentativo interrotto.
    invia_input_tastiera(&[
        input_tasto(VK_CONTROL, false),
        input_tasto(VK_A, false),
        input_tasto(VK_A, true),
        input_tasto(VK_CONTROL, true),
        input_tasto(VK_BACK, false),
        input_tasto(VK_BACK, true),
    ])?;
    if annullato() {
        return Err(errore_annullamento());
    }
    if !destinazione_input_verificata(controlli, hwnd) {
        return Err(errore_attivita_utente());
    }
    let ripristino_appunti = copia_testo_negli_appunti(corpo)?;
    invia_input_tastiera(&[
        input_tasto(VK_CONTROL, false),
        input_tasto(VK_V, false),
        input_tasto(VK_V, true),
        input_tasto(VK_CONTROL, true),
    ])?;
    // Il paste nel contenteditable viene completato in una task WebView2:
    // conserviamo gli appunti fino a quando WhatsApp li ha consumati.
    thread::sleep(Duration::from_millis(100));
    drop(ripristino_appunti);
    marcatore_input_utente().ok_or_else(|| {
        errore(
            false,
            "Windows non ha confermato gli eventi di tastiera inviati a WhatsApp.",
        )
    })
}

fn normalizza_compositore(
    automation: &IUIAutomation,
    controlli: &ControlliCompositore,
    corpo: &str,
    annullato: &impl Fn() -> bool,
) -> Result<u32, ErroreWhatsAppWindows> {
    // Un tentativo precedente può avere già lasciato il corpo esatto nel
    // compositore: in quel caso non lo tocchiamo. Normalmente il deep-link
    // contiene invece soltanto il marcatore neutro e si passa alla sostituzione.
    if compositore_contiene_testo(automation, &controlli.compositore, corpo) {
        let hwnd = attiva_finestra_e_compositore(controlli, annullato)?;
        if !destinazione_input_verificata(controlli, hwnd) {
            return Err(errore_attivita_utente());
        }
        return marcatore_input_utente().ok_or_else(|| {
            errore(
                false,
                "Windows non ha confermato il focus del testo preparato da WhatsApp.",
            )
        });
    }

    // Ripiego per eventuali installazioni che non supportano il parametro
    // `text` nel protocollo: conserva il comportamento precedente, sottoposto
    // alla stessa verifica esatta prima dell'invio.
    let marcatore = sostituisci_testo_compositore(controlli, corpo, annullato)?;
    verifica_testo_compositore_con_appunti(controlli, corpo, Some(marcatore), annullato)
}

fn compositore_vuoto_con_appunti(controlli: &ControlliCompositore) -> Option<bool> {
    let hwnd = handle_finestra(controlli).ok()?;
    if !destinazione_input_verificata(controlli, hwnd) {
        return None;
    }
    let ripristino_appunti = RipristinoAppunti(unsafe { OleGetClipboard() }.ok());
    let mut aperti = false;
    for _ in 0..8 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            aperti = true;
            break;
        }
        thread::sleep(Duration::from_millis(15));
    }
    if !aperti {
        return None;
    }
    {
        let _guard = AppuntiAperti;
        if unsafe { EmptyClipboard() }.is_err() {
            return None;
        }
    }
    if invia_input_tastiera(&[
        input_tasto(VK_CONTROL, false),
        input_tasto(VK_A, false),
        input_tasto(VK_A, true),
        input_tasto(VK_CONTROL, true),
    ])
    .is_err()
    {
        return None;
    }
    thread::sleep(Duration::from_millis(35));
    if invia_input_tastiera(&[
        input_tasto(VK_CONTROL, false),
        input_tasto(windows::Win32::UI::Input::KeyboardAndMouse::VK_C, false),
        input_tasto(windows::Win32::UI::Input::KeyboardAndMouse::VK_C, true),
        input_tasto(VK_CONTROL, true),
    ])
    .is_err()
    {
        return None;
    }
    let scadenza = Instant::now() + Duration::from_millis(500);
    let copiato = loop {
        if let Some(testo) = testo_unicode_dagli_appunti() {
            break Some(testo);
        }
        if Instant::now() >= scadenza {
            break None;
        }
        thread::sleep(Duration::from_millis(20));
    };
    let _ = invia_input_tastiera(&[input_tasto(VK_END, false), input_tasto(VK_END, true)]);
    drop(ripristino_appunti);
    Some(
        copiato
            .as_deref()
            .map(normalizza_testo)
            .is_none_or(|testo| testo.is_empty()),
    )
}

fn attendi_compositore_svuotato(
    automation: &IUIAutomation,
    controlli: &ControlliCompositore,
    annullato: &impl Fn() -> bool,
) -> Result<(), ErroreWhatsAppWindows> {
    let scadenza = Instant::now() + ATTESA_NORMALIZZAZIONE;
    loop {
        if annullato() {
            // Il comando Invia è già stato azionato: interrompere qui non rende
            // sicuro un retry automatico.
            return Err(errore(
                true,
                "Invio azionato mentre la campagna veniva annullata: verifica la chat prima di un eventuale reinvio.",
            ));
        }
        // WebView2 può mantenere per alcuni secondi l'intero albero UIA
        // obsoleto anche dopo avere consumato la bozza. La lettura diretta del
        // contenuto selezionato non dipende da quella cache.
        if compositore_vuoto_con_appunti(controlli) == Some(true) {
            return Ok(());
        }
        // Se gli appunti non sono momentaneamente disponibili, il ritorno del
        // pulsante vocale resta una seconda conferma indipendente.
        if primo_pulsante_per_nomi(automation, &controlli.finestra, NOMI_VOCALE)
            .ok()
            .flatten()
            .is_some_and(|pulsante| {
                pulsante_accanto_al_compositore(&pulsante, &controlli.compositore)
            })
        {
            return Ok(());
        }
        if Instant::now() >= scadenza {
            return Err(errore(
                true,
                "WhatsApp ha ricevuto il comando Invia, ma il compositore non si è svuotato: verifica la chat prima di un eventuale reinvio.",
            ));
        }
        thread::sleep(PASSO_ATTESA);
    }
}

pub(super) fn aziona_invio(
    numero: &str,
    destinatario: &str,
    corpo: &str,
    testo_apertura: &str,
    autorizzazione_input: Option<u32>,
    annullato: impl Fn() -> bool,
) -> Result<DestinazioneWhatsAppWindows, ErroreWhatsAppWindows> {
    aziona_invio_interno(
        numero,
        destinatario,
        corpo,
        testo_apertura,
        autorizzazione_input,
        annullato,
        true,
    )
}

/// Prepara e verifica il testo nella conversazione, senza inviarlo come
/// messaggio autonomo. Il successivo paste del file lo porta nell'anteprima,
/// dove verrà riscritto e verificato come didascalia prima del click su Invia.
pub(super) fn prepara_invio_allegato_con_didascalia(
    numero: &str,
    destinatario: &str,
    corpo: &str,
    testo_apertura: &str,
    autorizzazione_input: Option<u32>,
    annullato: impl Fn() -> bool,
) -> Result<DestinazioneWhatsAppWindows, ErroreWhatsAppWindows> {
    aziona_invio_interno(
        numero,
        destinatario,
        corpo,
        testo_apertura,
        autorizzazione_input,
        annullato,
        false,
    )
}

fn aziona_invio_interno(
    numero: &str,
    destinatario: &str,
    corpo: &str,
    testo_apertura: &str,
    autorizzazione_input: Option<u32>,
    annullato: impl Fn() -> bool,
    invia_testo: bool,
) -> Result<DestinazioneWhatsAppWindows, ErroreWhatsAppWindows> {
    let iniziato = Instant::now();
    let risultato = aziona_invio_interno_impl(
        numero,
        destinatario,
        corpo,
        testo_apertura,
        autorizzazione_input,
        annullato,
        invia_testo,
    );
    match &risultato {
        Ok(_) => registra_esito(true, None, iniziato.elapsed()),
        Err(error) => registra_esito(false, Some(error), iniziato.elapsed()),
    }
    risultato
}

fn aziona_invio_interno_impl(
    numero: &str,
    destinatario: &str,
    corpo: &str,
    testo_apertura: &str,
    autorizzazione_input: Option<u32>,
    annullato: impl Fn() -> bool,
    invia_testo: bool,
) -> Result<DestinazioneWhatsAppWindows, ErroreWhatsAppWindows> {
    let corpo_preparato = testo_senza_elenchi_automatici(corpo);
    let corpo = corpo_preparato.as_str();
    let iniziato = Instant::now();
    let diagnostica = std::env::var("PHARMATEK_WHATSAPP_DIAGNOSTICA").as_deref() == Ok("1");
    let mut autorizzazione_input = autorizzazione_input;
    if annullato() {
        return Err(errore_annullamento());
    }
    // La disponibilita del PC e gia stata verificata prima di aprire il
    // deep-link. L'apertura di `whatsapp://` puo aggiornare brevemente il
    // marcatore di input di Windows: ricontrollarlo qui faceva differire
    // subito l'invio e, a ogni retry, accodava un altro "·" alla bozza.
    // L'attesa sottostante assorbe quel solo assestamento e continua comunque
    // a fermarsi se l'operatore usa davvero mouse o tastiera.
    let mut ripristini_automazione = 0_u8;
    let mut riaperture_deeplink = 0_u8;
    'riavvia_automazione: loop {
        let com = ComApartment::init()?;
        let automation: IUIAutomation = unsafe {
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(|error| {
                errore(
                    false,
                    format!("Windows UI Automation non disponibile: {error}"),
                )
            })?
        };

        // Lascia a WhatsApp il tempo minimo per applicare il deep-link col numero.
        thread::sleep(ATTESA_DEEPLINK_MINIMA);
        if annullato() {
            return Err(errore_annullamento());
        }
        attendi_pc_libero_dopo_apertura(autorizzazione_input)?;
        let mut marcatore_sicurezza = marcatore_input_utente();

        // Troviamo il compositore della chat aperta anche se contiene una bozza
        // precedente. Il pulsante può essere il microfono (campo vuoto) oppure
        // Invia (bozza presente).
        let scadenza_apertura = Instant::now() + ATTESA_APERTURA;
        let preparati = loop {
            if annullato() {
                return Err(errore_annullamento());
            }
            let verifica_interruzione = || {
                if annullato() {
                    Err(errore_annullamento())
                } else {
                    verifica_input_invariato(marcatore_sicurezza)
                }
            };
            let fase = Instant::now();
            let focalizzati = trova_controlli_preparabili_focalizzati(
                &automation,
                numero,
                destinatario,
                testo_apertura,
                &verifica_interruzione,
            );
            diagnostica_tempi(diagnostica, fase, "durata ricerca compositore focalizzato");
            match focalizzati {
                Ok(Some(controlli)) => {
                    diagnostica_tempi(
                        diagnostica,
                        iniziato,
                        "chat e compositore focalizzati verificati",
                    );
                    break controlli;
                }
                Err(error) if error.attivita_utente || annullato() => return Err(error),
                _ => {}
            }
            let fase = Instant::now();
            let numero_non_whatsapp = focus_indica_avviso_numero_non_whatsapp(&automation)
                && rileva_numero_non_whatsapp(&automation);
            diagnostica_tempi(diagnostica, fase, "durata verifica rapida numero WhatsApp");
            if numero_non_whatsapp {
                return Err(errore(
                false,
                format!(
                    "Il numero {numero} non risulta associato a WhatsApp. L'invio non è stato effettuato."
                ),
            ));
            }
            let verifica_interruzione = || {
                if annullato() {
                    Err(errore_annullamento())
                } else {
                    verifica_input_invariato(marcatore_sicurezza)
                }
            };
            let fase = Instant::now();
            let controlli = trova_controlli_preparabili(
                &automation,
                numero,
                destinatario,
                testo_apertura,
                &verifica_interruzione,
            );
            diagnostica_tempi(diagnostica, fase, "durata ricerca globale compositore");
            match controlli {
                Ok(Some(controlli)) => {
                    diagnostica_tempi(diagnostica, iniziato, "chat e compositore verificati");
                    break controlli;
                }
                Ok(None) => {}
                Err(error) if error.attivita_utente || annullato() => return Err(error),
                Err(error) if Instant::now() >= scadenza_apertura => {
                    return Err(errore(
                        false,
                        format!(
                            "Verifica del compositore WhatsApp non riuscita: {}",
                            error.messaggio
                        ),
                    ))
                }
                Err(_) => {}
            }
            if ripristini_automazione > 0 {
                if ripristini_automazione >= 3 {
                    return Err(errore(
                        false,
                        "WhatsApp non ha aggiornato il compositore dopo la chiusura dell’allegato.",
                    ));
                }
                ripristini_automazione += 1;
                let cifre_numero = cifre(numero);
                let url = format!(
                    "whatsapp://send?phone={}&text=%C2%B7",
                    cifre_numero.strip_prefix("00").unwrap_or(&cifre_numero)
                );
                crate::platform::apri_url_sistema(&url).map_err(|_| {
                    errore(
                        false,
                        "WhatsApp non ha riaperto la conversazione dopo la chiusura dell’allegato.",
                    )
                })?;
                drop(automation);
                drop(com);
                thread::sleep(Duration::from_secs(2));
                continue 'riavvia_automazione;
            }
            let fase = Instant::now();
            let ripristino =
                ripristina_modalita_allegato(&automation, marcatore_sicurezza, &annullato)?;
            diagnostica_tempi(diagnostica, fase, "durata verifica anteprima allegato");
            if let Some(marcatore) = ripristino {
                autorizzazione_input = Some(marcatore);
                verifica_pc_libero(autorizzazione_input)?;
                if ripristini_automazione >= 3 {
                    return Err(errore(
                    false,
                    "WhatsApp non ha stabilizzato il compositore dopo la chiusura dell’allegato.",
                ));
                }
                ripristini_automazione += 1;
                drop(automation);
                drop(com);
                thread::sleep(Duration::from_secs(2));
                continue 'riavvia_automazione;
            }
            // La chiusura dell'overlay WebView2 può materializzare il compositore
            // mentre la verifica precedente sta terminando. Lo rileggiamo prima
            // della scansione (più costosa) del dialog di numero non valido.
            let verifica_interruzione = || {
                if annullato() {
                    Err(errore_annullamento())
                } else {
                    verifica_input_invariato(marcatore_sicurezza)
                }
            };
            let fase = Instant::now();
            if let Some(controlli) = trova_controlli_preparabili(
                &automation,
                numero,
                destinatario,
                testo_apertura,
                &verifica_interruzione,
            )? {
                diagnostica_tempi(diagnostica, fase, "compositore dopo ripristino verificato");
                break controlli;
            }
            diagnostica_tempi(
                diagnostica,
                fase,
                "durata rilettura compositore dopo ripristino",
            );
            let fase = Instant::now();
            let numero_non_whatsapp = rileva_numero_non_whatsapp(&automation);
            diagnostica_tempi(
                diagnostica,
                fase,
                "durata verifica completa numero WhatsApp",
            );
            if numero_non_whatsapp {
                return Err(errore(
                false,
                format!(
                    "Il numero {numero} non risulta associato a WhatsApp. L'invio non è stato effettuato."
                ),
            ));
            }
            if Instant::now() >= scadenza_apertura {
                // La chiusura del dialog "numero non presente" può consumare il
                // deep-link del destinatario seguente mentre WebView2 sta ancora
                // sostituendo il proprio albero UIA. Non essendo stato premuto
                // Invia, riaprire una sola volta la stessa chat è sicuro. Questo
                // ramo resta fuori dal percorso rapido degli invii normali.
                if riaperture_deeplink == 0 {
                    riaperture_deeplink = 1;
                    let url =
                        crate::app::communication::url_whatsapp_con_testo(numero, testo_apertura);
                    crate::platform::apri_url_sistema(&url).map_err(|_| {
                        errore(
                            false,
                            "WhatsApp non ha riaperto la conversazione dopo il destinatario non disponibile.",
                        )
                    })?;
                    drop(automation);
                    drop(com);
                    continue 'riavvia_automazione;
                }
                return Err(errore(
                    false,
                    "WhatsApp è aperto, ma il campo messaggio non è stato verificato. L'invio non è stato premuto.",
            ));
            }
            thread::sleep(PASSO_ATTESA);
        };

        if annullato() {
            return Err(errore_annullamento());
        }
        if ripristini_automazione > 0 {
            // Dopo la chiusura di preview/dialog WebView2 pubblica il nuovo
            // compositore prima che il layer di transizione smetta di
            // intercettare i click. Un solo assestamento evita il falso click.
            thread::sleep(Duration::from_millis(1_200));
        }
        verifica_input_invariato(marcatore_sicurezza)?;
        verifica_pc_libero(autorizzazione_input)?;
        let marcatore = normalizza_compositore(&automation, &preparati, corpo, &annullato)?;
        // Autorizza esclusivamente gli eventi SendInput appena prodotti.
        // Qualsiasi input successivo dell'operatore ferma il click.
        autorizzazione_input = Some(marcatore);
        marcatore_sicurezza = Some(marcatore);
        diagnostica_tempi(diagnostica, iniziato, "bozza sostituita e normalizzata");

        let scadenza_invia = Instant::now() + ATTESA_NORMALIZZAZIONE;
        let controlli = loop {
            if annullato() {
                return Err(errore_annullamento());
            }
            let verifica_interruzione = || {
                if annullato() {
                    Err(errore_annullamento())
                } else {
                    verifica_input_invariato(marcatore_sicurezza)
                }
            };
            match controlli_pronti_dopo_scrittura(&automation, &preparati, &verifica_interruzione) {
                Ok(Some(controlli)) => {
                    diagnostica_tempi(diagnostica, iniziato, "testo e pulsante Invia verificati");
                    break controlli;
                }
                Ok(None) if Instant::now() < scadenza_invia => thread::sleep(PASSO_ATTESA),
                Ok(None) => {
                    return Err(errore(
                    false,
                    "WhatsApp non ha confermato il testo esatto e il pulsante Invia. L'invio non è stato premuto.",
                ));
                }
                Err(error) if error.attivita_utente || annullato() => return Err(error),
                Err(_) if Instant::now() < scadenza_invia => thread::sleep(PASSO_ATTESA),
                Err(error) => {
                    return Err(errore(
                        false,
                        format!(
                            "Verifica del pulsante Invia non riuscita: {}",
                            error.messaggio
                        ),
                    ))
                }
            }
        };

        if !invia_testo {
            return Ok(DestinazioneWhatsAppWindows {
                nome_compositore: normalizza_identita(&nome(&controlli.compositore)),
            });
        }

        if annullato() {
            return Err(errore_annullamento());
        }
        verifica_input_invariato(marcatore_sicurezza)?;
        verifica_pc_libero(autorizzazione_input)?;
        let pulsante_accanto =
            pulsante_accanto_al_compositore(&controlli.invia, &controlli.compositore);
        let pulsante_invocabile = unsafe {
            controlli
                .invia
                .GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId)
        }
        .is_ok();
        if pulsante_accanto && (nome_pulsante_invia(&nome(&controlli.invia)) || pulsante_invocabile)
        {
            clicca_pulsante_invia(&controlli, &annullato)?;
            diagnostica_tempi(diagnostica, iniziato, "pulsante Invia cliccato");
        } else {
            invia_compositore_con_enter(&controlli, &annullato)?;
            diagnostica_tempi(diagnostica, iniziato, "Invio azionato con Enter");
        }
        attendi_compositore_svuotato(&automation, &controlli, &annullato)?;
        diagnostica_tempi(diagnostica, iniziato, "svuotamento compositore verificato");

        // Lo storico distingue intenzionalmente "invio azionato" da "consegna
        // verificata": confermiamo che WhatsApp abbia consumato la bozza, non che
        // il messaggio sia già stato consegnato al destinatario.
        return Ok(DestinazioneWhatsAppWindows {
            nome_compositore: normalizza_identita(&nome(&controlli.compositore)),
        });
    }
}

/// Invia un file già generato nella stessa chat. Quando `didascalia` è presente,
/// il testo viene scritto e verificato nel campo dell'anteprima: non parte quindi
/// come secondo messaggio separato. Gli appunti originali vengono ripristinati.
pub(super) fn aziona_invio_allegato(
    path: &Path,
    destinazione: &DestinazioneWhatsAppWindows,
    didascalia: Option<&str>,
    autorizzazione_input: Option<u32>,
    annullato: impl Fn() -> bool,
) -> Result<(), ErroreWhatsAppWindows> {
    let iniziato = Instant::now();
    let risultato = aziona_invio_allegato_impl(
        path,
        destinazione,
        didascalia,
        autorizzazione_input,
        annullato,
    );
    match &risultato {
        Ok(()) => registra_esito(true, None, iniziato.elapsed()),
        Err(error) => registra_esito(false, Some(error), iniziato.elapsed()),
    }
    risultato
}

fn aziona_invio_allegato_impl(
    path: &Path,
    destinazione: &DestinazioneWhatsAppWindows,
    didascalia: Option<&str>,
    autorizzazione_input: Option<u32>,
    annullato: impl Fn() -> bool,
) -> Result<(), ErroreWhatsAppWindows> {
    let didascalia_preparata = didascalia.map(testo_senza_elenchi_automatici);
    let didascalia = didascalia_preparata.as_deref();
    let diagnostica = std::env::var("PHARMATEK_WHATSAPP_DIAGNOSTICA").as_deref() == Ok("1");
    let iniziato = Instant::now();
    let mut autorizzazione_input = autorizzazione_input;
    if annullato() {
        return Err(errore_annullamento());
    }
    verifica_pc_libero(autorizzazione_input)?;
    let _com = ComApartment::init()?;
    let automation: IUIAutomation = unsafe {
        CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(|error| {
            errore(
                false,
                format!("Windows UI Automation non disponibile: {error}"),
            )
        })?
    };
    let mut marcatore_prima = marcatore_input_utente();
    let preparati_iniziali = {
        let verifica_interruzione = || {
            if annullato() {
                Err(errore_annullamento())
            } else {
                verifica_input_invariato(marcatore_prima)
            }
        };
        trova_controlli_preparabili(&automation, "", "", "", &verifica_interruzione)?
    };
    let preparati = if let Some(controlli) = preparati_iniziali {
        controlli
    } else {
        if let Some(marcatore) =
            ripristina_modalita_allegato(&automation, marcatore_prima, &annullato)?
        {
            autorizzazione_input = Some(marcatore);
            marcatore_prima = Some(marcatore);
            verifica_pc_libero(autorizzazione_input)?;
        }
        let verifica_interruzione = || {
            if annullato() {
                Err(errore_annullamento())
            } else {
                verifica_input_invariato(marcatore_prima)
            }
        };
        trova_controlli_preparabili(&automation, "", "", "", &verifica_interruzione)?.ok_or_else(
            || {
                errore(
                    false,
                    "Il compositore WhatsApp non è verificabile per allegare il documento.",
                )
            },
        )?
    };
    if !destinazione_allegato_invariata(
        &destinazione.nome_compositore,
        &nome(&preparati.compositore),
    ) {
        let mut error = errore_attivita_utente();
        error.messaggio =
            "La conversazione WhatsApp è cambiata dopo il testo: il documento resta in coda e non è stato allegato."
                .into();
        return Err(error);
    }
    let hwnd = attiva_finestra_e_compositore(&preparati, &annullato)?;
    if !destinazione_input_verificata(&preparati, hwnd) {
        return Err(errore_attivita_utente());
    }
    diagnostica_tempi(diagnostica, iniziato, "compositore per allegato verificato");
    // È sufficiente lasciare a WebView2 un breve ciclo per registrare il paste;
    // l'attesa lunga precedente rendeva ogni allegato inutilmente lento.
    thread::sleep(Duration::from_millis(180));
    if !destinazione_input_verificata(&preparati, hwnd) {
        return Err(errore_attivita_utente());
    }
    let ripristino_appunti = copia_file_negli_appunti(path)?;
    thread::sleep(Duration::from_millis(50));
    invia_input_tastiera(&[
        input_tasto(VK_CONTROL, false),
        input_tasto(VK_V, false),
        input_tasto(VK_V, true),
        input_tasto(VK_CONTROL, true),
    ])?;
    diagnostica_tempi(diagnostica, iniziato, "paste allegato eseguito");
    let marcatore_paste = marcatore_input_utente().ok_or_else(|| {
        errore(
            false,
            "Windows non ha confermato l’inserimento del documento in WhatsApp.",
        )
    })?;

    // Le immagini sono disponibili quasi subito. I PDF richiedono un po' più
    // di decodifica, ma la verifica successiva resta adattiva fino alla scadenza.
    let attesa_materializzazione = if path
        .extension()
        .and_then(|estensione| estensione.to_str())
        .is_some_and(|estensione| estensione.eq_ignore_ascii_case("pdf"))
    {
        Duration::from_millis(650)
    } else {
        Duration::from_millis(180)
    };
    thread::sleep(attesa_materializzazione);
    let scadenza = Instant::now() + ATTESA_ANTEPRIMA_ALLEGATO;
    let (invia, compositore_didascalia_trovato) = loop {
        if annullato() {
            return Err(errore_annullamento());
        }
        verifica_input_invariato(Some(marcatore_paste))?;
        let pulsante =
            primo_pulsante_per_nomi(&automation, &preparati.finestra, NOMI_INVIA_ALLEGATO)
                .map_err(|error| {
                    errore(
                        false,
                        format!("Anteprima dell’allegato WhatsApp non verificabile: {error}"),
                    )
                })?;
        if let Some(pulsante) = pulsante {
            let compositore_didascalia_trovato = if didascalia.is_some() {
                compositore_didascalia(&automation, &preparati.finestra, &pulsante).map_err(
                    |error| {
                        errore(
                            false,
                            format!("Campo didascalia WhatsApp non verificabile: {error}"),
                        )
                    },
                )?
            } else {
                None
            };
            if didascalia.is_none() || compositore_didascalia_trovato.is_some() {
                diagnostica_tempi(diagnostica, iniziato, "anteprima allegato verificata");
                break (pulsante, compositore_didascalia_trovato);
            }
        }
        if Instant::now() >= scadenza {
            return Err(errore(
                false,
                "WhatsApp non ha aperto un’anteprima verificabile del documento.",
            ));
        }
        thread::sleep(PASSO_ATTESA);
    };
    let mut marcatore_azione = marcatore_paste;
    let compositore_click = if let Some(testo) = didascalia {
        let compositore = compositore_didascalia_trovato.ok_or_else(|| {
            errore(
                false,
                "WhatsApp ha aperto l’anteprima, ma non espone un campo didascalia verificabile.",
            )
        })?;
        let controlli_didascalia = ControlliCompositore {
            finestra: preparati.finestra.clone(),
            compositore,
            invia: invia.clone(),
        };
        if compositore_contiene_testo(&automation, &controlli_didascalia.compositore, testo) {
            // WhatsApp trasferisce normalmente la bozza del deep-link nella
            // didascalia durante il paste: se è già esatta non tocchiamo focus
            // o appunti, rendendo l'invio molto più rapido.
            verifica_input_invariato(Some(marcatore_azione))?;
        } else {
            let marcatore =
                sostituisci_testo_compositore(&controlli_didascalia, testo, &annullato)?;
            marcatore_azione = verifica_testo_compositore_con_appunti(
                &controlli_didascalia,
                testo,
                Some(marcatore),
                &annullato,
            )?;
        }
        diagnostica_tempi(diagnostica, iniziato, "didascalia allegato verificata");
        controlli_didascalia.compositore
    } else {
        preparati.compositore.clone()
    };
    // WhatsApp ha già materializzato l'anteprima: restituiamo subito all'utente
    // gli appunti precedenti prima di produrre l'effetto esterno.
    drop(ripristino_appunti);
    verifica_input_invariato(Some(marcatore_azione))?;
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.0 != hwnd.0 {
        return Err(errore_attivita_utente());
    }
    let controlli = ControlliCompositore {
        finestra: preparati.finestra,
        compositore: compositore_click,
        invia,
    };
    clicca_pulsante_invia(&controlli, &annullato)?;
    diagnostica_tempi(diagnostica, iniziato, "pulsante Invia allegato cliccato");

    let scadenza_chiusura = Instant::now() + ATTESA_NORMALIZZAZIONE;
    loop {
        let ancora_visibile = unsafe { controlli.invia.CurrentIsOffscreen() }
            .map(|value| !value.as_bool())
            .unwrap_or(false);
        if !ancora_visibile {
            diagnostica_tempi(
                diagnostica,
                iniziato,
                "chiusura anteprima allegato verificata",
            );
            return Ok(());
        }
        if Instant::now() >= scadenza_chiusura {
            return Err(errore(
                true,
                "WhatsApp ha ricevuto Invia per il documento, ma l’anteprima non si è chiusa: verifica la chat.",
            ));
        }
        thread::sleep(PASSO_ATTESA);
    }
}

/// WhatsApp è un'app esterna: non la terminiamo, ma a batch concluso la
/// rimettiamo in secondo piano così non resta davanti al gestionale.
pub(super) fn minimizza_finestre() {
    // Percorso immediato: WhatsApp Desktop usa normalmente questo titolo nativo.
    // Il fallback UIA sottostante copre eventuali finestre/versioni differenti.
    if let Ok(hwnd) = unsafe { FindWindowW(PCWSTR::null(), w!("WhatsApp")) } {
        let _ = unsafe { ShowWindowAsync(hwnd, SW_MINIMIZE) };
    }
    let Ok(_com) = ComApartment::init() else {
        return;
    };
    let Ok(automation): Result<IUIAutomation, _> =
        (unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) })
    else {
        return;
    };
    let Ok(finestre) = finestre_whatsapp(&automation) else {
        return;
    };
    for finestra in finestre {
        let Ok(pattern): Result<IUIAutomationWindowPattern, _> =
            (unsafe { finestra.GetCurrentPatternAs(UIA_WindowPatternId) })
        else {
            continue;
        };
        let puo_minimizzare = unsafe { pattern.CurrentCanMinimize() }
            .map(|value| value.as_bool())
            .unwrap_or(false);
        if puo_minimizzare {
            let _ = unsafe { pattern.SetWindowVisualState(WindowVisualState_Minimized) };
        }
    }
}

fn protocollo_whatsapp_registrato() -> bool {
    [r"HKCU\Software\Classes\whatsapp", r"HKCR\whatsapp"]
        .iter()
        .any(|chiave| {
            comando_senza_finestra("reg.exe")
                .args(["query", chiave])
                .output()
                .is_ok_and(|output| output.status.success())
        })
}

fn comando_senza_finestra(programma: &str) -> std::process::Command {
    let mut comando = std::process::Command::new(programma);
    comando.creation_flags(CREATE_NO_WINDOW.0);
    comando
}

fn versione_file(percorso: &str) -> String {
    if percorso.trim().is_empty() {
        return String::new();
    }
    comando_senza_finestra("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-Item -LiteralPath $args[0]).VersionInfo.FileVersion",
            "--",
            percorso,
        ])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}

pub fn diagnostica_get() -> WhatsappDiagnosticaDto {
    // Questa funzione è chiamata soltanto da una richiesta esplicita della UI:
    // registro e versione del file non entrano mai nel percorso di invio.
    let _ = ComApartment::init().and_then(|_| {
        let automation: IUIAutomation = unsafe {
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
                .map_err(|error| errore(false, error.to_string()))?
        };
        finestre_whatsapp(&automation)
            .map(|_| ())
            .map_err(|error| errore(false, error.to_string()))
    });
    let mut cache = cache_finestra()
        .lock()
        .expect("whatsapp window cache poisoned")
        .clone();
    if cache.percorso.is_empty() && cache.pid != 0 {
        cache.percorso = percorso_processo(cache.pid).unwrap_or_default();
        if let Some(nome) = Path::new(&cache.percorso)
            .file_name()
            .and_then(|value| value.to_str())
        {
            cache.processo = nome.to_string();
        }
    }
    if cache.pacchetto.is_empty() && cache.pid != 0 {
        cache.pacchetto = famiglia_pacchetto_processo(cache.pid).unwrap_or_default();
    }
    *cache_finestra()
        .lock()
        .expect("whatsapp window cache poisoned") = cache.clone();
    let ultimo_esito = ultimo_esito()
        .lock()
        .expect("whatsapp diagnostics poisoned")
        .clone();
    let campioni = prestazioni()
        .lock()
        .expect("whatsapp performance poisoned")
        .clone();
    let (mediana_ms, percentile_95_ms) = riepiloga_prestazioni(&campioni);
    WhatsappDiagnosticaDto {
        protocollo_registrato: protocollo_whatsapp_registrato(),
        finestra_rilevata: cache.hwnd != 0,
        processo: cache.processo,
        pacchetto: cache.pacchetto,
        versione: versione_file(&cache.percorso),
        identificazione_fallback: cache.trovata_con_fallback,
        campioni_prestazioni: campioni.len(),
        mediana_ms,
        percentile_95_ms,
        ultimo_esito,
    }
}

pub fn diagnostica_rapida_get() -> WhatsappDiagnosticaDto {
    // Usata per comporre la schermata Impostazioni: nessuna scansione UIA,
    // processo figlio, registro o lettura della versione dal disco.
    let cache = cache_finestra()
        .lock()
        .expect("whatsapp window cache poisoned")
        .clone();
    let ultimo_esito = ultimo_esito()
        .lock()
        .expect("whatsapp diagnostics poisoned")
        .clone();
    let campioni = prestazioni()
        .lock()
        .expect("whatsapp performance poisoned")
        .clone();
    let (mediana_ms, percentile_95_ms) = riepiloga_prestazioni(&campioni);
    WhatsappDiagnosticaDto {
        protocollo_registrato: false,
        finestra_rilevata: cache.hwnd != 0,
        processo: cache.processo,
        pacchetto: cache.pacchetto,
        versione: String::new(),
        identificazione_fallback: cache.trovata_con_fallback,
        campioni_prestazioni: campioni.len(),
        mediana_ms,
        percentile_95_ms,
        ultimo_esito,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        aziona_invio, classifica_errore, compositore_contiene_testo, intestazione_corrisponde,
        nome_pulsante_chiudi_allegato, nome_pulsante_conferma_interruzione, nome_pulsante_invia,
        nome_pulsante_vocale, normalizza_testo, riepiloga_prestazioni, testo_chiede_interruzione,
        testo_indica_modalita_allegato, testo_indica_numero_non_whatsapp, CUIAutomation,
        CoCreateInstance, ComApartment, IUIAutomation, CLSCTX_INPROC_SERVER,
    };
    use std::collections::VecDeque;

    #[test]
    fn statistiche_prestazioni_calcolano_mediana_e_percentile_95() {
        let campioni = VecDeque::from([100, 90, 130, 110, 95, 105, 120, 125, 115, 1_000]);
        assert_eq!(riepiloga_prestazioni(&campioni), (115, 1_000));
        assert_eq!(riepiloga_prestazioni(&VecDeque::new()), (0, 0));
    }

    #[test]
    fn errori_whatsapp_indicano_la_fase_operativa() {
        assert_eq!(
            classifica_errore("WhatsApp è aperto, ma il campo messaggio non è verificato"),
            ("compositore_non_verificato", "compositore")
        );
        assert_eq!(
            classifica_errore("Il pulsante Invia di WhatsApp non è localizzabile"),
            ("invio_non_verificato", "invio")
        );
        assert_eq!(
            classifica_errore("L’anteprima del documento non si è chiusa"),
            ("allegato_non_verificato", "allegato")
        );
    }

    fn attendi_pc_libero_per_collaudo() {
        while !super::pc_pronto_per_whatsapp() {
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
    }

    fn errore_fase(
        fase: &str,
        mut error: super::ErroreWhatsAppWindows,
    ) -> super::ErroreWhatsAppWindows {
        error.messaggio = format!("{fase}: {}", error.messaggio);
        error
    }

    fn prepara_anteprima_allegato_senza_inviare(
        path: &std::path::Path,
    ) -> Result<(), super::ErroreWhatsAppWindows> {
        prepara_anteprima_allegato_senza_inviare_con_ripristini(path, 2)
    }

    fn prepara_anteprima_allegato_senza_inviare_con_ripristini(
        path: &std::path::Path,
        ripristini_rimasti: u8,
    ) -> Result<(), super::ErroreWhatsAppWindows> {
        eprintln!("collaudo-allegato: attesa quiete iniziale");
        attendi_pc_libero_per_collaudo();
        let autorizzazione_input = super::marcatore_input_utente();
        super::verifica_pc_libero(autorizzazione_input)
            .map_err(|error| errore_fase("quiete iniziale", error))?;
        let com =
            ComApartment::init().map_err(|error| errore_fase("inizializzazione COM", error))?;
        let automation: IUIAutomation = unsafe {
            CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(|error| {
                super::errore(
                    false,
                    format!("Windows UI Automation non disponibile: {error}"),
                )
            })?
        };
        let marcatore = super::marcatore_input_utente();
        if super::ripristina_modalita_allegato(&automation, marcatore, &|| false)
            .map_err(|error| errore_fase("ripristino iniziale", error))?
            .is_some()
        {
            if ripristini_rimasti == 0 {
                return Err(super::errore(
                    false,
                    "WhatsApp non ha stabilizzato il compositore per preparare il collaudo.",
                ));
            }
            // WebView2 può mantenere nell'istanza UIA corrente un elemento ormai
            // rimosso. Ricreare COM/UIA rispecchia il percorso produttivo e
            // permette al test di osservare il nuovo albero accessibile.
            drop(automation);
            drop(com);
            std::thread::sleep(std::time::Duration::from_secs(2));
            return prepara_anteprima_allegato_senza_inviare_con_ripristini(
                path,
                ripristini_rimasti - 1,
            );
        }
        let verifica_interruzione = || {
            super::verifica_input_invariato(marcatore)
                .map_err(|error| errore_fase("ricerca compositore", error))
        };
        let scadenza = std::time::Instant::now() + super::ATTESA_APERTURA;
        eprintln!("collaudo-allegato: ricerca compositore");
        let preparati = loop {
            if let Some(controlli) =
                super::trova_controlli_preparabili(&automation, "", "", "", &verifica_interruzione)?
            {
                break controlli;
            }
            if std::time::Instant::now() >= scadenza {
                return Err(super::errore(
                    false,
                    "Il compositore WhatsApp non è disponibile per preparare il collaudo.",
                ));
            }
            std::thread::sleep(super::PASSO_ATTESA);
        };
        eprintln!("collaudo-allegato: attivazione compositore");
        let hwnd = super::attiva_finestra_e_compositore(&preparati, &|| false)
            .map_err(|error| errore_fase("attivazione compositore", error))?;
        if !super::destinazione_input_verificata(&preparati, hwnd) {
            return Err(errore_fase(
                "verifica focus compositore",
                super::errore_attivita_utente(),
            ));
        }
        let ripristino_appunti = super::copia_file_negli_appunti(path)
            .map_err(|error| errore_fase("preparazione appunti", error))?;
        eprintln!("collaudo-allegato: paste documento");
        super::invia_input_tastiera(&[
            super::input_tasto(super::VK_CONTROL, false),
            super::input_tasto(super::VK_V, false),
            super::input_tasto(super::VK_V, true),
            super::input_tasto(super::VK_CONTROL, true),
        ])
        .map_err(|error| errore_fase("paste allegato", error))?;
        let marcatore_paste = super::marcatore_input_utente().ok_or_else(|| {
            super::errore(
                false,
                "Windows non ha confermato il paste del documento di collaudo.",
            )
        })?;
        let scadenza_anteprima = std::time::Instant::now() + super::ATTESA_ANTEPRIMA_ALLEGATO;
        eprintln!("collaudo-allegato: verifica anteprima");
        loop {
            super::verifica_input_invariato(Some(marcatore_paste))
                .map_err(|error| errore_fase("attesa anteprima", error))?;
            if super::finestra_in_modalita_allegato(&automation, &preparati.finestra).map_err(
                |error| {
                    super::errore(
                        false,
                        format!("Anteprima del collaudo non verificabile: {error}"),
                    )
                },
            )? {
                break;
            }
            if std::time::Instant::now() >= scadenza_anteprima {
                return Err(super::errore(
                    false,
                    "WhatsApp non ha esposto l’anteprima del documento di collaudo.",
                ));
            }
            std::thread::sleep(super::PASSO_ATTESA);
        }
        eprintln!("collaudo-allegato: anteprima lasciata aperta");
        drop(ripristino_appunti);
        Ok(())
    }

    #[test]
    #[ignore = "prepara, interrompe e sostituisce un allegato WhatsApp reale"]
    fn collaudo_reale_ripristino_e_invio_allegato_da_env() {
        let numero = std::env::var("PHARMATEK_WHATSAPP_ATTACHMENT_TEST")
            .expect("PHARMATEK_WHATSAPP_ATTACHMENT_TEST mancante");
        let path = std::path::PathBuf::from(
            std::env::var("PHARMATEK_WHATSAPP_ATTACHMENT_PATH")
                .expect("PHARMATEK_WHATSAPP_ATTACHMENT_PATH mancante"),
        );
        assert!(path.is_file(), "documento di collaudo non trovato");
        let messaggio = std::env::var("PHARMATEK_WHATSAPP_ATTACHMENT_MESSAGE")
            .unwrap_or_else(|_| "Collaudo tecnico allegati PharmaTek".into());
        let destinatario = std::env::var("PHARMATEK_WHATSAPP_ATTACHMENT_NAME").unwrap_or_default();
        let cifre = numero
            .chars()
            .filter(char::is_ascii_digit)
            .collect::<String>();
        let recapito = if cifre.starts_with("39") {
            format!("+{cifre}")
        } else {
            format!("+39{cifre}")
        };
        let url = format!("whatsapp://send?phone={}", &recapito[1..]);

        eprintln!("collaudo-allegato: apertura chat iniziale");
        crate::platform::apri_url_sistema(&url).expect("WhatsApp non si è aperto");
        prepara_anteprima_allegato_senza_inviare(&path)
            .unwrap_or_else(|error| panic!("{}", error.messaggio));

        // Il secondo deep-link incontra volutamente l'azione precedente ancora
        // aperta. `aziona_invio` deve interromperla prima di scrivere il testo.
        eprintln!("collaudo-allegato: riapertura chat con anteprima pendente");
        crate::platform::apri_url_sistema(&url).expect("WhatsApp non si è riaperto");
        attendi_pc_libero_per_collaudo();
        eprintln!("collaudo-allegato: invio testo dopo ripristino");
        let destinazione = super::aziona_invio(
            &recapito,
            &destinatario,
            &messaggio,
            &messaggio,
            None,
            || false,
        )
        .unwrap_or_else(|error| panic!("{}", error.messaggio));
        eprintln!("collaudo-allegato: testo inviato");
        attendi_pc_libero_per_collaudo();
        eprintln!("collaudo-allegato: invio allegato finale");
        super::aziona_invio_allegato(
            &path,
            &destinazione,
            None,
            super::marcatore_input_utente(),
            || false,
        )
        .unwrap_or_else(|error| panic!("{}", error.messaggio));
        eprintln!("collaudo-allegato: allegato inviato");
        super::minimizza_finestre();
    }

    #[test]
    #[ignore = "invia un allegato WhatsApp reale con didascalia e un eventuale PDF extra"]
    fn collaudo_reale_allegato_con_didascalia_da_env() {
        let numero = std::env::var("PHARMATEK_WHATSAPP_ATTACHMENT_TEST")
            .expect("PHARMATEK_WHATSAPP_ATTACHMENT_TEST mancante");
        let path = std::path::PathBuf::from(
            std::env::var("PHARMATEK_WHATSAPP_ATTACHMENT_PATH")
                .expect("PHARMATEK_WHATSAPP_ATTACHMENT_PATH mancante"),
        );
        assert!(path.is_file(), "documento di collaudo non trovato");
        let extra = std::env::var("PHARMATEK_WHATSAPP_ATTACHMENT_EXTRA_PATH")
            .ok()
            .filter(|path| !path.trim().is_empty())
            .map(std::path::PathBuf::from);
        if let Some(extra) = &extra {
            assert!(extra.is_file(), "documento extra di collaudo non trovato");
        }
        let didascalia = std::env::var("PHARMATEK_WHATSAPP_ATTACHMENT_MESSAGE")
            .unwrap_or_else(|_| "Collaudo didascalia allegato PharmaTek".into());
        let destinatario = std::env::var("PHARMATEK_WHATSAPP_ATTACHMENT_NAME").unwrap_or_default();
        let cifre = numero
            .chars()
            .filter(char::is_ascii_digit)
            .collect::<String>();
        let recapito = if cifre.starts_with("39") {
            format!("+{cifre}")
        } else {
            format!("+39{cifre}")
        };
        let url = crate::app::communication::url_whatsapp_con_testo(&recapito, &didascalia);

        crate::platform::apri_url_sistema(&url).expect("WhatsApp non si è aperto");
        let mut tentativi_quiete = 0_u8;
        let destinazione = loop {
            attendi_pc_libero_per_collaudo();
            match super::prepara_invio_allegato_con_didascalia(
                &recapito,
                &destinatario,
                &didascalia,
                &didascalia,
                super::marcatore_input_utente(),
                || false,
            ) {
                Ok(destinazione) => break destinazione,
                Err(error) if error.attivita_utente && tentativi_quiete < 10 => {
                    tentativi_quiete += 1;
                }
                Err(error) => panic!("preparazione didascalia: {}", error.messaggio),
            }
        };
        super::aziona_invio_allegato(
            &path,
            &destinazione,
            Some(&didascalia),
            super::marcatore_input_utente(),
            || false,
        )
        .unwrap_or_else(|error| panic!("invio con didascalia: {}", error.messaggio));
        if let Some(extra) = extra {
            let cifre_recapito = recapito
                .chars()
                .filter(char::is_ascii_digit)
                .collect::<String>();
            crate::platform::apri_url_sistema(&format!("whatsapp://send?phone={cifre_recapito}"))
                .expect("WhatsApp non ha riaperto la chat per l'allegato extra");
            std::thread::sleep(std::time::Duration::from_millis(250));
            super::aziona_invio_allegato(
                &extra,
                &destinazione,
                None,
                super::marcatore_input_utente(),
                || false,
            )
            .unwrap_or_else(|error| panic!("invio allegato extra: {}", error.messaggio));
        }
        super::minimizza_finestre();
    }

    #[test]
    #[ignore = "ispeziona il compositore WhatsApp aperto senza digitare o inviare"]
    fn collaudo_sola_lettura_del_compositore_vuoto_da_env() {
        let numero = std::env::var("PHARMATEK_WHATSAPP_INSPECT_NUCORRIERE_CR").unwrap_or_default();
        let destinatario = std::env::var("PHARMATEK_WHATSAPP_INSPECT_NAME")
            .expect("PHARMATEK_WHATSAPP_INSPECT_NAME mancante");
        let _com = ComApartment::init().unwrap();
        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.unwrap();
        let controlli =
            super::trova_controlli_preparabili(&automation, &numero, &destinatario, "", &|| Ok(()))
                .unwrap()
                .expect("chat o compositore vuoto non trovati");
        assert!(super::elemento_visibile(&controlli.compositore));
        assert!(super::nome_indica_compositore_messaggio(&super::nome(
            &controlli.compositore
        )));
    }

    #[test]
    #[ignore = "ispeziona il compositore WhatsApp aperto senza digitare o inviare"]
    fn collaudo_sola_lettura_del_testo_visibile_da_env() {
        let numero = std::env::var("PHARMATEK_WHATSAPP_INSPECT_NUCORRIERE_CR")
            .expect("PHARMATEK_WHATSAPP_INSPECT_NUCORRIERE_CR mancante");
        let destinatario = std::env::var("PHARMATEK_WHATSAPP_INSPECT_NAME")
            .expect("PHARMATEK_WHATSAPP_INSPECT_NAME mancante");
        let corpo = std::env::var("PHARMATEK_WHATSAPP_INSPECT_MESSAGE")
            .expect("PHARMATEK_WHATSAPP_INSPECT_MESSAGE mancante");
        let _com = ComApartment::init().unwrap();
        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.unwrap();
        let controlli = super::trova_controlli_preparabili(
            &automation,
            &numero,
            &destinatario,
            &corpo,
            &|| Ok(()),
        )
        .unwrap()
        .expect("chat o compositore non trovati");
        assert!(
            compositore_contiene_testo(&automation, &controlli.compositore, &corpo),
            "il testo visibile non è stato letto da alcun pattern UIA"
        );
    }

    #[test]
    #[ignore = "apre e rimuove una bozza WhatsApp reale senza premere Invio"]
    fn collaudo_bozza_deeplink_senza_invio_da_env() {
        let numero = std::env::var("PHARMATEK_WHATSAPP_INSPECT_NUCORRIERE_CR")
            .expect("PHARMATEK_WHATSAPP_INSPECT_NUCORRIERE_CR mancante");
        let destinatario = std::env::var("PHARMATEK_WHATSAPP_INSPECT_NAME")
            .expect("PHARMATEK_WHATSAPP_INSPECT_NAME mancante");
        let corpo = std::env::var("PHARMATEK_WHATSAPP_INSPECT_MESSAGE")
            .unwrap_or_else(|_| "Collaudo tecnico PharmaTek — non inviare".into());
        let url = crate::app::communication::url_whatsapp_con_testo(&numero, &corpo);
        crate::platform::apri_url_sistema(&url).expect("WhatsApp non si è aperto");
        std::thread::sleep(std::time::Duration::from_secs(2));

        let _com = ComApartment::init().unwrap();
        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.unwrap();
        let controlli = super::trova_controlli_preparabili(
            &automation,
            &numero,
            &destinatario,
            &corpo,
            &|| Ok(()),
        )
        .unwrap()
        .expect("chat o compositore non trovati");
        let preparazione =
            super::normalizza_compositore(&automation, &controlli, &corpo, &|| false);
        let testo_presente =
            compositore_contiene_testo(&automation, &controlli.compositore, &corpo);

        let pattern: super::IUIAutomationValuePattern = unsafe {
            controlli
                .compositore
                .GetCurrentPatternAs(super::UIA_ValuePatternId)
        }
        .expect("ValuePattern del compositore non disponibile");
        unsafe { pattern.SetValue(&windows::core::BSTR::new()) }
            .expect("pulizia della bozza tecnica non riuscita");
        assert!(
            testo_presente,
            "né il deep-link né il paste hanno preparato il testo esatto"
        );
        preparazione.expect("testo o focus non verificati prima dell'invio");
    }

    #[test]
    #[ignore = "stampa i controlli WhatsApp aperti senza digitare o inviare"]
    fn diagnostica_controlli_aperti() {
        let _com = ComApartment::init().unwrap();
        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.unwrap();
        for finestra in super::finestre_whatsapp(&automation).unwrap() {
            for tipo_controllo in [
                super::UIA_EditControlTypeId.0,
                super::UIA_ButtonControlTypeId.0,
                super::UIA_TextControlTypeId.0,
            ] {
                for elemento in
                    super::elementi_per_controllo(&automation, &finestra, tipo_controllo).unwrap()
                {
                    let tipo = unsafe { elemento.CurrentControlType() }
                        .map(|tipo| tipo.0)
                        .unwrap_or_default();
                    let nome = super::nome(&elemento);
                    let rettangolo = unsafe { elemento.CurrentBoundingRectangle() }.ok();
                    let visibile = unsafe { elemento.CurrentIsOffscreen() }
                        .map(|value| !value.as_bool())
                        .unwrap_or(false);
                    let abilitato = unsafe { elemento.CurrentIsEnabled() }
                        .map(|value| value.as_bool())
                        .unwrap_or(false);
                    if visibile
                        && (tipo_controllo != super::UIA_TextControlTypeId.0 || !nome.is_empty())
                    {
                        eprintln!(
                            "tipo={tipo} nome={nome:?} abilitato={abilitato} rettangolo={rettangolo:?}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn annullamento_ferma_l_automazione_prima_di_aprire_com() {
        let errore = aziona_invio(
            "+393281883355",
            "Luca Tartaglia",
            "Messaggio da non inviare",
            "·pt-test",
            None,
            || true,
        )
        .unwrap_err();
        assert_eq!(errore.messaggio, "Invio WhatsApp annullato.");
        assert!(!errore.esito_ambiguo);
        assert!(!errore.attivita_utente);
    }

    #[test]
    fn confronta_numero_o_nome_senza_affidarsi_alle_coordinate() {
        assert!(intestazione_corrisponde(
            "+39 328 188 3355 Inviati un messaggio",
            "+393281883355",
            "Altro nome"
        ));
        assert!(intestazione_corrisponde(
            "Luca Tartaglia (tu) Inviati un messaggio",
            "+393281883355",
            "Dott. Luca Tartaglia"
        ));
        assert!(!intestazione_corrisponde(
            "Mario Bianchi online",
            "+393281883355",
            "Luca Tartaglia"
        ));
    }

    #[test]
    fn allegato_richiede_la_stessa_conversazione_del_testo() {
        let attesa = super::normalizza_identita("Digita un messaggio per @Luke3012");
        assert!(super::destinazione_allegato_invariata(
            &attesa,
            "Digita un messaggio per @Luke3012"
        ));
        assert!(!super::destinazione_allegato_invariata(
            &attesa,
            "Digita un messaggio per Nonna Carmela"
        ));
        assert!(!super::destinazione_allegato_invariata("", ""));
    }

    #[test]
    fn il_confronto_del_testo_tollera_solo_spaziatura_e_fine_riga() {
        assert_eq!(
            normalizza_testo("Prima riga\r\nSeconda   riga"),
            normalizza_testo("Prima riga\nSeconda riga")
        );
        assert_ne!(
            normalizza_testo("Messaggio A"),
            normalizza_testo("Messaggio B")
        );
    }

    #[test]
    fn il_confronto_riconosce_gli_elenchi_convertiti_da_whatsapp() {
        let atteso = "Pagamento scaduto:\n- Saldo scaduto il 04/08/2026: € 175,00";
        let elenco_whatsapp = "Pagamento scaduto:\r\n• Saldo scaduto il 04/08/2026: € 175,00";
        let elenco_uia_alternativo = "Pagamento scaduto:\n· Saldo scaduto il 04/08/2026: € 175,00";
        assert_eq!(normalizza_testo(atteso), normalizza_testo(elenco_whatsapp));
        assert_eq!(
            normalizza_testo(atteso),
            normalizza_testo(elenco_uia_alternativo)
        );
        assert_ne!(
            normalizza_testo("Ordine 1 · Rata"),
            normalizza_testo("Ordine 1 - Rata"),
            "la tolleranza deve valere soltanto per i marcatori a inizio riga"
        );
    }

    #[test]
    fn prepara_i_punti_elenco_senza_attivare_la_formattazione_di_whatsapp() {
        let testo = "Pagamento scaduto:\r\n- Acconto: € 100,00\r\n\r\nAltri pagamenti:\r\n- Saldo: € 175,00";
        assert_eq!(
            super::testo_senza_elenchi_automatici(testo),
            "Pagamento scaduto:\n• Acconto: € 100,00\n\nAltri pagamenti:\n• Saldo: € 175,00"
        );
    }

    #[test]
    fn riconosce_le_etichette_del_pulsante_invia() {
        assert!(nome_pulsante_invia("Invia"));
        assert!(nome_pulsante_invia("Invia messaggio"));
        assert!(nome_pulsante_invia("Send message"));
        assert!(super::NOMI_INVIA_ALLEGATO.contains(&"Invia 1 selezionato"));
        assert!(!nome_pulsante_invia("Invia file"));
        assert!(!nome_pulsante_invia("Invia 1 selezionato"));
    }

    #[test]
    fn riconosce_il_pulsante_vocale_del_compositore_vuoto() {
        assert!(nome_pulsante_vocale("Registra un messaggio vocale"));
        assert!(nome_pulsante_vocale("Voice message"));
        assert!(!nome_pulsante_vocale("Videochiamata"));
    }

    #[test]
    fn riconosce_anteprima_allegato_e_conferma_di_interruzione() {
        assert!(testo_indica_modalita_allegato(
            "Aggiungi una didascalia (facoltativo)"
        ));
        assert!(testo_indica_modalita_allegato("Add a caption"));
        assert!(testo_indica_modalita_allegato("Rimuovi allegato"));
        assert!(!testo_indica_modalita_allegato("Scrivi un messaggio"));

        assert!(testo_chiede_interruzione(
            "Vuoi interrompere l'azione in corso?"
        ));
        assert!(testo_chiede_interruzione("Vuoi eliminare la selezione?"));
        assert!(testo_chiede_interruzione("Discard the current action?"));
        assert!(nome_pulsante_conferma_interruzione("Interrompi"));
        assert!(nome_pulsante_conferma_interruzione("Elimina"));
        assert!(nome_pulsante_conferma_interruzione("Sì, interrompi"));
        assert!(nome_pulsante_conferma_interruzione("Discard"));
        assert!(!nome_pulsante_conferma_interruzione("Continua"));
        assert!(!nome_pulsante_conferma_interruzione("Cancel"));
        assert!(nome_pulsante_chiudi_allegato("Chiudi"));
        assert!(nome_pulsante_chiudi_allegato("Close attachment preview"));
        assert!(!nome_pulsante_chiudi_allegato("Close"));
    }

    #[test]
    fn riconosce_il_numero_non_associato_a_whatsapp_come_errore_definitivo() {
        assert!(testo_indica_numero_non_whatsapp(
            "Il numero +39 330 284 7548 non è su WhatsApp.",
        ));
        assert!(testo_indica_numero_non_whatsapp(
            "This phone number is not on WhatsApp",
        ));
        assert!(testo_indica_numero_non_whatsapp(
            "This phone number isn't on WhatsApp",
        ));
        assert!(!testo_indica_numero_non_whatsapp(
            "Invia un messaggio su WhatsApp",
        ));
    }
}
