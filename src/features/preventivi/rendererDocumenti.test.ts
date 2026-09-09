import { describe, expect, it } from "vitest";
// @ts-expect-error Le API Node sono disponibili nel runner Vitest, non nel bundle dell'app.
import { mkdirSync, writeFileSync } from "node:fs";
// @ts-expect-error Le API Node sono disponibili nel runner Vitest, non nel bundle dell'app.
import { resolve } from "node:path";
import type { Preventivo, SchedaClienteCampi } from "../../lib/tauri";
import {
  A4_HEIGHT,
  A4_WIDTH,
  avvolgiTesto,
  creaDocumentoPreventivo,
  creaDocumentoSchedaCliente,
  documentoPdfBytes,
  documentoSvg,
  pagineDocumento,
} from "./rendererDocumenti";

const prodottiImmunoterapia = [
  { id: "__seed_prod_sublinguale_2_fiale__", nome: "Sublinguale 2 fiale", prezzo: 28_000 },
  { id: "__seed_prod_sublinguale_3_fiale__", nome: "Sublinguale 3 fiale", prezzo: 35_000 },
  { id: "__seed_prod_polimerizzato_1_fiala__", nome: "Polimerizzato 1 fiala", prezzo: 28_000 },
  { id: "__seed_prod_polimerizzato_2_fiale__", nome: "Polimerizzato 2 fiale", prezzo: 40_000 },
  { id: "__seed_prod_lisato_batterico_2_fiale__", nome: "Lisato batterico 2 fiale", prezzo: 28_000 },
  { id: "__seed_prod_lisato_batterico_3_fiale__", nome: "Lisato batterico 3 fiale", prezzo: 28_000 },
  { id: "__seed_prod_lisato_batterico_4_fiale__", nome: "Lisato batterico 4 fiale", prezzo: 28_000 },
] as const;
const posologieImmunoterapia = [
  "2+2",
  "3+3",
  "3",
  "2+2+2",
  "1+2+3",
  "1+2+3+3",
  "3+3+3",
  "2",
] as const;

