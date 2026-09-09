from __future__ import annotations

import argparse
import io
import os
import re
from pathlib import Path

from PIL import Image as PILImage, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Flowable, Frame, Image, KeepTogether, NextPageTemplate,
    PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

from manual_manifest import (
    ADMIN_APPENDIX, CHAPTERS, CONCLUSIONS, FUTURE_FEATURES, GLOSSARY,
    INTRO, SUBTITLE, TITLE, VERSION,
)
from figure_guides import GUIDES, PROCESS_META

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SCREENSHOTS = Path(r"C:\Users\lucat\Pictures\Screenshots\PharmaTek")
OUTPUT = ROOT / "output" / "pdf"
TMP = ROOT / "tmp" / "pdfs"

YELLOW = colors.HexColor("#F4C20D")
YELLOW_DARK = colors.HexColor("#D99A00")
INK = colors.HexColor("#172231")
MUTED = colors.HexColor("#6F7B89")
PALE = colors.HexColor("#F2F5F8")
LINE = colors.HexColor("#DCE2E8")
WHITE = colors.white
GREEN = colors.HexColor("#22B573")
RED = colors.HexColor("#F45B69")


def natural_key(name: str):
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+(?:\.\d+)?)", name)]


def register_fonts():
    fonts = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
    regular = fonts / "segoeui.ttf"
    bold = fonts / "segoeuib.ttf"
    if regular.exists() and bold.exists():
        pdfmetrics.registerFont(TTFont("PTSans", str(regular)))
        pdfmetrics.registerFont(TTFont("PTSans-Bold", str(bold)))
        return "PTSans", "PTSans-Bold"
    return "Helvetica", "Helvetica-Bold"


FONT, FONT_BOLD = register_fonts()


def styles():
    base = getSampleStyleSheet()
    return {
        "cover_brand": ParagraphStyle("cover_brand", fontName=FONT_BOLD, fontSize=17, leading=20, textColor=WHITE),
        "cover_title": ParagraphStyle("cover_title", fontName=FONT_BOLD, fontSize=34, leading=38, textColor=WHITE),
        "cover_sub": ParagraphStyle("cover_sub", fontName=FONT, fontSize=15, leading=22, textColor=colors.HexColor("#D7DEE7")),
        "chapter_no": ParagraphStyle("chapter_no", fontName=FONT_BOLD, fontSize=15, leading=18, textColor=YELLOW),
        "chapter_title": ParagraphStyle("chapter_title", fontName=FONT_BOLD, fontSize=31, leading=36, textColor=WHITE),
        "chapter_lead": ParagraphStyle("chapter_lead", fontName=FONT, fontSize=14, leading=21, textColor=colors.HexColor("#DCE3EB")),
        "h1": ParagraphStyle("h1", fontName=FONT_BOLD, fontSize=23, leading=28, textColor=INK, spaceAfter=8),
        "h2": ParagraphStyle("h2", fontName=FONT_BOLD, fontSize=15, leading=19, textColor=INK, spaceBefore=6, spaceAfter=5),
        "body": ParagraphStyle("body", fontName=FONT, fontSize=10.2, leading=15, textColor=INK, spaceAfter=6),
        "small": ParagraphStyle("small", fontName=FONT, fontSize=8.5, leading=12, textColor=MUTED),
        "caption": ParagraphStyle("caption", fontName=FONT, fontSize=8.7, leading=12.5, textColor=MUTED, spaceBefore=4),
        "toc_h": ParagraphStyle("toc_h", fontName=FONT_BOLD, fontSize=23, leading=28, textColor=INK, spaceAfter=10),
        "toc1": ParagraphStyle("toc1", fontName=FONT_BOLD, fontSize=10.2, leading=13.5, textColor=INK, leftIndent=0, firstLineIndent=0, spaceBefore=2),
        "toc2": ParagraphStyle("toc2", fontName=FONT, fontSize=8.7, leading=11.5, textColor=MUTED, leftIndent=10, firstLineIndent=0),
        "callout": ParagraphStyle("callout", fontName=FONT, fontSize=9.6, leading=14, textColor=INK),
        "step": ParagraphStyle("step", fontName=FONT, fontSize=9.8, leading=14, textColor=INK),
        "figure_title": ParagraphStyle("figure_title", fontName=FONT_BOLD, fontSize=13, leading=17, textColor=INK, spaceAfter=4),
        "guide": ParagraphStyle("guide", fontName=FONT, fontSize=9.7, leading=13.8, textColor=INK),
        "guide_small": ParagraphStyle("guide_small", fontName=FONT, fontSize=9.5, leading=13.2, textColor=INK),
        "eyebrow": ParagraphStyle("eyebrow", fontName=FONT_BOLD, fontSize=7.6, leading=9, textColor=YELLOW_DARK, spaceAfter=3),
        "process_left": ParagraphStyle("process_left", fontName=FONT_BOLD, fontSize=7.8, leading=10, textColor=YELLOW_DARK, alignment=TA_LEFT),
        "process_right": ParagraphStyle("process_right", fontName=FONT, fontSize=8.2, leading=10, textColor=MUTED, alignment=2),
        "future_page_h1": ParagraphStyle("h1", fontName=FONT_BOLD, fontSize=25, leading=29, textColor=WHITE, spaceAfter=8),
        "future_title": ParagraphStyle("future_title", fontName=FONT_BOLD, fontSize=13.5, leading=16, textColor=WHITE),
        "future_body": ParagraphStyle("future_body", fontName=FONT, fontSize=8.7, leading=12.2, textColor=colors.HexColor("#DCE3EB")),
        "future_items": ParagraphStyle("future_items", fontName=FONT, fontSize=8.6, leading=11.6, textColor=colors.HexColor("#AEB9C6")),
        "future_hero": ParagraphStyle("future_hero", fontName=FONT_BOLD, fontSize=17, leading=21, textColor=INK),
        "future_hero_body": ParagraphStyle("future_hero_body", fontName=FONT, fontSize=8.8, leading=12.4, textColor=INK),
        "future_available": ParagraphStyle("future_available", fontName=FONT, fontSize=9, leading=13, textColor=WHITE),
        "chapter_intro_body": ParagraphStyle("chapter_intro_body", fontName=FONT, fontSize=10.8, leading=16, textColor=INK, spaceAfter=6),
        "chapter_step": ParagraphStyle("chapter_step", fontName=FONT, fontSize=9.1, leading=13, textColor=INK),
    }


S = styles()


def sidebar_app_icon(cache: Path) -> Path:
    """Riproduce il LogoMark realmente usato nella sidebar dell'app."""
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / "sidebar-app-icon.png"
    if target.exists():
        return target

    size = 360
    radius = round(size * 0.28)
    mask = PILImage.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)

    gradient = PILImage.new("RGBA", (size, size))
    pixels = gradient.load()
    start, end = (244, 194, 13), (224, 144, 12)
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            pixels[x, y] = tuple(round(start[i] * (1 - t) + end[i] * t) for i in range(3)) + (255,)
    gradient.putalpha(mask)

    draw = ImageDraw.Draw(gradient)
    font_path = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "segoeuib.ttf"
    font = ImageFont.truetype(str(font_path), round(size * 0.56)) if font_path.exists() else ImageFont.load_default()
    bbox = draw.textbbox((0, 0), "P", font=font)
    draw.text(((size - (bbox[2] - bbox[0])) / 2 - bbox[0], (size - (bbox[3] - bbox[1])) / 2 - bbox[1]),
              "P", font=font, fill=(26, 26, 26, 255))
    gradient.save(target, optimize=True)
    return target

