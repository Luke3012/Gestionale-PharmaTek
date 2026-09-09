"""Renderizza e controlla il PDF generato.

Produce PNG di tutte le pagine e tavole di contatto in tmp/pdfs/qa.
"""

from pathlib import Path
import shutil

from PIL import Image, ImageDraw
import pypdfium2 as pdfium
from pypdf import PdfReader
from figure_guides import GUIDES, PROCESS_META
from generate_manual import MERGED_GROUPS

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "output" / "pdf" / "Manuale-operativo-PharmaTek.pdf"
QA = ROOT / "tmp" / "pdfs" / "qa"
SCREENSHOTS = Path(r"C:\Users\lucat\Pictures\Screenshots\PharmaTek")


def main():
    if QA.exists():
        shutil.rmtree(QA)
    pages_dir = QA / "pages"
    pages_dir.mkdir(parents=True)
    pdf = pdfium.PdfDocument(PDF)
    thumbs = []
    for index, page in enumerate(pdf):
        bitmap = page.render(scale=1.25)
        image = bitmap.to_pil().convert("RGB")
        image.save(pages_dir / f"page-{index + 1:03d}.jpg", quality=84, optimize=True)
        thumb = image.copy()
        thumb.thumbnail((260, 368), Image.Resampling.LANCZOS)
        thumbs.append((index + 1, thumb))

    for sheet_index in range(0, len(thumbs), 12):
        group = thumbs[sheet_index:sheet_index + 12]
        sheet = Image.new("RGB", (4 * 280, 3 * 402), "#dfe4ea")
        draw = ImageDraw.Draw(sheet)
        for slot, (page_no, thumb) in enumerate(group):
            x = (slot % 4) * 280 + 10
            y = (slot // 4) * 402 + 24
            sheet.paste(thumb, (x + (260 - thumb.width) // 2, y))
            draw.text((x, 5 + (slot // 4) * 402), f"Pagina {page_no}", fill="#172231")
        sheet.save(QA / f"contact-{sheet_index // 12 + 1:02d}.jpg", quality=88, optimize=True)

    reader = PdfReader(PDF)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert len(reader.pages) == len(thumbs)
    image_count = len(list(SCREENSHOTS.glob("*.png")))
    assert image_count == 89
    assert text.count("Figura ") == image_count
    # Le coppie unite condividono una sola spiegazione per evitare ripetizioni.
    merged_screens = sum(len(meta["files"]) - 1 for meta in MERGED_GROUPS.values())
    expected_explanations = image_count - merged_screens
    assert text.count("A COSA SERVE") == expected_explanations
    assert text.count("COME SI FA") == expected_explanations
    assert text.count("COSA SUCCEDE DOPO") == expected_explanations
    assert len(GUIDES) == image_count and len(PROCESS_META) == image_count
    assert all({"goal", "start", "steps", "result"}.issubset(guide) for guide in GUIDES.values())
    # Il punto di partenza viene impaginato come primo passaggio; non obblighiamo
    # le guide brevi ad aggiungere una seconda frase artificiale o ripetitiva.
    assert all(2 <= len(dict.fromkeys([guide["start"], *guide["steps"]])) <= 5 for guide in GUIDES.values())
    forbidden_unaccented = [
        " dovra ", " piu ", " puo ", " perche ", " cosi ", " gia ",
        " attivita ", " modalita ", " quantita ", " citta ", " priorita ",
        " possibilita ", " contabilita ", " novita ", " comparira ",
    ]
    normalized = " " + " ".join(text.lower().split()) + " "
    assert not [word for word in forbidden_unaccented if word in normalized]
    for generic_phrase in [
        "questa immagine",
        "questa schermata",
        "operazione necessaria",
        "funzione indicata",
        "controlla menu delle azioni",
    ]:
        assert generic_phrase not in normalized
    assert "scegli apri / modifica per cambiare cliente" in normalized
    assert "scegli registra pagamento per inserire un acconto" in normalized
    assert "Filtri della Produzione" in text
    assert "Spedizione conclusa ed esportazione" in text
    explanation_text = " ".join(text.split())
    for required_explanation in [
        "Unisci lotti",
        "Separa lotto",
        "Le distinte restano separate per corriere",
        "Già incassato",
        "Da incassare",
        "partendo dalle scadenze più vicine",
        "divide il totale per 1,10",
        "l'importo fisso non cambia",
    ]:
        assert required_explanation in explanation_text
    assert "Luglio 2026" not in text
    editorial_phrases = [
        "PERCHÉ LE VEDI INSIEME", "evitano di ripetere", "file originali",
        "nel manuale il secondo", "la prima immagine mostra", "questa immagine",
        "questa spiegazione", "COSA STAI GUARDANDO", "COME CI ARRIVI",
        "passaggi che si aiutano a vicenda", "senza perdere il filo",
        "chiude davvero il cerchio", "qui nasce e viene seguito",
        "Diramazione",
    ]
    assert not [phrase for phrase in editorial_phrases if phrase.lower() in text.lower()]
    assert reader.outline
    for heading in ["Dashboard", "Giornaliero", "Produzione", "Spedizioni", "Contabilità", "Anagrafiche", "Impostazioni", "Il lavoro, dall'ordine all'incasso", "Appendice amministratori", "Evoluzioni possibili"]:
        assert heading in text
    for conclusion_heading in ["Le quattro verifiche principali", "Tre controlli da fare ogni giorno", "Se qualcosa non torna", "Dove trovi le operazioni principali"]:
        assert conclusion_heading in text
    assert "Aruba" in text and "Clienti" in text and "Importa" in text and "(FAKE)" in text
    assert "Come aprire il Centro di ripristino" in text
    assert "cinque volte il tasto Canc" in text
    assert "una volta l'icona del cestino" in text
    assert "1,5 secondi" in text
    flat_text = " ".join(text.split())
    assert "Scheda anagrafica cliente e preventivo pronti per la stampa" in flat_text
    assert "Sollecito automatico dei preventivi e dei saldi meno recenti" in flat_text
    assert "Gestione più facile, unificata e veloce" in flat_text
    for removed_future_text in [
        "Archiviazione e stampa automatica",
        "Gestione intelligente delle correzioni e degli errori",
        "Acquisizione e conservazione dell'ordine",
        "Ordini da WhatsApp",
    ]:
        assert removed_future_text not in text
    assert 65 <= len(reader.pages) <= 85
    print(f"QA completata: {len(reader.pages)} pagine, {image_count} figure, guide e ruoli di processo, {len(list(QA.glob('contact-*.jpg')))} tavole")


if __name__ == "__main__":
    main()