const preventivo: Preventivo = {
  id: "preventivo/ordine-1",
  revision: "1",
  esiste: true,
  ordineId: "ordine-1",
  ordineRevision: "1",
  ordineNumero: "2026-0001",
  ordineData: "2026-07-26",
  creatoMs: new Date("2026-07-27T10:00:00+02:00").getTime(),
  ordineStato: "Nuovo",
  linee: ["Immunoterapia"],
  clienteId: "cliente-1",
  clienteNome: "Mario Rossi",
  clienteIndirizzo: "Via Roma 1",
  clienteCitta: "Milano",
  clienteCap: "20100",
  clienteProv: "MI",
  spedizioneNome: "Mario Rossi",
  spedizioneIndirizzo: "Via Roma 1",
  spedizioneCitta: "Milano",
  spedizioneCap: "20100",
  spedizioneProv: "MI",
  spedizioneEmail: "",
  spedizioneTelefono: "+39 333 1234567",
  spedizioneNote: "Chiamare prima della consegna",
  spedizioneCodiceFiscale: "RSSMRA80A01F205X",
  fatturazioneNome: "Rossi Medical S.r.l.",
  fatturazioneIndirizzo: "Via Fatture 5",
  fatturazioneCitta: "Milano",
  fatturazioneCap: "20100",
  fatturazioneProv: "MI",
  fatturazionePiva: "IT12345678901",
  fatturazioneCodiceFiscale: "RSSMRA80A01F205X",
  medicoId: "medico-1",
  medicoNome: "Dott.ssa Laura Bianchi",
  agenteId: "agente-1",
  agenteNome: "Livio",
  email: "",
  telefono: "+39 333 1234567",
  numeroPreventivo: "P-2026-0001",
  validitaGiorni: 30,
  condizioniPagamento: "Acconto alla conferma, saldo secondo accordi.",
  introduzione: "Come da accordi, riportiamo la nostra proposta.",
  note: "Consegna da concordare.",
  scontoPercentuale: 10,
  acconto: 10_000,
  totale: 68_000,
  fingerprintCorrente: "abc",
  ultimaModificaMs: 1,
  ultimaModificaUtente: "Tester",
  ultimaModificaDispositivo: "PC",
  ultimoInvioMs: 0,
  ultimoInvioCanale: "",
  ultimoInvioFingerprint: "",
  ultimoInvioComunicazioneId: "",
  ultimoSollecitoMs: 0,
  indicazioneInvio: "mai_inviato",
  versioneModello: 2,
  utilizziProdotti: [],
  pagamenti: [
    {
      id: "pag-1",
      ordineId: "ordine-1",
      tipo: "acconto",
      importo: 10_000,
      saldato: true,
      scadenza: "",
      contoId: "conto-1",
      contoNome: "Banca PharmaTek",
      contoTipo: "banca",
      contoIban: "IBAN-DEMO-NON-VALIDO",
      data: "2026-07-27",
      verificato: true,
      distintaId: "",
      contoAccreditoNome: "",
      note: "",
      scadDaSpedizione: false,
      scadRelGiorni: 0,
    },
    {
      id: "pag-2",
      ordineId: "ordine-1",
      tipo: "saldo",
      importo: 58_000,
      saldato: false,
      scadenza: "",
      contoId: "conto-1",
      contoNome: "Banca PharmaTek",
      contoTipo: "banca",
      contoIban: "IBAN-DEMO-NON-VALIDO",
      data: "",
      verificato: false,
      distintaId: "",
      contoAccreditoNome: "",
      note: "",
      scadDaSpedizione: true,
      scadRelGiorni: 0,
    },
  ],
  righe: [
    {
      id: "r1",
      revision: "1",
      prodottoId: prodottiImmunoterapia[0].id,
      prodottoNome: prodottiImmunoterapia[0].nome,
      categoria: "Immunoterapia",
      qta: 1,
      prezzo: prodottiImmunoterapia[0].prezzo,
      paziente: "Mario Rossi",
      tipoTest: "",
      ml: "",
      codice: "",
      formulazione: "gocce",
      posologia: posologieImmunoterapia[0],
      numero: "",
      allergeni: ["Graminacee"],
    },
    {
      id: "r2",
      revision: "1",
      prodottoId: prodottiImmunoterapia[3].id,
      prodottoNome: prodottiImmunoterapia[3].nome,
      categoria: "Immunoterapia",
      qta: 1,
      prezzo: prodottiImmunoterapia[3].prezzo,
      paziente: "Mario Rossi",
      tipoTest: "",
      ml: "",
      codice: "",
      formulazione: "polimerizzato",
      posologia: posologieImmunoterapia[1],
      numero: "",
      allergeni: ["Acari"],
    },
  ],
};

const pagamentiPerTotale = (totale: number) =>
  preventivo.pagamenti.map((pagamento) =>
    pagamento.tipo === "saldo"
      ? { ...pagamento, importo: Math.max(0, totale - preventivo.acconto) }
      : pagamento,
  );

const preventivoTreProdotti: Preventivo = {
  ...preventivo,
  totale: 96_000,
  pagamenti: pagamentiPerTotale(96_000),
  righe: [
    ...preventivo.righe,
    {
      ...preventivo.righe[0],
      id: "r3",
      prodottoId: prodottiImmunoterapia[5].id,
      prodottoNome: prodottiImmunoterapia[5].nome,
      categoria: "Immunoterapia",
      prezzo: prodottiImmunoterapia[5].prezzo,
      paziente: "Giulia Bianchi",
      formulazione: "spray",
      posologia: posologieImmunoterapia[2],
      numero: "",
      allergeni: ["Parietaria"],
      tipoTest: "",
      ml: "",
      codice: "",
    },
  ],
};