CHAPTER_GUIDANCE = {
    "dashboard": {
        "intro": "La Dashboard riepiloga ordini, somme da incassare, prodotti in produzione e promemoria. Da qui puoi aprire direttamente l'elenco che richiede attenzione.",
        "steps": ["Scegli l'anno che vuoi consultare.", "Guarda le schede e i promemoria che richiedono attenzione.", "Premi una scheda per aprire direttamente i dati collegati."],
        "tip": "Le schede mostrano dei totali. Se devi correggere un ordine o un pagamento, apri la relativa sezione e modifica il dato originale.",
    },
    "giornaliero": {
        "intro": "Nel Giornaliero puoi cercare un ordine esistente o crearne uno nuovo. Ogni ordine contiene cliente, medico, prodotti, importi, pagamenti e stato.",
        "steps": ["Cerca l'ordine oppure premi Nuovo ordine.", "Scegli cliente, medico e prodotti: il gestionale propone i prezzi.", "Controlla totale, acconto e saldo, quindi premi Salva."],
        "tip": "Controlla che prodotti, quantità e prezzi descrivano davvero l'ordine. Il Gestionale PharmaTek usa il proprio prezzario e le regole configurate per calcolare automaticamente totale, acconto e saldo dovuto.",
    },
    "produzione": {
        "intro": "In Produzione selezioni gli ordini pronti per il laboratorio e crei i lotti. Prima della conferma apri le righe, completa i dati mancanti e controlla i prodotti inclusi.",
        "steps": ["Filtra l'elenco e seleziona soltanto le righe pronte.", "Completa i dati richiesti e crea il lotto.", "In In lavorazione genera il file oppure unisci più lotti quando serve un export unico."],
        "tip": "Unisci lotti è reversibile: dal menu del gruppo risultante puoi scegliere Separa lotto. I gruppi originali tornano al loro posto e i prodotti non vengono duplicati.",
    },
    "spedizioni": {
        "intro": "Spedizioni raccoglie i prodotti pronti a partire. Selezioni ciò che vuoi inviare, controlli a chi deve arrivare e prepari uno o più colli con corriere, recapiti ed eventuale pagamento alla consegna.",
        "steps": ["Seleziona i prodotti nella scheda Da spedire.", "Controlla destinatario, indirizzo e raggruppamenti.", "Crea i colli; in Effettuate controlla incassi, distinte e gruppi già creati."],
        "tip": "Prima di creare i colli puoi unire i destinatari. Dopo la creazione puoi invece unire gruppi già effettuati: le distinte restano separate per corriere e il riepilogo economico per conto e agente.",
    },
    "contabilita": {
        "intro": "In Contabilità controlli ciò che deve ancora essere incassato e registri il denaro realmente ricevuto. Nella stessa area puoi gestire distinte del corriere, provvigioni degli agenti e rimborsi ai clienti.",
        "steps": ["Cerca il cliente, l'ordine o il movimento interessato.", "Inserisci importo, data, stato e conto corretto.", "Conferma e controlla che residuo e riepiloghi siano aggiornati."],
        "tip": "Atteso significa che il denaro deve ancora arrivare; Incassato significa che lo hai già ricevuto. I pagamenti scaduti possono già essere individuati e sollecitati dal gestionale.",
    },
    "anagrafiche": {
        "intro": "Nelle Anagrafiche salvi clienti, medici, agenti, prodotti, conti e corrieri. Questi dati vengono poi proposti negli ordini, nelle spedizioni e nei pagamenti.",
        "steps": ["Apri la categoria giusta e cerca il nome già presente.", "Crea o modifica la scheda con i dati necessari.", "Salva: le nuove informazioni saranno disponibili nelle altre sezioni."],
        "tip": "Cerca sempre prima di creare una nuova scheda, così eviti doppioni. Controlla con particolare attenzione indirizzi, codice fiscale, IBAN e condizioni economiche.",
    },
    "impostazioni": {
        "intro": "Nelle Impostazioni puoi scegliere come ricevere le notifiche, adattare l'aspetto del programma e usare strumenti come importazione, esportazione e backup. Nello stesso capitolo trovi anche Spotlight, la ricerca rapida del gestionale.",
        "steps": ["Apri il riquadro relativo alla funzione che vuoi cambiare.", "Modifica una scelta per volta e leggi la conferma mostrata.", "Controlla il risultato prima di passare alla modifica successiva."],
        "tip": "Backup, ripristino, importazione e pulizia possono coinvolgere dati condivisi. Avvisa il team e non interrompere l'operazione mentre è in corso.",
    },
    "conclusioni": {
        "intro": "L'ultimo capitolo riunisce il percorso completo, dall'inserimento dell'ordine fino all'incasso. Puoi usarlo come controllo rapido quando vuoi capire se manca ancora un passaggio.",
        "steps": ["Ripercorri ordine, produzione, spedizione e pagamento.", "Usa i controlli quotidiani prima di iniziare e prima di terminare.", "Se qualcosa non torna, parti dal dato originale invece di correggere soltanto il riepilogo."],
        "tip": "Non serve rileggere ogni volta tutto il manuale: usa queste pagine come promemoria e segui il rimando al capitolo interessato quando devi intervenire.",
    },
    "amministrazione": {
        "intro": "Questa appendice raccoglie gli interventi riservati sulle postazioni e sui dati condivisi. Riconfigurare un PC, ritirarlo e azzerare tutto sono operazioni molto diverse.",
        "steps": ["Apri il Centro di ripristino con la sequenza protetta.", "Scegli l'intervento in base al PC e ai dati che vuoi conservare.", "Leggi le conferme e verifica il backup prima di proseguire."],
        "tip": "Per risolvere un problema su un solo computer non usare Reset completo: quel comando riguarda i dati condivisi e tutte le postazioni.",
    },
}

# Solo queste immagini rappresentano vere pagine principali e meritano il
# trattamento panoramico. Modali, filtri, conferme e schede di modifica restano
# volutamente compatti e vengono affiancati alla spiegazione.
FULL_SCREENSHOTS = {
    "dashboard-1.png", "giornaliero-1.png",
    "produzione-1.png", "produzione-8.png", "spedizioni-1.png",
    "spedizioni-7.png", "spedizioni-12.png", "crediti-1.png", "provvigioni-1.png",
    "rimborsi-1.png", "anagrafiche-1.png", "impostazioni-1.png",
    "impostazioni-4.png",
    "spotlight-1.png", "spotlight-2.png", "spotlight-3.png",
    "info-2.png", "info-3.png",
    "amministrazione-1-centro-ripristino.png", "amministrazione-2-riconfigura.png",
    "amministrazione-3-ritira-pc.png", "amministrazione-4-reset-completo.png",
    "amministrazione-5-ultima-conferma.png",
}

MERGED_GROUPS = {
    "giornaliero-6.png": {
        "files": ["giornaliero-6.png", "giornaliero-7.png"],
        "title": "Prodotti, totale e acconto",
        "goal": "Inserire correttamente i prodotti e verificare quanto deve pagare il cliente.",
        "access": "Nel Nuovo ordine, dopo aver scelto cliente e medico, scorri fino alla tabella Prodotti e al riepilogo economico sottostante.",
        "fields": ["Prodotto", "Quantità", "Prezzo", "Paziente", "Aggiungi prodotto", "Totale ordine", "Acconto concordato", "Incassato", "Residuo"],
        "use": "Scegli i prodotti dal catalogo e controlla quantità, prezzo e paziente. Il prezzo viene proposto dal prezzario e dalle regole collegate al medico; ogni modifica aggiorna automaticamente totale, acconto e saldo. Prima di salvare, verifica che questi valori corrispondano all'ordine concordato.",
        "steps": [
            "Scegli il prodotto nella prima riga e indica quantità e paziente.",
            "Leggi il prezzo proposto; cambialo solo se il prezzo concordato è diverso.",
            "Usa Aggiungi prodotto per inserire le altre righe dell'ordine.",
            "Confronta totale, acconto concordato, somma incassata e residuo, quindi salva.",
        ],
        "caption_left": "Ordine con riepilogo economico",
        "caption_right": "Dettaglio delle righe prodotto",
        "process": ("Creare un ordine", "3 · Prodotti e riepilogo"),
    },
    "giornaliero-10.png": {
        "files": ["giornaliero-10.png", "giornaliero-11.png"],
        "title": "Rateizzare il saldo: prima e dopo",
        "goal": "Dividere il saldo in rate e controllare le scadenze create.",
        "access": "Dallo Scadenzario premi Rateizza saldo, scegli numero e cadenza e conferma. Tornando all'ordine vedrai le nuove rate al posto del saldo unico.",
        "fields": ["Importo da rateizzare", "Numero rate", "Cadenza", "Prima scadenza", "Importi delle rate", "Somma rate", "Righe create nello Scadenzario", "Conto e stato Atteso"],
        "use": "Scegli il numero di rate e la cadenza, poi controlla importi e scadenze. Dopo Rateizza, il saldo unico viene sostituito dalle singole rate nello Scadenzario. Il piano diventa effettivo quando salvi l'ordine.",
        "steps": [
            "Nello Scadenzario premi Rateizza saldo.",
            "Scegli numero di rate, cadenza e data della prima scadenza.",
            "Controlla gli importi proposti e verifica che Somma rate coincida con il saldo.",
            "Premi Rateizza, rileggi le nuove righe nello Scadenzario e salva l'ordine.",
        ],
        "caption_left": "Creazione del piano rateale",
        "caption_right": "Rate inserite nello Scadenzario",
        "process": ("Preparare i pagamenti", "3 · Crea e controlla le rate"),
    },
    "produzione-3.png": {
        "files": ["produzione-3.png", "produzione-4.png"],
        "title": "Selezionare e completare le righe",
        "goal": "Preparare soltanto gli ordini che contengono tutti i dati richiesti dal laboratorio.",
        "access": "Nella scheda Da produrre spunta l'ordine e apri la freccia della riga prima di premere Manda in produzione.",
        "fields": ["Casella di selezione", "Ordine e cliente", "Prodotti inclusi", "Formulazione", "Posologia", "Allergeni", "Codici o materiali", "Manda in produzione"],
        "use": "Spunta la riga, aprila con la freccia e controlla ogni prodotto. Completa formulazione, posologia e gli eventuali dati mancanti; solo dopo premi Manda in produzione. In questo modo il lotto nasce già con le informazioni necessarie.",
        "steps": [
            "In Da produrre spunta gli ordini che vuoi inserire nello stesso lotto.",
            "Apri ogni riga con la freccia e controlla i prodotti inclusi.",
            "Completa formulazione, posologia, allergeni e gli altri dati richiesti.",
            "Quando tutte le righe sono pronte, premi Manda in produzione.",
        ],
        "caption_left": "Ordine selezionato",
        "caption_right": "Dati visibili dopo l'espansione",
        "process": ("Preparare un lotto", "1-2 · Seleziona e completa"),
    },
    "anagrafiche-5.png": {
        "files": ["anagrafiche-5.png", "anagrafiche-6.png"],
        "title": "Catalogo prodotti e Prova prezzo",
        "goal": "Controllare il prezzo proposto prima di usarlo in un ordine.",
        "access": "Apri Anagrafiche, scegli Prodotti e usa il riquadro Prova prezzo nella parte alta della pagina.",
        "fields": ["Ricerca prodotti", "Nuovo prodotto", "Prodotto da provare", "Medico opzionale", "Calcola", "Prezzo risultante", "Regola applicata", "Catalogo con categoria e prezzo base"],
        "use": "Per verificare un prezzo, scegli il prodotto e, se serve, il medico; quindi premi Calcola. PharmaTek mostra il valore proposto e la regola applicata. Questa prova non modifica il catalogo: per cambiare prezzo o regole devi aprire il prodotto con il menu della riga.",
        "steps": [
            "Apri Anagrafiche, scegli Prodotti e raggiungi Prova prezzo.",
            "Seleziona il prodotto e, se il prezzo dipende dal medico, seleziona anche il medico.",
            "Premi Calcola e leggi sia il prezzo sia la regola applicata.",
            "Se il valore va cambiato stabilmente, apri il prodotto dal menu della riga e modifica il prezzario.",
        ],
        "caption_left": "Catalogo dei prodotti",
        "caption_right": "Riquadro Prova prezzo",
        "process": ("Gestire i prodotti", "Catalogo e verifica del prezzo"),
        "crop_second": (0.0, 0.0, 1.0, 0.42),
    },
    "dashboard-3.png": {
        "files": ["dashboard-3.png", "dashboard-2.png"],
        "title": "Dalla bacheca al nuovo promemoria",
        "goal": "Leggere le attività condivise e aggiungere un promemoria senza perdere il contesto.",
        "access": "Dalla Dashboard controlla la Bacheca del team; se manca un'attività, premi Nuovo promemoria.",
        "fields": ["Attività aperte", "Scadenza e priorità", "Testo e destinatari"],
        "use": "La bacheca mostra ciò che il team deve ancora fare. Il nuovo promemoria compare dopo il salvataggio con scadenza, priorità ed eventuale ricorrenza; completarlo non modifica l'ordine eventualmente collegato.",
        "steps": [
            "Nella Dashboard leggi prima le attività Da fare e le relative scadenze.",
            "Per aggiungerne una, premi Nuovo promemoria.",
            "Scrivi l'attività, scegli scadenza, priorità ed eventuali destinatari.",
            "Premi Crea promemoria e controlla che la nuova voce compaia in bacheca.",
        ],
        "caption_left": "Attività presenti in bacheca",
        "caption_right": "Creazione di un promemoria",
        "process": ("Usare la bacheca", "Leggi e aggiungi un'attività"),
    },
    "giornaliero-2.png": {
        "files": ["giornaliero-2.png", "giornaliero-3.png"],
        "title": "Scegliere e iniziare un nuovo ordine",
        "goal": "Aprire subito il modulo adatto al tipo di ordine da inserire.",
        "access": "Nel Giornaliero apri la freccia di Nuovo ordine e scegli il tipo necessario.",
        "fields": ["Tipo di ordine", "Cliente e medico", "Prodotti e prezzi"],
        "use": "La scelta iniziale prepara i campi corretti. Nel modulo successivo seleziona cliente e medico, inserisci i prodotti e controlla i prezzi proposti prima di proseguire.",
        "steps": [
            "Nel Giornaliero premi la freccia accanto a Nuovo ordine.",
            "Scegli Nuovo ordine per il flusso ordinario, Diagnostica o Keriba per il flusso dedicato.",
            "Nel modulo che si apre imposta data, cliente e medico.",
            "Aggiungi i prodotti e controlla i prezzi proposti prima di salvare.",
        ],
        "caption_left": "Scelta del tipo di ordine",
        "caption_right": "Modulo del nuovo ordine",
        "process": ("Creare un ordine", "1-2 · Scegli il tipo e inizia"),
    },
    "produzione-5.png": {
        "files": ["produzione-5.png", "produzione-6.png", "produzione-7.png"],
        "title": "Controllare, creare ed esportare il lotto",
        "goal": "Concludere il lotto dopo l'ultimo controllo e salvare il file da inviare al laboratorio.",
        "access": "Dopo aver selezionato le righe leggi l'avviso, conferma la creazione e premi Esporta.",
        "fields": ["Avviso sui dati", "Lotto creato", "Anteprima Laboratorio"],
        "use": "L'avviso permette di fermarsi se manca un dato utile. Dopo la conferma il lotto è registrato; controlla l'anteprima e salva l'Excel, che oggi viene inviato manualmente a Laboratorio.",
        "steps": [
            "Leggi l'avviso: se segnala dati mancanti, annulla e completa le righe interessate.",
            "Se i dati sono corretti, conferma Manda in produzione.",
            "Apri il lotto appena creato e controlla ordini, prodotti e numerazione.",
            "Premi Esporta, salva l'Excel e invialo manualmente a Laboratorio.",
        ],
        "caption_left": "Ultimo controllo prima della produzione",
        "caption_right": "Conferma del lotto creato",
        "caption_third": "Anteprima del file Laboratorio",
        "process": ("Preparare un lotto", "3-5 · Controlla, crea ed esporta"),
    },
    "spedizioni-3.png": {
        "files": ["spedizioni-3.png", "spedizioni-4.png"],
        "title": "Preparare il collo e il pagamento",
        "goal": "Definire in un solo controllo cosa parte, con quale corriere e quanto va riscosso.",
        "access": "Dopo aver selezionato le righe, premi Crea spedizione e apri ciascun destinatario.",
        "fields": ["Data e corriere", "Prodotti inclusi", "Pagamento alla consegna"],
        "use": "Imposta data e corriere, poi controlla prodotti, numero di colli e recapiti. Se il corriere deve riscuotere, scegli il mezzo e verifica l'importo prima di creare la spedizione.",
        "steps": [
            "Dopo aver selezionato le righe premi Crea spedizione.",
            "Scegli data, corriere e l'eventuale preavviso telefonico.",
            "Apri ogni destinatario e spunta soltanto i prodotti che partono adesso.",
            "Indica numero di colli e, se previsto, tipo e importo del pagamento alla consegna.",
            "Rileggi destinatario e indirizzo, quindi premi Crea spedizione.",
        ],
        "caption_left": "Dati generali della spedizione",
        "caption_right": "Prodotti e pagamento del destinatario",
        "process": ("Creare una spedizione", "2-3 · Collo e pagamento"),
    },
    "spedizioni-5.png": {
        "files": ["spedizioni-5.png", "spedizioni-6.png"],
        "title": "Spedizione conclusa ed esportazione",
        "goal": "Verificare il salvataggio e produrre il file del corriere quando serve.",
        "access": "Dopo Crea spedizione attendi la conferma Spedito e apri la distinta oppure l'esportazione.",
        "fields": ["Conferma Spedito", "Crea distinta", "Stampa o Salva Excel"],
        "use": "La conferma indica che i colli sono già in Effettuate. Controlla l'anteprima e salva o stampa il file; chiudere la finestra non annulla la spedizione.",
        "steps": [
            "Attendi la conferma Spedito: significa che il salvataggio è terminato.",
            "Se devi preparare il file del corriere, apri Esporta o Stampa.",
            "Controlla l'anteprima e completa gli eventuali dati richiesti.",
            "Scegli Salva Excel oppure Stampa; Chiudi lascia comunque la spedizione tra le Effettuate.",
        ],
        "caption_left": "Conferma Spedito",
        "caption_right": "Anteprima da esportare",
        "process": ("Dopo la creazione", "Conferma ed esporta"),
    },
    "spedizioni-11.png": {
        "files": ["spedizioni-11.png", "spedizioni-12.png"],
        "title": "Unire i gruppi e controllare il risultato",
        "goal": "Riunire spedizioni effettuate e verificare subito il gruppo ottenuto.",
        "access": "In Effettuate seleziona almeno due gruppi, premi Unisci e conferma.",
        "fields": ["Gruppi selezionati", "Indicazione Unito", "Comando Separa"],
        "use": "Il gruppo unito può contenere giorni e corrieri diversi. Le distinte restano separate per corriere e gli incassi per conto e agente; Separa ripristina i gruppi originali senza cambiare colli, ordini o pagamenti.",
        "steps": [
            "In Effettuate spunta almeno due gruppi che vuoi consultare insieme.",
            "Premi Unisci e conferma la selezione.",
            "Apri il gruppo con l'etichetta Unito e verifica i colli raccolti.",
            "Per tornare alla situazione precedente, premi Separa: colli e pagamenti non vengono modificati.",
        ],
        "caption_left": "Gruppi scelti prima dell'unione",
        "caption_right": "Gruppo unito con il comando Separa",
        "process": ("Operazioni collettive", "Unisci, controlla o separa"),
    },
    "provvigioni-2.png": {
        "files": ["provvigioni-2.png", "provvigioni-3.png"],
        "title": "Pagare e ritrovare una liquidazione",
        "goal": "Registrare soltanto le provvigioni realmente pagate e conservarne il dettaglio.",
        "access": "Dalla scheda dell'agente premi Paga provvigioni, seleziona le righe e conferma; in seguito apri Storico.",
        "fields": ["Righe selezionate", "Totale da pagare", "Data e dettaglio storico"],
        "use": "La conferma sposta le sole voci selezionate tra quelle pagate. Lo Storico permette di ricostruire la liquidazione e, se necessario, annullarla senza modificare ordini o incassi dei clienti.",
        "steps": [
            "Apri la scheda dell'agente e premi Paga provvigioni.",
            "Spunta soltanto le righe comprese nel pagamento che stai effettuando.",
            "Controlla il totale, inserisci i dati richiesti e conferma.",
            "Apri Storico per ritrovare la liquidazione; usa Annulla solo se il pagamento registrato va realmente stornato.",
        ],
        "caption_left": "Scelta delle provvigioni da pagare",
        "caption_right": "Liquidazione conservata nello storico",
        "process": ("Pagare le provvigioni", "Seleziona e verifica nello storico"),
    },
    "rimborsi-2.png": {
        "files": ["rimborsi-2.png", "rimborsi-3.png", "rimborsi-4.png"],
        "title": "Creare, seguire e completare un rimborso",
        "goal": "Registrare una richiesta e distinguerla dal denaro già restituito.",
        "access": "In Rimborsi premi Nuovo rimborso, compila i dati e salva; poi riapri la riga dall'elenco.",
        "fields": ["Cliente e ordine", "Importo e motivo", "Stato del rimborso"],
        "use": "Il rimborso nasce come richiesta e resta aperto finché il pagamento non viene realmente eseguito. Soltanto allora va indicato il conto e segnato come effettuato; l'annullamento resta un'operazione distinta.",
        "steps": [
            "Premi Nuovo rimborso e collega l'ordine, quando esiste.",
            "Inserisci importo, motivo, intestatario e gli altri dati disponibili, quindi salva.",
            "Lascia il rimborso nello stato Richiesto finché il denaro non è stato restituito.",
            "Dopo il pagamento reale, apri la riga, scegli data e conto e premi Segna come effettuato.",
        ],
        "caption_left": "Inserimento della richiesta",
        "caption_right": "Rimborso visibile nell'elenco",
        "caption_third": "Conferma del pagamento effettuato",
        "process": ("Gestire un rimborso", "1-3 · Crea, controlla e completa"),
    },
    "spotlight-1.png": {
        "files": ["spotlight-1.png", "spotlight-2.png", "spotlight-3.png"],
        "title": "Cercare un elemento o avviare un comando",
        "goal": "Raggiungere rapidamente un dato oppure avviare una funzione senza cambiare pagina più volte.",
        "access": "Premi Alt+P oppure il campo di ricerca in alto e inizia a scrivere.",
        "fields": ["Campo di ricerca", "Categorie dei risultati", "Elemento da aprire"],
        "use": "All'apertura vedi i comandi rapidi. Digitando un nome o un numero compaiono i risultati divisi per categoria; scrivendo il nome di una funzione puoi invece avviarla direttamente.",
        "steps": [
            "Premi Alt+P oppure il campo di ricerca nella barra superiore.",
            "Scrivi un nome, un numero d'ordine o il nome dell'operazione da eseguire.",
            "Se compaiono più risultati, aggiungi anno, cognome o un altro dettaglio.",
            "Premi il risultato corretto per aprire il record o avviare il comando.",
        ],
        "caption_left": "Spotlight appena aperto",
        "caption_right": "Risultati ottenuti dalla ricerca",
        "caption_third": "Comando trovato e pronto da aprire",
        "process": ("Usare Spotlight", "Apri, cerca o avvia"),
    },
    "dashboard-6.png": {
        "files": ["dashboard-6.png", "dashboard-7.png"],
        "title": "Leggere i dettagli nel periodo corretto",
        "goal": "Interpretare classifiche e confronti senza mescolare anni diversi.",
        "access": "Leggi i grafici di dettaglio; prima di confrontarli usa il calendario in basso a sinistra per scegliere l'anno.",
        "fields": ["Agenti o regioni", "Valori dei grafici", "Anno di lavoro"],
        "use": "Le classifiche seguono l'anno selezionato. Cambiando anno, Dashboard, elenchi e ricerche si aggiornano insieme; Tutti gli anni serve invece a una lettura complessiva.",
        "steps": [
            "Apri il calendario in basso a sinistra e scegli l'anno da analizzare.",
            "Torna ai grafici della Dashboard e apri la classifica Agenti o Regioni.",
            "Passa il mouse sulle barre per leggere i valori esatti.",
            "Usa Tutti gli anni soltanto quando vuoi un confronto complessivo.",
        ],
        "caption_left": "Classifiche della Dashboard",
        "caption_right": "Selettore dell'anno di lavoro",
        "process": ("Leggere i grafici", "Dettagli e periodo"),
    },
    "giornaliero-12.png": {
        "files": ["giornaliero-12.png", "giornaliero-13.png", "giornaliero-14.png"],
        "title": "Cosa puoi fare su un ordine già inserito",
        "goal": "Aprire un ordine, registrare un pagamento, segnalarlo oppure interromperne il percorso.",
        "access": "Nel Giornaliero trova l'ordine e premi i tre puntini alla fine della sua riga.",
        "fields": ["Menu delle azioni", "Dettaglio del pagamento", "Indicatore di stato"],
        "use": "Apri / modifica conserva le correzioni quando salvi l'ordine. Registra pagamento aggiunge il movimento con tipo, importo, stato e conto scelti. Le segnalazioni servono a richiamare l'attenzione senza cambiare fase; Rifiuta ordine ed Elimina interrompono invece il normale percorso. L'indicatore in alto permette di controllare lo stato raggiunto, ma non si preme.",
        "steps": [
            "Trova l'ordine nel Giornaliero e premi i tre puntini in fondo alla riga.",
            "Scegli Apri / modifica per cambiare cliente, medico, prodotti, prezzi, note o pagamenti già presenti.",
            "Scegli Registra pagamento per inserire un acconto, saldo o rata; indica importo, Atteso o Incassato, conto e data, poi premi Salva.",
            "Usa le segnalazioni per evidenziare un'urgenza, un'anomalia o un ordine da sollecitare; non cambiano lo stato dell'ordine.",
            "Usa Sostituzione prodotto, Rifiuta ordine o Elimina solo per quei casi specifici; poi apri l'ordine e leggi l'indicatore in alto per verificare la fase raggiunta.",
        ],
        "caption_left": "Azioni disponibili sulla riga",
        "caption_right": "Correzione di un pagamento",
        "caption_third": "Percorso aggiornato dell'ordine",
        "process": ("Ordine già inserito", "Apri il menu e scegli cosa fare"),
        "crop_first": (0.48, 0.02, 0.99, 0.96),
    },
    "pannelli-1.png": {
        "files": ["pannelli-1.png", "pannelli-2.png"],
        "title": "Notifiche e recupero dal Cestino",
        "goal": "Gestire gli avvisi correnti e recuperare separatamente gli elementi eliminati.",
        "access": "Usa la campanella per le notifiche; usa il cestino nella barra superiore per gli elementi eliminati.",
        "fields": ["Notifiche non lette", "Azione collegata", "Ripristina o elimina"],
        "use": "Una notifica porta all'attività collegata e può essere scartata senza cancellare il dato. Il Cestino contiene invece record eliminati: Ripristina li rende di nuovo disponibili, mentre l'eliminazione definitiva non è recuperabile.",
        "steps": [
            "Premi la campanella e scegli una notifica per aprire l'attività collegata.",
            "Usa la X solo per togliere l'avviso: l'ordine o il pagamento rimane nel gestionale.",
            "Per recuperare un elemento eliminato, apri il Cestino dalla barra superiore.",
            "Premi Ripristina per rimetterlo nelle normali viste; elimina definitivamente solo se non deve più essere recuperato.",
        ],
        "caption_left": "Pannello delle notifiche",
        "caption_right": "Elemento presente nel Cestino",
        "process": ("Pannelli rapidi", "Avvisi e recupero"),
    },
}