const preventivoDiagnostica: Preventivo = {
  ...preventivo,
  id: "preventivo/diagnostica-1",
  numeroPreventivo: "P-2026-0002",
  linee: ["Diagnostica"],
  totale: 42_000,
  pagamenti: pagamentiPerTotale(42_000),
  righe: Array.from({ length: 3 }, (_, index) => ({
    ...preventivo.righe[0],
    id: `diagnostica-${index + 1}`,
    prodottoId: `dx-${index + 1}`,
    prodottoNome: [
      "Pannello molecolare respiratorio",
      "Profilo diagnostico alimentare",
      "Pannello molecolare completo",
    ][index],
    categoria: "Diagnostica",
    prezzo: [14_000, 16_000, 12_000][index],
    paziente: ["Mario Rossi", "Giulia Bianchi", "Luca Verdi"][index],
    formulazione: "",
    posologia: "",
    numero: "",
    allergeni: [
      ["Graminacee", "Acari"],
      ["Latte", "Uovo", "Arachide"],
      ["Betulla", "Parietaria", "Alternaria"],
    ][index],
    tipoTest: ["Respiratorio", "Alimentare", "Completo"][index],
    ml: ["3", "4", "5"][index],
    codice: `DX-${301 + index}`,
  })),
};

const scheda: SchedaClienteCampi = {
  dataRicezione: "2026-07-26",
  pazienti: "Mario Rossi",
  infoSpedizione: "Via Roma 1, 20100 Milano (MI)",
  contatti: "+39 333 1234567 · ",
  intestatarioNome: "Mario Rossi",
  intestatarioCodiceFiscale: "RSSMRA80A01F205X",
  intestatarioDataNascita: "",
  intestatarioLuogoNascita: "",
  intestatarioIndirizzo: "Via Roma 1, 20100 Milano (MI)",
  importoTotale: 42_000,
  importoAcconto: 10_000,
  dataContabileValuta: "",
  modalitaSaldo: "bonifico",
  note: "Chiamare prima della consegna.",
  preventivoWhatsapp: true,
  preventivoEmail: false,
  mantenimento: false,
  npp: false,
  pazienteNuovo: true,
};

const processoQa = (
  globalThis as typeof globalThis & {
    process?: { cwd(): string; env: Record<string, string | undefined> };
  }
).process;