class NumberedDocTemplate(BaseDocTemplate):
    def __init__(self, filename, **kwargs):
        super().__init__(filename, **kwargs)
        self._bookmark_id = 0

    def beforeDocument(self):
        self._bookmark_id = 0

    def afterFlowable(self, flowable):
        if not isinstance(flowable, Paragraph):
            return
        if getattr(flowable, "_skipToc", False):
            return
        style = flowable.style.name
        if style not in {"h1", "h2", "chapter_title"}:
            return
        level = 0 if style in {"h1", "chapter_title"} else 1
        text = getattr(flowable, "_tocText", flowable.getPlainText())
        key = getattr(flowable, "_bookmarkName", None)
        if not key:
            self._bookmark_id += 1
            key = f"heading-{self._bookmark_id}"
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(text, key, level=level, closed=False)
        self.notify("TOCEntry", (level, text, self.page, key))


class RoundBadge(Flowable):
    """Cerchio numerato, usato al posto dei vecchi quadrati gialli."""
    def __init__(self, text, diameter=9 * mm, fill=YELLOW, text_color=INK, font_size=8.5):
        super().__init__()
        self.text = str(text)
        self.width = diameter
        self.height = diameter
        self.fill = fill
        self.text_color = text_color
        self.font_size = font_size

    def draw(self):
        c = self.canv
        r = self.width / 2
        c.saveState()
        c.setFillColor(self.fill)
        c.circle(r, r, r, stroke=0, fill=1)
        c.setFillColor(self.text_color)
        c.setFont(FONT_BOLD, self.font_size)
        c.drawCentredString(r, r - self.font_size * 0.34, self.text)
        c.restoreState()


def header_footer(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 15 * mm, w - 24 * mm, 15 * mm)
    canvas.setFillColor(YELLOW)
    canvas.circle(w - 17.5 * mm, 10.5 * mm, 5.2 * mm, stroke=0, fill=1)
    canvas.setFont(FONT, 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 9.5 * mm, f"Gestionale PharmaTek - Manuale operativo - {VERSION}")
    canvas.setFillColor(INK)
    canvas.setFont(FONT_BOLD, 8)
    canvas.drawCentredString(w - 17.5 * mm, 9.45 * mm, str(doc.page))
    canvas.restoreState()


def future_page_background(canvas, doc):
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(INK)
    canvas.rect(0, 0, w, h, stroke=0, fill=1)
    canvas.setFillColor(YELLOW)
    canvas.rect(0, h - 7 * mm, w, 7 * mm, stroke=0, fill=1)

    # Segni grafici volutamente ampi e tenui: richiamano la copertina senza competere con il testo.
    canvas.setStrokeColor(colors.HexColor("#344355"))
    canvas.setLineWidth(1.1)
    for radius in (19 * mm, 29 * mm, 39 * mm):
        canvas.circle(w - 8 * mm, h - 42 * mm, radius, stroke=1, fill=0)
    canvas.setFillColor(colors.HexColor("#202D3D"))
    path = canvas.beginPath()
    path.moveTo(0, 0)
    path.lineTo(58 * mm, 0)
    path.lineTo(26 * mm, 83 * mm)
    path.lineTo(0, 67 * mm)
    path.close()
    canvas.drawPath(path, stroke=0, fill=1)
    canvas.setFillColor(YELLOW)
    canvas.circle(w - 17.5 * mm, 10.5 * mm, 5.2 * mm, stroke=0, fill=1)
    canvas.setFont(FONT, 8)
    canvas.setFillColor(colors.HexColor("#91A0B0"))
    canvas.drawString(18 * mm, 9.5 * mm, f"Gestionale PharmaTek - Idee per il futuro - {VERSION}")
    canvas.setFillColor(INK)
    canvas.setFont(FONT_BOLD, 8)
    canvas.drawCentredString(w - 17.5 * mm, 9.45 * mm, str(doc.page))
    canvas.restoreState()


def blank_page(canvas, doc):
    pass


def p(text, style="body", bookmark=None):
    obj = Paragraph(text, S[style])
    if bookmark:
        obj._bookmarkName = bookmark
    return obj


def section_title(number, title, bookmark):
    """Titolo interno con numero di capitolo usato come segno grafico giallo."""
    return p(f'<font color="#D99A00" size="27">{number}</font>&nbsp;&nbsp;{title}', "h1", bookmark)


def bullets(items, color=YELLOW, compact=False):
    rows = []
    for index, item in enumerate(items, 1):
        rows.append([RoundBadge(index, diameter=7 * mm, fill=color, font_size=7.2), p(item, "body")])
    table = Table(rows, colWidths=[10 * mm, 154 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2 if compact else 5),
        ("LINEBELOW", (1, 0), (1, -2), 0.35, colors.HexColor("#E8ECF0")),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return table


def chapter_path(steps):
    cells = []
    for index, step in enumerate(steps, 1):
        cells.append([RoundBadge(index, diameter=8 * mm, fill=YELLOW, font_size=7.5),
                      Spacer(1, 2.5 * mm), p(step, "chapter_step")])
    table = Table([cells], colWidths=[52 * mm, 52 * mm, 52 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F7F9FB")),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.6, LINE),
        ("LINEABOVE", (0, 0), (-1, 0), 3, YELLOW),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 4 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
    ]))
    return table


def chapter_grid(items):
    cells = []
    for index, item in enumerate(items, 1):
        cells.append(Table([[RoundBadge(index, diameter=6.5 * mm, font_size=6.8), p(item, "chapter_step")]],
                           colWidths=[9 * mm, 68 * mm], style=TableStyle([
                               ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                               ("LEFTPADDING", (0, 0), (-1, -1), 0),
                               ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                               ("TOPPADDING", (0, 0), (-1, -1), 2),
                               ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                           ])))
    rows = [cells[i:i + 2] for i in range(0, len(cells), 2)]
    if rows and len(rows[-1]) == 1:
        rows[-1].append("")
    return Table(rows, colWidths=[81 * mm, 81 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F7F9FB")),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))


def callout(label, text, accent=YELLOW):
    content = Paragraph(f"<b>{label}</b><br/>{text}", S["callout"])
    t = Table([[content]], colWidths=[164 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("LINEBEFORE", (0, 0), (0, -1), 4, accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def conclusion_step(item, number):
    """Scheda sintetica per il flusso ordine-produzione-spedizione-incasso."""
    copy = [
        p(item["title"], "h2"),
        p(item["text"], "body"),
        Spacer(1, 1.5 * mm),
        p(f'<font color="#18875A"><b>CONTROLLO</b></font><br/>{item["check"]}', "guide_small"),
    ]
    return Table([[RoundBadge(number, diameter=10 * mm, font_size=8), copy]],
                 colWidths=[15 * mm, 149 * mm], hAlign="LEFT",
                 style=TableStyle([
                     ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F7F9FB")),
                     ("BOX", (0, 0), (-1, -1), 0.55, LINE),
                     ("LINEABOVE", (0, 0), (-1, 0), 2.5, YELLOW),
                     ("VALIGN", (0, 0), (-1, -1), "TOP"),
                     ("LEFTPADDING", (0, 0), (0, 0), 4 * mm),
                     ("RIGHTPADDING", (0, 0), (0, 0), 2 * mm),
                     ("LEFTPADDING", (1, 0), (1, 0), 2 * mm),
                     ("RIGHTPADDING", (1, 0), (1, 0), 5 * mm),
                     ("TOPPADDING", (0, 0), (-1, -1), 4 * mm),
                     ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
                 ]))


def conclusion_check_card(group):
    items = "<br/>".join(f'<font color="#D99A00"><b>•</b></font>&nbsp; {item}' for item in group["items"])
    return Table([[[p(group["title"], "h2"), Spacer(1, 3 * mm), p(items, "guide")]]],
                 colWidths=[52 * mm], rowHeights=[88 * mm],
                 style=TableStyle([
                     ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F7F9FB")),
                     ("BOX", (0, 0), (-1, -1), 0.55, LINE),
                     ("LINEABOVE", (0, 0), (-1, 0), 3, YELLOW),
                     ("VALIGN", (0, 0), (-1, -1), "TOP"),
                     ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
                     ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
                     ("TOPPADDING", (0, 0), (-1, -1), 5 * mm),
                     ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * mm),
                 ]))


def conclusion_problem_card(item):
    return Table([[[p(item["title"], "figure_title"), Spacer(1, 2 * mm), p(item["action"], "guide_small")]]],
                 colWidths=[78 * mm], rowHeights=[48 * mm],
                 style=TableStyle([
                     ("BACKGROUND", (0, 0), (-1, -1), PALE),
                     ("BOX", (0, 0), (-1, -1), 0.55, LINE),
                     ("LINEBEFORE", (0, 0), (0, -1), 3, RED),
                     ("VALIGN", (0, 0), (-1, -1), "TOP"),
                     ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
                     ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
                     ("TOPPADDING", (0, 0), (-1, -1), 4 * mm),
                     ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
                 ]))


def conclusion_pages():
    workflow = []
    for index, item in enumerate(CONCLUSIONS["workflow"], 1):
        workflow += [conclusion_step(item, index), Spacer(1, 3 * mm)]

    daily = [conclusion_check_card(group) for group in CONCLUSIONS["daily_checks"]]
    daily_row = Table([daily], colWidths=[54 * mm, 54 * mm, 54 * mm],
                      style=TableStyle([
                          ("VALIGN", (0, 0), (-1, -1), "TOP"),
                          ("LEFTPADDING", (0, 0), (-1, -1), 0),
                          ("RIGHTPADDING", (0, 0), (1, 0), 2 * mm),
                          ("RIGHTPADDING", (2, 0), (2, 0), 0),
                      ]))

    rule_cards = []
    for rule in CONCLUSIONS["rules"]:
        rule_cards.append(Table([[[p(rule["title"], "figure_title"), Spacer(1, 2 * mm), p(rule["text"], "guide_small")]]],
                                colWidths=[78 * mm], rowHeights=[38 * mm],
                                style=TableStyle([
                                    ("BACKGROUND", (0, 0), (-1, -1), PALE),
                                    ("BOX", (0, 0), (-1, -1), 0.55, LINE),
                                    ("LINEBEFORE", (0, 0), (0, -1), 3, GREEN),
                                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                    ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
                                    ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
                                    ("TOPPADDING", (0, 0), (-1, -1), 4 * mm),
                                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
                                ])))
    rule_row = Table([rule_cards], colWidths=[81 * mm, 81 * mm],
                     style=TableStyle([
                         ("VALIGN", (0, 0), (-1, -1), "TOP"),
                         ("LEFTPADDING", (0, 0), (-1, -1), 0),
                         ("RIGHTPADDING", (0, 0), (0, 0), 3 * mm),
                         ("RIGHTPADDING", (1, 0), (1, 0), 0),
                     ]))

    problems = CONCLUSIONS["problems"]
    problem_rows = []
    for index in range(0, len(problems), 2):
        problem_rows.append([conclusion_problem_card(problems[index]), conclusion_problem_card(problems[index + 1])])
    problem_grid = Table(problem_rows, colWidths=[81 * mm, 81 * mm],
                         style=TableStyle([
                             ("VALIGN", (0, 0), (-1, -1), "TOP"),
                             ("LEFTPADDING", (0, 0), (-1, -1), 0),
                             ("RIGHTPADDING", (0, 0), (0, -1), 3 * mm),
                             ("RIGHTPADDING", (1, 0), (1, -1), 0),
                             ("TOPPADDING", (0, 0), (-1, -1), 0),
                             ("BOTTOMPADDING", (0, 0), (-1, -2), 3 * mm),
                         ]))

    where_rows = []
    for task, chapter, anchor in CONCLUSIONS["where_to_go"]:
        link = f'<link href="#{anchor}" color="#A86F00"><b>{chapter}</b></link>'
        where_rows.append([p(task, "body"), p(link, "body")])
    where_table = Table(where_rows, colWidths=[112 * mm, 52 * mm],
                        style=TableStyle([
                            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F7F9FB")),
                            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#F7F9FB")]),
                            ("BOX", (0, 0), (-1, -1), 0.55, LINE),
                            ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 5 * mm),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 5 * mm),
                            ("TOPPADDING", (0, 0), (-1, -1), 3.5 * mm),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5 * mm),
                        ]))

    return [
        p("Le quattro verifiche principali", "h1"), p(CONCLUSIONS["intro"]), Spacer(1, 4 * mm), *workflow,
        PageBreak(), p("Tre controlli da fare ogni giorno", "h1"),
        p("Sono verifiche brevi che evitano gli errori più comuni."), Spacer(1, 6 * mm), daily_row,
        Spacer(1, 7 * mm), callout("SE DEVI CORREGGERE UN DATO", "Modifica il record originale: l'ordine per prodotti e prezzi, il pagamento per importo e conto, la spedizione per destinatario e colli. Poi controlla il nuovo riepilogo.", GREEN),
        Spacer(1, 7 * mm), p("Due regole da ricordare", "h2"), Spacer(1, 3 * mm), rule_row,
        PageBreak(), p("Se qualcosa non torna", "h1"),
        p("Parti dal problema che vedi e fai il controllo indicato."), Spacer(1, 5 * mm), problem_grid,
        PageBreak(), p("Dove trovi le operazioni principali", "h1"),
        p("Usa i collegamenti per tornare direttamente al capitolo corretto."), Spacer(1, 5 * mm), where_table,
        Spacer(1, 7 * mm), callout("PRIMA DI CONFERMARE", "Rileggi sempre il riepilogo finale. Se cliente, prodotti, importi o destinatario non corrispondono al lavoro reale, torna indietro e correggili prima di salvare.", YELLOW_DARK),
        Spacer(1, 7 * mm), callout("QUANDO CHIEDI ASSISTENZA", CONCLUSIONS["support"], GREEN),
    ]


def admin_access_card(label, title, text):
    return Table([[
        RoundBadge("5", diameter=13 * mm, font_size=10),
        [p(label, "chapter_no"), Spacer(1, 2 * mm), p(title, "h2"), Spacer(1, 2 * mm), p(text, "guide")],
    ]], colWidths=[19 * mm, 59 * mm], rowHeights=[66 * mm],
        style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F7F9FB")),
            ("BOX", (0, 0), (-1, -1), 0.6, LINE),
            ("LINEABOVE", (0, 0), (-1, 0), 3, YELLOW),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (0, 0), 5 * mm),
            ("RIGHTPADDING", (0, 0), (0, 0), 1 * mm),
            ("LEFTPADDING", (1, 0), (1, 0), 2 * mm),
            ("RIGHTPADDING", (1, 0), (1, 0), 5 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 6 * mm),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * mm),
        ]))