describe("renderer documenti FASE 12", () => {
  it("può produrre gli artefatti locali per la QA visiva", () => {
    if (processoQa?.env.PT_RENDER_FASE12_QA !== "1") return;
    const cartella = resolve(processoQa.cwd(), "tmp", "pdfs", "fase12-qa");
    const output = resolve(processoQa.cwd(), "output", "pdf");
    mkdirSync(cartella, { recursive: true });
    mkdirSync(output, { recursive: true });
    const documentoPreventivo = creaDocumentoPreventivo(preventivo);
    const documentoTreProdotti = creaDocumentoPreventivo(preventivoTreProdotti);
    const documentoDiagnostica = creaDocumentoPreventivo(preventivoDiagnostica);
    const documentoSenzaSconto = creaDocumentoPreventivo({
      ...preventivo,
      scontoPercentuale: 0,
    });
    const righeMultipagina = Array.from({ length: 14 }, (_, index) => {
      const prodotto = prodottiImmunoterapia[index % prodottiImmunoterapia.length];
      return {
        ...preventivo.righe[index % preventivo.righe.length],
        id: `qa-${index}`,
        prodottoId: prodotto.id,
        prodottoNome: prodotto.nome,
        prezzo: prodotto.prezzo,
        formulazione: ["gocce", "polimerizzato", "sottocute", "spray"][index % 4],
        posologia: posologieImmunoterapia[index % posologieImmunoterapia.length],
        allergeni: ["Graminacee", "Betulla", "Parietaria", "Acari"],
        tipoTest: "",
        ml: "",
        codice: "",
      };
    });
    const totaleMultipagina = righeMultipagina.reduce(
      (totale, riga) => totale + riga.prezzo * riga.qta,
      0,
    );
    const documentoMultipagina = creaDocumentoPreventivo({
      ...preventivo,
      totale: totaleMultipagina,
      pagamenti: pagamentiPerTotale(totaleMultipagina),
      righe: righeMultipagina,
    });
    const documentoScheda = creaDocumentoSchedaCliente("2026-0001", scheda);
    writeFileSync(
      resolve(cartella, "fase12-preventivo-qa.pdf"),
      documentoPdfBytes(documentoPreventivo),
    );
    writeFileSync(
      resolve(output, "preventivo-multipagina-qa.pdf"),
      documentoPdfBytes(documentoMultipagina),
    );
    writeFileSync(
      resolve(output, "preventivo-tre-prodotti-qa.pdf"),
      documentoPdfBytes(documentoTreProdotti),
    );
    writeFileSync(
      resolve(output, "preventivo-diagnostica-qa.pdf"),
      documentoPdfBytes(documentoDiagnostica),
    );
    writeFileSync(
      resolve(output, "preventivo-senza-sconto-qa.pdf"),
      documentoPdfBytes(documentoSenzaSconto),
    );
    writeFileSync(
      resolve(cartella, "fase12-scheda-cliente-qa.pdf"),
      documentoPdfBytes(documentoScheda),
    );
    writeFileSync(
      resolve(cartella, "fase12-preventivo-qa.svg"),
      documentoSvg(documentoPreventivo),
      "utf8",
    );
    pagineDocumento(documentoMultipagina).forEach((_, index) => {
      writeFileSync(
        resolve(cartella, `fase12-preventivo-multipagina-p${index + 1}.svg`),
        documentoSvg(documentoMultipagina, index),
        "utf8",
      );
    });
    writeFileSync(
      resolve(cartella, "fase12-scheda-cliente-qa.svg"),
      documentoSvg(documentoScheda),
      "utf8",
    );
  });

  it("usa una pagina A4 stabile nell'SVG", () => {
    const svg = documentoSvg(creaDocumentoPreventivo(preventivo));
    expect(svg).toContain(`viewBox="0 0 ${A4_WIDTH} ${A4_HEIGHT}"`);
    expect(svg).toContain("P-2026-0001");
    expect(svg).toContain("Sublinguale 2 fiale");
    expect(svg).toContain("Allergeni: Graminacee");
    expect(svg).toContain("DATI DI FATTURAZIONE");
    expect(svg).toContain("Rossi Medical S.r.l.");
    expect(svg).toContain("C.F. RSSMRA80A01F205X");
    expect(svg).toContain("<image");
    expect(svg).toContain("data:image/png;base64,");
    expect(svg).toContain("27/07/2026");
    expect(svg).not.toContain(">26/07/2026<");
    expect(svg.match(/P-2026-0001/g)).toHaveLength(1);
    expect(svg).toContain("Formulazione: gocce");
    expect(svg).toContain("Posologia: 2+2");
    expect(svg).not.toContain("Q.TÀ");
    expect(svg).not.toContain(">POSOLOGIA<");
    expect(svg).not.toContain("2 FIALE");
    expect(svg).toContain("WhatsApp ");
    expect(svg).toContain("IBAN");
    expect(svg).toContain("IBAN-DEMO-NON-VALIDO");
    expect(svg).toContain("SCONTO 10%");
    expect(svg).not.toContain("Dott.ssa Laura Bianchi");
    expect(svg).not.toContain(">Livio<");
    expect(svg).not.toContain(">Immunoterapia<");
  });

  it("mantiene la quantità nel documento delle altre linee", () => {
    const svg = documentoSvg(creaDocumentoPreventivo(preventivoDiagnostica));
    expect(svg).toContain("Q.TÀ");
  });

  it("usa la scadenza di conferma per un acconto non ancora incassato", () => {
    const documento = creaDocumentoPreventivo({
      ...preventivo,
      pagamenti: preventivo.pagamenti.map((pagamento) =>
        pagamento.tipo === "acconto"
          ? { ...pagamento, saldato: false, data: "", scadenza: "" }
          : pagamento,
      ),
    });
    expect(documentoSvg(documento)).toContain("Alla conferma dell'ordine");
  });

  it("mostra gli accordi aggiuntivi soltanto quando compilati", () => {
    expect(
      documentoSvg(
        creaDocumentoPreventivo({
          ...preventivo,
          condizioniPagamento: "",
        }),
      ),
    ).not.toContain("ACCORDI AGGIUNTIVI");
    expect(documentoSvg(creaDocumentoPreventivo(preventivo))).toContain(
      "ACCORDI AGGIUNTIVI",
    );
  });

  it("mostra imponibile e IVA quando non è applicato uno sconto", () => {
    const svg = documentoSvg(
      creaDocumentoPreventivo({
        ...preventivo,
        scontoPercentuale: 0,
      }),
    );
    expect(svg).toContain("IMPONIBILE");
    expect(svg).toContain("IVA 10%");
    expect(svg).toContain("TOTALE IVA INCLUSA");
    expect(svg).not.toContain(">SCONTO ");
    expect(svg).toContain("STATO DELLA PROPOSTA");
  });

  it("sostituisce lo stato della proposta con imponibile e IVA quando applica uno sconto", () => {
    const svg = documentoSvg(creaDocumentoPreventivo(preventivo));
    expect(svg).toContain("VALORE ORIGINALE");
    expect(svg).toContain("SCONTO 10%");
    expect(svg).toContain("IMPONIBILE");
    expect(svg).toContain("IVA 10%");
    expect(svg).toContain("TOTALE IVA INCLUSA");
    expect(svg).not.toContain("STATO DELLA PROPOSTA");
  });

  it("unisce rate e dati economici sotto una sola intestazione", () => {
    const svg = documentoSvg(creaDocumentoPreventivo(preventivo));
    expect(svg.match(/RIEPILOGO ECONOMICO/g)).toHaveLength(1);
    expect(svg).not.toContain("SCADENZIARIO");
    expect(svg.indexOf("Saldo")).toBeLessThan(svg.indexOf("IMPONIBILE"));
  });

  it("replica i dati disponibili quando spedizione o fatturazione non sono compilate", () => {
    const senzaSpedizione = creaDocumentoPreventivo({
      ...preventivo,
      spedizioneNome: "",
      spedizioneIndirizzo: "",
      spedizioneCitta: "",
      spedizioneCap: "",
      spedizioneProv: "",
      spedizioneCodiceFiscale: "",
      spedizioneEmail: "",
      spedizioneTelefono: "",
      spedizioneNote: "",
    });
    const svgSenzaSpedizione = documentoSvg(senzaSpedizione);
    expect(svgSenzaSpedizione.match(/Via Fatture 5/g)).toHaveLength(2);
    expect(svgSenzaSpedizione.match(/C\.F\. RSSMRA80A01F205X/g)).toHaveLength(2);

    const senzaFatturazione = creaDocumentoPreventivo({
      ...preventivo,
      fatturazioneNome: "",
      fatturazioneIndirizzo: "",
      fatturazioneCitta: "",
      fatturazioneCap: "",
      fatturazioneProv: "",
      fatturazionePiva: "",
      fatturazioneCodiceFiscale: "",
    });
    const svgSenzaFatturazione = documentoSvg(senzaFatturazione);
    expect(svgSenzaFatturazione.match(/Via Roma 1/g)).toHaveLength(2);
    expect(svgSenzaFatturazione.match(/C\.F\. RSSMRA80A01F205X/g)).toHaveLength(2);
  });

  it("genera un PDF vettoriale a pagina singola", () => {
    const bytes = documentoPdfBytes(creaDocumentoPreventivo(preventivo));
    const testo = new TextDecoder().decode(bytes);
    expect(testo.startsWith("%PDF-1.4")).toBe(true);
    expect(testo).toContain("/Count 1");
    expect(testo).toContain("PREVENTIVO");
  });

  it("mantiene tre prodotti della stessa linea nella stessa pagina", () => {
    const immunoterapia = creaDocumentoPreventivo(preventivoTreProdotti);
    const diagnostica = creaDocumentoPreventivo(preventivoDiagnostica);
    expect(immunoterapia.overflow).toEqual([]);
    expect(diagnostica.overflow).toEqual([]);
    expect(pagineDocumento(immunoterapia)).toHaveLength(1);
    expect(pagineDocumento(diagnostica)).toHaveLength(1);
    expect(documentoSvg(immunoterapia)).toContain("Lisato batterico 3 fiale");
    expect(documentoSvg(diagnostica)).toContain("Pannello molecolare completo");
  });

  it("porta i prodotti numerosi sulle pagine successive senza tagliarli", () => {
    const pieno = {
      ...preventivo,
      righe: Array.from({ length: 14 }, (_, index) => ({
        ...preventivo.righe[0],
        id: `r${index}`,
        prodottoNome: `Preparazione individualizzata numero ${index + 1}`,
        allergeni: ["Graminacee", "Betulla", "Parietaria"],
      })),
    };
    const documento = creaDocumentoPreventivo(pieno);
    expect(documento.overflow).toEqual([]);
    expect(documento.pagine?.length ?? 0).toBeGreaterThan(0);
    const pdf = new TextDecoder().decode(documentoPdfBytes(documento));
    expect(pdf).toMatch(/\/Count [2-9]/);
    expect(documentoSvg(documento, (documento.pagine?.length ?? 0))).toContain(
      "CONDIZIONI DI PAGAMENTO",
    );
  });

  it("produce la scheda cliente con caselle e riepilogo", () => {
    const documento = creaDocumentoSchedaCliente("2026-0001", scheda, undefined, {
      medicoNome: "Dott. Verdi",
      agenteNome: "Anna Bianchi",
    });
    expect(documento.overflow).toEqual([]);
    const svg = documentoSvg(documento);
    expect(svg).toContain("SCHEDA CLIENTE");
    expect(svg).toContain("<image");
    expect(svg).toContain("data:image/png;base64,");
    expect(svg).toContain("PAZIENTE NUOVO");
    expect(svg).toContain("Mario Rossi");
    expect(svg).toContain("RSSMRA80A01F205X");
    expect(svg).toContain("Medico: Dott. Verdi");
    expect(svg).toContain("Agente: Anna Bianchi");
    expect(svg).not.toContain("DATA E LUOGO DI NASCITA");
    expect(
      documento.nodes.some(
        (node) => node.kind === "text" && node.text === "Mario Rossi" && node.size >= 13,
      ),
    ).toBe(true);
    expect(
      documento.nodes.some(
        (node) =>
          node.kind === "text" &&
          node.text === "DATA CONTABILE / VALUTA" &&
          node.y > 660,
      ),
    ).toBe(true);
  });

  it("lascia righe e celle scrivibili a penna quando i dati sono vuoti", () => {
    const vuota: SchedaClienteCampi = {
      ...scheda,
      dataRicezione: "",
      pazienti: "",
      infoSpedizione: "",
      contatti: "",
      intestatarioNome: "",
      intestatarioCodiceFiscale: "",
      intestatarioDataNascita: "",
      intestatarioLuogoNascita: "",
      intestatarioIndirizzo: "",
      importoTotale: 0,
      importoAcconto: 0,
      dataContabileValuta: "",
      modalitaSaldo: "",
      note: "",
      preventivoWhatsapp: false,
      preventivoEmail: false,
      mantenimento: false,
      npp: false,
      pazienteNuovo: false,
    };
    const documento = creaDocumentoSchedaCliente("2026-0002", vuota);
    const svg = documentoSvg(documento);
    expect(documento.overflow).toEqual([]);
    expect(svg).not.toContain(">—</text>");
    expect(documento.nodes.filter((node) => node.kind === "line").length).toBeGreaterThan(15);
  });

  it("wrappa deterministically senza perdere parole", () => {
    const righe = avvolgiTesto("uno due tre quattro cinque sei", 70, 10);
    expect(righe.length).toBeGreaterThan(1);
    expect(righe.join(" ")).toBe("uno due tre quattro cinque sei");
  });
});