def admin_access_page():
    access = ADMIN_APPENDIX["access"]
    methods = Table([[
        admin_access_card("TASTIERA", "Premi Canc", access["keyboard"]),
        admin_access_card("MOUSE", "Premi il cestino", access["mouse"]),
    ]], colWidths=[81 * mm, 81 * mm],
        style=TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (0, 0), 3 * mm),
            ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ]))
    return [
        p(access["title"], "h1"), p(access["intro"]), Spacer(1, 7 * mm), methods,
        Spacer(1, 7 * mm), callout("LA SEQUENZA DEVE ESSERE RAPIDA", access["timing"], YELLOW_DARK),
        Spacer(1, 6 * mm), callout("PER USCIRE SENZA FARE MODIFICHE", access["exit"], GREEN),
        Spacer(1, 6 * mm), callout("APRIRE IL CENTRO NON CANCELLA I DATI", access["safe"]),
        PageBreak(),
    ]


def future_card(group):
    heading = Table([[RoundBadge(group["number"], diameter=9 * mm, fill=YELLOW, font_size=7.2),
                      p(group["title"], "future_title")]], colWidths=[12 * mm, 64 * mm], hAlign="LEFT",
                    style=TableStyle([
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 0),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                        ("TOPPADDING", (0, 0), (-1, -1), 0),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                    ]))
    items = "<br/>".join(f'<font color="#F4C20D"><b>+</b></font>&nbsp; {item}' for item in group["items"])
    content = [heading, Spacer(1, 3 * mm), p(group["summary"], "future_body"),
               Spacer(1, 2 * mm), p(items, "future_items")]
    return Table([[content]], colWidths=[78 * mm], rowHeights=[64 * mm], hAlign="LEFT",
                 style=TableStyle([
                     ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#202D3D")),
                     ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#344355")),
                     ("LINEABOVE", (0, 0), (-1, 0), 3, YELLOW),
                     ("VALIGN", (0, 0), (-1, -1), "TOP"),
                     ("LEFTPADDING", (0, 0), (-1, -1), 6 * mm),
                     ("RIGHTPADDING", (0, 0), (-1, -1), 6 * mm),
                     ("TOPPADDING", (0, 0), (-1, -1), 5 * mm),
                     ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
                 ]))


def future_features_page():
    groups = FUTURE_FEATURES["groups"]
    hero = Table([[[p("POSSIBILI EVOLUZIONI", "eyebrow"), p(FUTURE_FEATURES["title"], "future_hero"),
                    Spacer(1, 1.5 * mm), p(FUTURE_FEATURES["lead"], "future_hero_body")]]], colWidths=[164 * mm],
                 style=TableStyle([
                     ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF8DA")),
                     ("LINEBEFORE", (0, 0), (0, -1), 5, YELLOW),
                     ("LEFTPADDING", (0, 0), (-1, -1), 7 * mm),
                     ("RIGHTPADDING", (0, 0), (-1, -1), 7 * mm),
                     ("TOPPADDING", (0, 0), (-1, -1), 5 * mm),
                     ("BOTTOMPADDING", (0, 0), (-1, -1), 5 * mm),
                 ]))
    row_one = Table([[future_card(groups[0]), future_card(groups[1])]], colWidths=[81 * mm, 81 * mm],
                    style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                      ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                      ("RIGHTPADDING", (0, 0), (0, -1), 3 * mm),
                                      ("RIGHTPADDING", (1, 0), (1, -1), 0)]))
    row_two = Table([[future_card(groups[2]), future_card(groups[3])]], colWidths=[81 * mm, 81 * mm],
                    style=TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                      ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                      ("RIGHTPADDING", (0, 0), (0, -1), 3 * mm),
                                      ("RIGHTPADDING", (1, 0), (1, -1), 0)]))
    available_content = p(f'<font color="#58D69A"><b>GIÀ NEL GESTIONALE</b></font><br/>{FUTURE_FEATURES["already_available"]}', "future_available")
    available = Table([[available_content]], colWidths=[164 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#26394A")),
        ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#3D5264")),
        ("LINEBEFORE", (0, 0), (0, -1), 4, GREEN),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return [NextPageTemplate("future"), PageBreak(), p("Evoluzioni possibili", "future_page_h1", "evoluzioni-possibili"), hero,
            Spacer(1, 5 * mm), row_one, Spacer(1, 4 * mm), row_two,
            Spacer(1, 5 * mm), available]


def optimized_image(source: Path, cache: Path, max_px=1600, quality=82) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / f"{source.stem}.jpg"
    if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
        return target
    with PILImage.open(source) as im:
        im = im.convert("RGB")
        im.thumbnail((max_px, max_px), PILImage.Resampling.LANCZOS)
        im.save(target, "JPEG", quality=quality, optimize=True, progressive=True, subsampling=0)
    return target


def optimized_crop(source: Path, cache: Path, fractions, suffix="crop", max_px=1400, quality=84) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / f"{source.stem}-{suffix}.jpg"
    if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
        return target
    with PILImage.open(source) as im:
        im = im.convert("RGB")
        w, h = im.size
        x0, y0, x1, y1 = fractions
        im = im.crop((int(w * x0), int(h * y0), int(w * x1), int(h * y1)))
        im.thumbnail((max_px, max_px), PILImage.Resampling.LANCZOS)
        im.save(target, "JPEG", quality=quality, optimize=True, progressive=True, subsampling=0)
    return target


def editorial_image(source: Path, cache: Path) -> Path:
    """Ritaglia le catture 4K lasciando soltanto pannelli, avvisi e comandi utili."""
    if source.name == "spedizioni-7.png":
        return optimized_crop(source, cache, (0.02, 0.35, 0.98, 0.99), "riepilogo-incassi")
    if source.name == "provvigioni-1.png":
        return optimized_crop(source, cache, (0.07, 0.17, 0.99, 0.84), "calcolo-provvigioni")
    if source.name == "impostazioni-7-ripristino.png":
        return optimized_crop(source, cache, (0.33, 0.28, 0.67, 0.71), "modal")
    if source.name == "amministrazione-1-centro-ripristino.png":
        return optimized_crop(source, cache, (0.27, 0.025, 0.73, 0.38), "choice")
    if not source.name.startswith("amministrazione-"):
        return optimized_image(source, cache)

    target = cache / f"{source.stem}-editorial.jpg"
    if target.exists() and target.stat().st_mtime >= source.stat().st_mtime:
        return target
    with PILImage.open(source) as original:
        im = original.convert("RGB")
        w, h = im.size
        top = im.crop((int(w * 0.27), int(h * 0.025), int(w * 0.73), int(h * 0.39)))
        footer = im.crop((int(w * 0.27), int(h * 0.91), int(w * 0.73), int(h * 0.997)))
        divider = 8
        composed = PILImage.new("RGB", (max(top.width, footer.width), top.height + divider + footer.height), "white")
        composed.paste(top, (0, 0))
        ImageDraw.Draw(composed).rectangle((0, top.height, composed.width, top.height + divider), fill="#E7EBF0")
        composed.paste(footer, (0, top.height + divider))
        composed.thumbnail((1800, 1800), PILImage.Resampling.LANCZOS)
        composed.save(target, "JPEG", quality=88, optimize=True, progressive=True, subsampling=0)
    return target


def editorial_text(chapter_key: str, caption: str, number: int):
    """Testo breve e naturale, senza ripetere una checklist per ogni figura."""
    return caption


def step_lines(steps):
    return "<br/>".join(f"<font color='#A86F00'><b>{i + 1}.</b></font>&nbsp; {item}" for i, item in enumerate(steps[:5]))


def walkthrough_steps(guide):
    """Include sempre il punto di partenza, senza ripeterlo nelle istruzioni."""
    ordered = [guide.get("start", ""), *guide.get("steps", [])]
    result = []
    for item in ordered:
        item = item.strip()
        if item and item not in result:
            result.append(item)
    return result[:5]


def result_with_details(guide):
    text = guide["result"]
    for key, label in (("terms", "PAROLE UTILI"), ("example", "ESEMPIO"), ("attention", "ATTENZIONE"), ("recovery", "SE QUALCOSA NON TORNA")):
        if guide.get(key):
            text += f"<br/><br/><font color='#516070'><b>{label}</b><br/>{guide[key]}</font>"
    return text


def guide_box(label, text, width, accent=YELLOW, small=False):
    style = S["guide_small"] if small else S["guide"]
    content = Paragraph(f"<font color='#A86F00'><b>{label}</b></font><br/>{text}", style)
    return Table([[content]], colWidths=[width], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE),
        ("LINEBEFORE", (0, 0), (0, -1), 3, accent),
        ("BOX", (0, 0), (-1, -1), 0.45, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))


def process_bar(process):
    if not process:
        return []
    return [Table([[p(process[0].upper(), "process_left"), p(process[1], "process_right")]], colWidths=[88 * mm, 72 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF8D9")),
        ("TEXTCOLOR", (0, 0), (-1, -1), YELLOW_DARK),
        ("BOX", (0, 0), (-1, -1), 0.45, colors.HexColor("#F1D46A")),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ])), Spacer(1, 2 * mm)]


def figure(source: Path, number: int, title: str, caption: str, cache: Path, chapter_key: str):
    guide = GUIDES[source.name]
    opt = editorial_image(source, cache)
    with PILImage.open(opt) as im:
        iw, ih = im.size
    ratio = iw / ih
    compact = source.name not in FULL_SCREENSHOTS
    custom_compact = {
        "dashboard-7.png": (100 * mm, 76 * mm),
        "giornaliero-14.png": (108 * mm, 72 * mm),
        "produzione-2.png": (86 * mm, 108 * mm),
        "produzione-5.png": (112 * mm, 72 * mm),
        "spedizioni-10.png": (90 * mm, 110 * mm),
        "rimborsi-4.png": (104 * mm, 82 * mm),
    }.get(source.name)
    if compact and custom_compact:
        max_w, max_h = custom_compact
    elif compact and ratio > 2.3:
        # Barre, riepiloghi e passaggi orizzontali: larghi ma bassi.
        max_w, max_h = 98 * mm, 58 * mm
    elif compact and ratio < 0.9:
        # Modali verticali: abbastanza grandi da leggere i campi senza dominare.
        max_w, max_h = 70 * mm, 102 * mm
    elif compact:
        max_w, max_h = 74 * mm, 94 * mm
    else:
        # La cornice e i suoi padding devono restare entro i 164 mm utili.
        # Lasciare l'immagine a 164 mm la farebbe debordare sotto i blocchi
        # successivi in alcune pagine particolarmente dense.
        max_w, max_h = 160 * mm, 105 * mm
    scale = min(max_w / iw, max_h / ih)
    img = Image(str(opt), width=iw * scale, height=ih * scale)
    img.hAlign = "CENTER"
    badge = RoundBadge(f"{number:02d}", diameter=10 * mm, font_size=8.5)
    heading = Table([[badge, p(title, "figure_title")]], colWidths=[13 * mm, 151 * mm], style=TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    process_label = process_bar(PROCESS_META.get(source.name))

    card_width = (max_w + 4 * mm) if compact else 164 * mm
    card = Table([[img]], colWidths=[card_width], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), WHITE), ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    cap = p(f"<b>Figura {number}.</b> {caption}", "caption")
    if compact:
        image_col = card_width + 4 * mm
        text_col = 164 * mm - image_col
        narrative = (
            f"<font color='#A86F00'><b>A COSA SERVE</b></font><br/>{guide['goal']}<br/><br/>"
            f"<font color='#A86F00'><b>COME SI FA</b></font><br/>{step_lines(walkthrough_steps(guide))}<br/><br/>"
            f"<font color='#18875A'><b>COSA SUCCEDE DOPO</b></font><br/>{result_with_details(guide)}"
        )
        note = Table([[Paragraph(narrative, S["guide_small"]) ]], colWidths=[text_col - 1 * mm], style=TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), PALE), ("BOX", (0, 0), (-1, -1), 0.55, LINE),
            ("LINEBEFORE", (0, 0), (0, -1), 3, YELLOW),
            ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        row = Table([[card, note]], colWidths=[image_col, text_col], style=TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (0, -1), 4), ("RIGHTPADDING", (1, 0), (1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        return KeepTogether(process_label + [heading, row, cap, Spacer(1, 3 * mm)])

    goal = guide_box("A COSA SERVE", guide["goal"], 78 * mm)
    steps = guide_box("COME SI FA", step_lines(walkthrough_steps(guide)), 82 * mm, small=True)
    details = Table([[goal, steps]], colWidths=[80 * mm, 84 * mm], style=TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (0, -1), 4),
        ("RIGHTPADDING", (1, 0), (1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    result = guide_box("COSA SUCCEDE DOPO", result_with_details(guide), 164 * mm, accent=GREEN)
    return KeepTogether(process_label + [heading, card, cap, details, Spacer(1, 2.5 * mm), result, Spacer(1, 4 * mm)])


def combined_figure(screenshots: Path, cache: Path, numbers, meta):
    sources = [screenshots / name for name in meta["files"]]
    prepared = [optimized_image(source, cache) for source in sources]
    for index, key in enumerate(("crop_first", "crop_second", "crop_third")):
        if index < len(prepared) and meta.get(key):
            prepared[index] = optimized_crop(sources[index], cache, meta[key], f"detail-{index + 1}")

    images = []
    for index, path in enumerate(prepared):
        with PILImage.open(path) as im:
            iw, ih = im.size
        if len(prepared) == 3 and index == 2:
            scale = min((158 * mm) / iw, (45 * mm) / ih)
        else:
            scale = min((77 * mm) / iw, ((70 if len(prepared) == 3 else 92) * mm) / ih)
        images.append(Image(str(path), width=iw * scale, height=ih * scale))

    badge_text = f"{numbers[0]}-{numbers[-1]}" if len(numbers) > 2 else f"{numbers[0]}/{numbers[1]}"
    badge = RoundBadge(badge_text, diameter=11 * mm, font_size=6.2 if len(numbers) > 2 else 6.5)
    heading = Table([[badge, p(meta["title"], "figure_title")]], colWidths=[14 * mm, 150 * mm], style=TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4), ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    image_cells = [[images[0], images[1]]]
    image_style = [
        ("BACKGROUND", (0, 0), (-1, -1), WHITE), ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4), ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if len(images) == 3:
        image_cells.append([images[2], ""])
        image_style.append(("SPAN", (0, 1), (1, 1)))
    image_row = Table(image_cells, colWidths=[81 * mm, 81 * mm], style=TableStyle(image_style))
    caption_texts = [meta["caption_left"], meta["caption_right"]]
    if len(numbers) == 3:
        caption_texts.append(meta["caption_third"])
    captions = p(" &nbsp;&nbsp; ".join(f"<b>Figura {number}.</b> {caption}." for number, caption in zip(numbers, caption_texts)), "caption")
    combined_steps = meta.get("steps") or [meta["access"], meta["use"].split(".")[0].strip() + "."]
    goal = guide_box("A COSA SERVE", meta["goal"], 78 * mm)
    steps = guide_box("COME SI FA", step_lines(combined_steps), 82 * mm, small=True)
    details = Table([[goal, steps]], colWidths=[80 * mm, 84 * mm], style=TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, -1), 4), ("RIGHTPADDING", (1, 0), (1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    why = guide_box("COSA SUCCEDE DOPO", meta["use"], 164 * mm, accent=GREEN)
    return KeepTogether(process_bar(meta["process"]) + [heading, image_row, captions, details, Spacer(1, 2.5 * mm), why, Spacer(1, 4 * mm)])


def chapter_cover(chapter):
    title = p(chapter["title"], "chapter_title", f"section-{chapter['key']}")
    title._tocText = f"{chapter['number']}  {chapter['title']}"
    guide = CHAPTER_GUIDANCE.get(chapter["key"])
    if not guide:
        title._bookmarkName = f"chapter-{chapter['key']}"
        title._skipToc = True
        return [
            NextPageTemplate("blank"), PageBreak(), Spacer(1, 42 * mm),
            p(f"CAPITOLO {chapter['number']}", "chapter_no"), Spacer(1, 5 * mm), title,
            Spacer(1, 8 * mm), p(chapter["lead"], "chapter_lead"), Spacer(1, 15 * mm),
            Table([[""]], colWidths=[38 * mm], rowHeights=[3 * mm], style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), YELLOW)])),
            NextPageTemplate("content"), PageBreak(),
        ]

    content = [NextPageTemplate("blank"), PageBreak(), Spacer(1, 25 * mm),
               p(f"CAPITOLO {chapter['number']}", "chapter_no"), Spacer(1, 4 * mm), title,
               Spacer(1, 6 * mm), p(guide["intro"], "chapter_lead"),
               Spacer(1, 8 * mm), p("COME FUNZIONA", "chapter_no"), Spacer(1, 3 * mm),
               chapter_path(guide["steps"]), Spacer(1, 6 * mm),
               callout("UN CONSIGLIO", guide["tip"], YELLOW_DARK)]
    if chapter.get("links"):
        links = " &nbsp; | &nbsp; ".join(f'<link href="#{anchor}" color="#A86F00"><b>{label}</b></link>' for label, anchor in chapter["links"])
        content += [Spacer(1, 5 * mm), callout("CONTINUA NEI CAPITOLI COLLEGATI", links)]
    content += [NextPageTemplate("content"), PageBreak()]
    return content


def build_story(screenshots: Path, cache: Path):
    story = []
    # Cover
    app_icon = Image(str(sidebar_app_icon(cache)), width=16 * mm, height=16 * mm)
    cover_brand = Table([[app_icon, p(TITLE, "cover_brand")]], colWidths=[20 * mm, 120 * mm],
                        style=TableStyle([
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 0),
                            ("RIGHTPADDING", (0, 0), (0, 0), 4 * mm),
                            ("TOPPADDING", (0, 0), (-1, -1), 0),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                        ]))
    cover_brand.hAlign = "LEFT"
    story += [Spacer(1, 34 * mm), cover_brand, Spacer(1, 10 * mm),
              p(SUBTITLE, "cover_title"), Spacer(1, 8 * mm),
              p("Guida passo-passo per il lavoro quotidiano", "cover_sub"), Spacer(1, 55 * mm),
              p(VERSION, "cover_sub"), NextPageTemplate("content"), PageBreak()]
    story += [p("Indice", "toc_h", "indice")]
    toc = TableOfContents()
    toc.levelStyles = [S["toc1"], S["toc2"]]
    story += [toc, PageBreak()]

    story += [p(INTRO["title"], "h1", "introduzione"), p(INTRO["lead"], "h2")]
    story += [p(x) for x in INTRO["body"]]
    story += [Spacer(1, 3 * mm), p("Le parole che incontrerai", "h2"), bullets(GLOSSARY, compact=True),
              Spacer(1, 4 * mm), callout("COME LEGGERE LE PROCEDURE", "I numeri indicano l'ordine dei passaggi. I riquadri spiegano il risultato, le operazioni da eseguire e gli eventuali controlli in caso di errore."),
              Spacer(1, 5 * mm), p("Percorso del manuale", "h2"),
              chapter_grid([c["title"] for c in CHAPTERS] + [CONCLUSIONS["title"], ADMIN_APPENDIX["title"], "Evoluzioni possibili"])]

    figure_no = 0
    merged_members = {name for meta in MERGED_GROUPS.values() for name in meta["files"][1:]}
    for chapter in CHAPTERS:
        story += chapter_cover(chapter)
        first_figure = True
        for filename, title, caption in chapter["figures"]:
            if filename in merged_members:
                continue
            if filename in MERGED_GROUPS:
                group_size = len(MERGED_GROUPS[filename]["files"])
                numbers = tuple(range(figure_no + 1, figure_no + group_size + 1))
                block = combined_figure(screenshots, cache, numbers, MERGED_GROUPS[filename])
                story.append(KeepTogether([p("Schermate e percorsi", "h2"), block]) if first_figure else block)
                first_figure = False
                figure_no += group_size
                continue
            figure_no += 1
            block = figure(screenshots / filename, figure_no, title, caption, cache, chapter["key"])
            story.append(KeepTogether([p("Schermate e percorsi", "h2"), block]) if first_figure else block)
            first_figure = False

    story += chapter_cover({"number": "08", "key": "conclusioni", "title": CONCLUSIONS["title"], "lead": CONCLUSIONS["lead"]})
    story += conclusion_pages()

    story += chapter_cover(ADMIN_APPENDIX)
    story += admin_access_page()
    first_admin = True
    for filename, title, caption in ADMIN_APPENDIX["figures"]:
        figure_no += 1
        block = figure(screenshots / filename, figure_no, title, caption, cache, "amministrazione")
        story.append(KeepTogether([p("Operazioni riservate", "h2"), block]) if first_admin else block)
        first_admin = False
    story += future_features_page()
    return story, figure_no


def validate_manifest(screenshots: Path):
    actual = {p.name for p in screenshots.glob("*.png")}
    declared = [f[0] for c in CHAPTERS for f in c["figures"]] + [f[0] for f in ADMIN_APPENDIX["figures"]]
    duplicates = sorted({x for x in declared if declared.count(x) > 1})
    missing = sorted(actual - set(declared), key=natural_key)
    absent = sorted(set(declared) - actual, key=natural_key)
    if duplicates or missing or absent:
        raise SystemExit(f"Manifest non valido. Duplicati={duplicates}; non dichiarati={missing}; assenti={absent}")
    guide_names = set(GUIDES)
    if guide_names != actual:
        raise SystemExit(f"Guide non allineate. Mancano={sorted(actual-guide_names)}; extra={sorted(guide_names-actual)}")
    if not actual:
        raise SystemExit("La cartella screenshot è vuota")
    return len(actual)


def make_pdf(output: Path, screenshots: Path):
    count = validate_manifest(screenshots)
    output.parent.mkdir(parents=True, exist_ok=True)
    cache = TMP / "assets"
    story, figures = build_story(screenshots, cache)
    doc = NumberedDocTemplate(
        str(output), pagesize=A4, rightMargin=23 * mm, leftMargin=23 * mm,
        topMargin=20 * mm, bottomMargin=20 * mm,
        title=f"{TITLE} - {SUBTITLE}", author="Gestionale PharmaTek", subject="Manuale operativo illustrato",
        creator="Generatore manuale Gestionale PharmaTek", pageCompression=1,
    )
    content_frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="content")
    blank_frame = Frame(20 * mm, 20 * mm, A4[0] - 40 * mm, A4[1] - 40 * mm, id="blank")
    doc.addPageTemplates([
        PageTemplate(id="blank", frames=[blank_frame], onPage=blank_page, pagesize=A4,
                     autoNextPageTemplate="blank"),
        PageTemplate(id="content", frames=[content_frame], onPage=header_footer),
        PageTemplate(id="future", frames=[content_frame], onPage=future_page_background,
                     autoNextPageTemplate="future"),
    ])

    # Dark backgrounds for cover/chapter pages are painted via callbacks selected by template.
    original_blank = doc.pageTemplates[0]
    def dark_page(canvas, _doc):
        canvas.saveState(); canvas.setFillColor(INK); canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
        canvas.setFillColor(YELLOW); canvas.rect(0, A4[1] - 7 * mm, A4[0], 7 * mm, fill=1, stroke=0)
        # Geometria pulita: una fascia diagonale e un sottile segno giallo.
        canvas.setFillColor(colors.HexColor("#202D3D"))
        path = canvas.beginPath()
        path.moveTo(A4[0] * 0.72, 0)
        path.lineTo(A4[0], 0)
        path.lineTo(A4[0], A4[1] * 0.64)
        path.close()
        canvas.drawPath(path, stroke=0, fill=1)
        canvas.setFillColor(YELLOW)
        canvas.roundRect(A4[0] - 13 * mm, 24 * mm, 2.2 * mm, 34 * mm, 1.1 * mm, stroke=0, fill=1)
        canvas.restoreState()
    original_blank.onPage = dark_page
    doc.multiBuild(story, maxPasses=30)
    print(f"Creato {output} con {figures}/{count} immagini dichiarate")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Genera il manuale operativo illustrato PharmaTek")
    parser.add_argument("--screenshots", type=Path, default=DEFAULT_SCREENSHOTS)
    parser.add_argument("--output", type=Path, default=OUTPUT / "Manuale-operativo-PharmaTek.pdf")
    args = parser.parse_args()
    make_pdf(args.output.resolve(), args.screenshots.resolve())



