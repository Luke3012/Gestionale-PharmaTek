import { describe, expect, it } from "vitest";
import {
  chiaveDestinatarioComunicazione,
  emailComunicazioneValida,
  telefonoWhatsappValido,
} from "./ComunicazioneComposer";
import { risolviModello } from "./modelliComunicazione";
import type { PagamentoVista } from "../../lib/tauri";
import {
  datiDestinatarioDaRecord,
  datiPagamentoComunicazione,
  importoResiduoComunicazione,
  riepilogoSollecitoPagamenti,
  variabiliNomeDestinatario,
} from "./apriComunicazione";
import { formattaStimaInvio, stimaInvioSecondi } from "./stimaInvio";
import {
  aggiornaTargetDaRecord,
  canaleCampagnaIniziale,
  chiaveDestinatarioCampagna,
  chiaveTargetCampagna,
  recapitiMancantiTarget,
  riallineaCanaleCampagna,
} from "./CampagnaComunicazioni";
import {
  normalizzaTelefonoWhatsapp,
  urlConversazioneWhatsapp,
  urlNuovaEmail,
} from "./recapiti";
import { leggiPayloadComunicazione } from "./ElementiComunicazione";

function pagamento(
  id: string,
  tipo: "acconto" | "saldo" | "rata",
  importo: number,
  scadenza: string,
  ordineId = "ordine-1",
  ordineNumero = "2026-001",
  saldato = false,
): PagamentoVista {
  return {
    id,
    revision: `rev-${id}`,
    ordineId,
    ordineNumero,
    clienteId: "cliente-1",
    clienteNome: "Cliente Test",
    medicoId: "",
    medicoNome: "",
    agenteId: "",
    agenteNome: "",
    tipo,
    importo,
    saldato,
    scadenza,
    data: "",
    contoId: "banca",
    contoNome: "Banca",
    contoTipo: "banca",
    contoAccreditoNome: "",
    ordineStato: "Confermato",
    linee: [],
    verificato: false,
  };
}

describe("compositore comunicazioni", () => {
  it("genera entrambi gli alias del nome destinatario", () => {
    expect(variabiliNomeDestinatario("Cliente Test")).toEqual({
      nome_cliente: "Cliente Test",
      ragione_sociale: "Cliente Test",
    });
  });

  it("deriva nome e recapiti dall'anagrafica con lo stesso ordine di priorità", () => {
    expect(datiDestinatarioDaRecord({
      id: "cliente-1",
      revision: "rev-1",
      deleted: false,
      data: {
        ragione_sociale: "  Azienda Test  ",
        nome: "Nome ignorato",
        email: " demo@example.invalid ",
        telefono: " 3281883355 ",
      },
    }, "Nome precedente")).toEqual({
      nome: "Azienda Test",
      email: "demo@example.invalid",
      telefono: "3281883355",
    });
  });

  it("mantiene distinti due preventivi dello stesso destinatario", () => {
    const comune = {
      destinatarioEntita: "cliente" as const,
      destinatarioId: "cliente-1",
      destinatarioNome: "Cliente Test",
    };

    expect(
      chiaveTargetCampagna({
        ...comune,
        origineEntita: "preventivo",
        origineId: "preventivo-1",
      }),
    ).not.toBe(
      chiaveTargetCampagna({
        ...comune,
        origineEntita: "preventivo",
        origineId: "preventivo-2",
      }),
    );
  });

  it("risolve i dati disponibili e conserva quelli da completare", () => {
    expect(
      risolviModello(
        "Gentile {{ nome_cliente }}, ordine {{riferimento_ordine}}",
        { nome_cliente: "Mario Rossi" },
      ),
    ).toEqual({
      testo: "Gentile Mario Rossi, ordine {{riferimento_ordine}}",
      mancanti: ["riferimento_ordine"],
    });
  });

  it("riconosce indirizzi e-mail utilizzabili", () => {
    expect(emailComunicazioneValida("demo@example.invalid")).toBe(true);
    expect(emailComunicazioneValida("cliente@example")).toBe(false);
    expect(emailComunicazioneValida("demo@example.invalid\nBcc: demo@example.invalid")).toBe(
      false,
    );
  });

  it("riconosce i recapiti convertibili nel formato internazionale", () => {
    expect(telefonoWhatsappValido("328 188 3355")).toBe(true);
    expect(telefonoWhatsappValido("328 188 335")).toBe(true);
    expect(telefonoWhatsappValido("+39 328 188 3355")).toBe(true);
    expect(telefonoWhatsappValido("0039 328 188 3355")).toBe(true);
    expect(telefonoWhatsappValido("081 123 4567")).toBe(true);
    expect(telefonoWhatsappValido("+39 081 123 4567")).toBe(true);
    expect(telefonoWhatsappValido("123")).toBe(false);
  });

  it("preferisce il cellulare quando l'anagrafica contiene più recapiti", () => {
    expect(normalizzaTelefonoWhatsapp("081 1234567 - 328 188 3355")).toBe(
      "+393281883355",
    );
  });

  it("genera deep-link sicuri per WhatsApp e il client e-mail", () => {
    expect(urlConversazioneWhatsapp("328 188 3355")).toBe(
      "whatsapp://send?phone=393281883355",
    );
    expect(urlConversazioneWhatsapp("081 123 4567")).toBe(
      "whatsapp://send?phone=390811234567",
    );
    expect(urlNuovaEmail("demo@example.invalid")).toBe(
      "mailto:demo%40example.invalid",
    );
    expect(urlNuovaEmail("demo@example.invalid\nBcc: demo@example.invalid")).toBeNull();
  });

  it("non ricarica i modelli quando cambia soltanto il recapito", () => {
    const base = {
      destinatarioEntita: "cliente" as const,
      destinatarioId: "cliente-1",
      destinatarioNome: "Cliente Test",
      email: "",
      telefono: "",
    };
    expect(chiaveDestinatarioComunicazione(base)).toBe(
      chiaveDestinatarioComunicazione({
        ...base,
        email: "demo@example.invalid",
        telefono: "3281883355",
      }),
    );
    expect(
      chiaveDestinatarioComunicazione({
        ...base,
        destinatarioId: "cliente-2",
      }),
    ).not.toBe(chiaveDestinatarioComunicazione(base));
  });

  it("propone entrambi i canali nelle campagne anche con numeri condivisi", () => {
    expect(
      canaleCampagnaIniziale([
        {
          destinatarioEntita: "cliente",
          destinatarioId: "cliente-1",
          destinatarioNome: "Cliente senza email",
          telefono: "3281883355",
        },
        {
          destinatarioEntita: "cliente",
          destinatarioId: "cliente-2",
          destinatarioNome: "Cliente con email",
          email: "demo@example.invalid",
          telefono: "3281883355",
        },
      ]),
    ).toBe("entrambi");
  });

  it("identifica la stessa persona anche se compare da origini diverse", () => {
    const primo = {
      destinatarioEntita: "cliente" as const,
      destinatarioId: "cliente-1",
      destinatarioNome: "Cliente Test",
      origineEntita: "ordine",
      origineId: "ordine-1",
    };
    const secondo = { ...primo, origineId: "ordine-2" };
    expect(chiaveTargetCampagna(primo)).not.toBe(chiaveTargetCampagna(secondo));
    expect(chiaveDestinatarioCampagna(primo)).toBe(
      chiaveDestinatarioCampagna(secondo),
    );
  });

  it("ripiega sull'unico canale disponibile per l'intera campagna", () => {
    expect(
      canaleCampagnaIniziale([
        {
          destinatarioEntita: "cliente",
          destinatarioId: "cliente-1",
          destinatarioNome: "Cliente uno",
          telefono: "3281883355",
        },
        {
          destinatarioEntita: "cliente",
          destinatarioId: "cliente-2",
          destinatarioNome: "Cliente due",
          telefono: "3331234567",
        },
      ]),
    ).toBe("whatsapp");
  });

  it("riallinea il canale quando arriva un nuovo recapito", () => {
    expect(
      riallineaCanaleCampagna(
        "email",
        [
          {
            destinatarioEntita: "cliente",
            destinatarioId: "cliente-1",
            destinatarioNome: "Cliente",
            telefono: "3281883355",
          },
        ],
        false,
      ),
    ).toBe("whatsapp");
  });

  it("preserva la scelta manuale finché resta utilizzabile", () => {
    const entrambi = [
      {
        destinatarioEntita: "cliente" as const,
        destinatarioId: "cliente-1",
        destinatarioNome: "Cliente",
        email: "demo@example.invalid",
        telefono: "3281883355",
      },
    ];
    expect(riallineaCanaleCampagna("email", entrambi, true)).toBe("email");
    expect(
      riallineaCanaleCampagna(
        "email",
        [{ ...entrambi[0], email: "" }],
        true,
      ),
    ).toBe("whatsapp");
  });

  it("aggiorna il recapito realtime e riallinea la revisione dello snapshot", () => {
    const aggiornato = aggiornaTargetDaRecord(
      {
        destinatarioEntita: "cliente",
        destinatarioId: "cliente-1",
        destinatarioNome: "Nome precedente",
        email: "",
        telefono: "",
        snapshot: [
          { entita: "cliente", id: "cliente-1", revision: "rev-vecchia" },
          { entita: "pagamento", id: "pagamento-1", revision: "rev-rata" },
        ],
      },
      {
        id: "cliente-1",
        revision: "rev-nuova",
        deleted: false,
        data: {
          nome: "Luca",
          cognome: "Rossi",
          email: "demo@example.invalid",
          telefono: "3281883355",
        },
      },
    );

    expect(aggiornato).toMatchObject({
      destinatarioNome: "Luca Rossi",
      email: "demo@example.invalid",
      telefono: "3281883355",
    });
    expect(aggiornato.snapshot).toEqual([
      { entita: "cliente", id: "cliente-1", revision: "rev-nuova" },
      { entita: "pagamento", id: "pagamento-1", revision: "rev-rata" },
    ]);
  });

  it("compone istruzioni diverse per banca, contrassegno e assegno", () => {
    const conti = [
      {
        id: "banca",
        revision: "1",
        deleted: false,
        data: { nome: "Banca operativa", tipo: "banca", iban: "IT00TEST" },
      },
    ];
    const risultato = datiPagamentoComunicazione(
      [
        { contoId: "banca", contoTipo: "banca" },
        { contoId: "cash", contoTipo: "contrassegno" },
        { contoId: "check", contoTipo: "assegno" },
      ],
      conti,
    );
    expect(risultato.istruzioni_pagamento).toContain("IBAN: IT00TEST");
    expect(risultato.istruzioni_pagamento).toContain(
      "Intestatario: PharmaTek",
    );
    expect(risultato.istruzioni_pagamento).not.toContain("Banca operativa");
    expect(risultato.istruzioni_pagamento).toContain("contrassegno");
    expect(risultato.istruzioni_pagamento).toContain("assegno intestato");
    expect(risultato.iban).toBe("IT00TEST");
  });

  it("usa l'intestatario specifico per il conto Poste", () => {
    const risultato = datiPagamentoComunicazione(
      [{ contoId: "poste", contoTipo: "banca" }],
      [
        {
          id: "poste",
          revision: "1",
          deleted: false,
          data: {
            nome: "Poste",
            tipo: "banca",
            iban: "IT00 B076 01DE MO",
          },
        },
      ],
    );
    expect(risultato.istruzioni_pagamento).toContain(
      "Intestatario: G.M. PHARMATEK S.R.L.S.",
    );
    expect(risultato.istruzioni_pagamento).not.toContain("Bonifico su Poste");
  });

  it("dettaglia le rate e include le coordinate unificate se il conto è lo stesso", () => {
    const conti = [
      {
        id: "c-1243",
        revision: "1",
        deleted: false,
        data: {
          nome: "Banca Banca Demo 1243",
          tipo: "banca",
          iban: "IT29F03069034911000000011243",
        },
      },
    ];
    const rate = [
      { id: "r1", tipo: "rata", importo: 7500, scadenza: "2026-09-17", contoId: "c-1243" },
      { id: "r2", tipo: "rata", importo: 7500, scadenza: "2026-10-17", contoId: "c-1243" },
      { id: "r3", tipo: "rata", importo: 7500, scadenza: "2026-11-17", contoId: "c-1243" },
    ];
    const res = datiPagamentoComunicazione(rate, conti, undefined, {
      tuttiPagamenti: rate,
      includiRate: true,
    });
    expect(res.istruzioni_pagamento).toBe(
      "Rate previste:\n" +
        "- Rata 1: € 75,00 entro il 17/09/2026\n" +
        "- Rata 2: € 75,00 entro il 17/10/2026\n" +
        "- Rata 3: € 75,00 entro il 17/11/2026\n\n" +
        "Bonifico bancario\n" +
        "Intestatario: PharmaTek\n" +
        "IBAN: IT29F03069034911000000011243.",
    );
  });

  it("dettaglia per ciascuna rata le relative coordinate se i conti o le modalità sono differenti", () => {
    const conti = [
      {
        id: "c-banca",
        revision: "1",
        deleted: false,
        data: {
          nome: "Banca Banca Demo",
          tipo: "banca",
          iban: "IT29F03069034911000000011243",
        },
      },
      {
        id: "c-cash",
        revision: "1",
        deleted: false,
        data: {
          nome: "Contanti",
          tipo: "contrassegno",
        },
      },
    ];
    const rate = [
      { id: "r1", tipo: "rata", importo: 7500, scadenza: "2026-09-17", contoId: "c-cash", contoTipo: "contrassegno" },
      { id: "r2", tipo: "rata", importo: 7500, scadenza: "2026-10-17", contoId: "c-banca" },
    ];
    const res = datiPagamentoComunicazione(rate, conti, undefined, {
      tuttiPagamenti: rate,
      includiRate: true,
    });
    expect(res.istruzioni_pagamento).toContain("- Rata 1: € 75,00 entro il 17/09/2026 in contrassegno al corriere alla consegna");
    expect(res.istruzioni_pagamento).toContain("- Rata 2: € 75,00 entro il 17/10/2026 tramite bonifico bancario su IBAN: IT29F03069034911000000011243 (Intestatario: PharmaTek)");
  });

  it("omette la data per le rate senza scadenza", () => {
    const conti = [
      {
        id: "c-banca",
        revision: "1",
        deleted: false,
        data: {
          nome: "Banca",
          tipo: "banca",
          iban: "IT29F03069034911000000011243",
        },
      },
    ];
    const rate = [
      { id: "r1", tipo: "rata", importo: 7500, scadenza: "", contoId: "c-banca" },
      { id: "r2", tipo: "rata", importo: 7500, scadenza: "2026-10-17", contoId: "c-banca" },
    ];
    const res = datiPagamentoComunicazione(rate, conti, undefined, {
      tuttiPagamenti: rate,
      includiRate: true,
    });
    expect(res.istruzioni_pagamento).toContain("- Rata 1: € 75,00\n- Rata 2: € 75,00 entro il 17/10/2026");
  });

  it("preserva la numerazione originale delle rate residue se la prima rata è saldata", () => {
    const conti = [
      {
        id: "c-banca",
        revision: "1",
        deleted: false,
        data: {
          nome: "Banca",
          tipo: "banca",
          iban: "IT29F03069034911000000011243",
        },
      },
    ];
    const tutte = [
      { id: "r1", tipo: "rata", importo: 7500, scadenza: "2026-09-17", saldato: true, contoId: "c-banca" },
      { id: "r2", tipo: "rata", importo: 7500, scadenza: "2026-10-17", saldato: false, contoId: "c-banca" },
      { id: "r3", tipo: "rata", importo: 7500, scadenza: "2026-11-17", saldato: false, contoId: "c-banca" },
    ];
    const res = datiPagamentoComunicazione(
      tutte.filter((p) => !p.saldato),
      conti,
      undefined,
      {
        tuttiPagamenti: tutte,
        includiRate: true,
      },
    );
    expect(res.istruzioni_pagamento).toContain("- Rata 2: € 75,00 entro il 17/10/2026");
    expect(res.istruzioni_pagamento).toContain("- Rata 3: € 75,00 entro il 17/11/2026");
    expect(res.istruzioni_pagamento).not.toContain("Rata 1");
  });

  it("mostra Rata 3 come rata prevista anche se è l'unica rimasta da saldare", () => {
    const conti = [
      {
        id: "c-banca",
        revision: "1",
        deleted: false,
        data: {
          nome: "Banca",
          tipo: "banca",
          iban: "IT29F03069034911000000011243",
        },
      },
    ];
    const tutte = [
      { id: "r1", tipo: "rata", importo: 7500, scadenza: "2026-09-17", saldato: true, contoId: "c-banca" },
      { id: "r2", tipo: "rata", importo: 7500, scadenza: "2026-10-17", saldato: true, contoId: "c-banca" },
      { id: "r3", tipo: "rata", importo: 7500, scadenza: "2026-11-17", saldato: false, contoId: "c-banca" },
    ];
    const res = datiPagamentoComunicazione(
      tutte.filter((p) => !p.saldato),
      conti,
      undefined,
      {
        tuttiPagamenti: tutte,
        includiRate: true,
      },
    );
    expect(res.istruzioni_pagamento).toContain("Rate previste:\n- Rata 3: € 75,00 entro il 17/11/2026");
  });

  it("mostra solo le coordinate bancarie per un pagamento singolo non rateizzato", () => {
    const conti = [
      {
        id: "c-banca",
        revision: "1",
        deleted: false,
        data: {
          nome: "Banca",
          tipo: "banca",
          iban: "IT29F03069034911000000011243",
        },
      },
    ];
    const singolo = [
      { id: "s1", tipo: "saldo", importo: 22500, scadenza: "2026-09-17", contoId: "c-banca" },
    ];
    const res = datiPagamentoComunicazione(singolo, conti, undefined, {
      tuttiPagamenti: singolo,
      includiRate: true,
    });
    expect(res.istruzioni_pagamento).not.toContain("Rate previste");
    expect(res.istruzioni_pagamento).toBe(
      "Bonifico bancario\n" +
        "Intestatario: PharmaTek\n" +
        "IBAN: IT29F03069034911000000011243.",
    );
  });

  it("non include il prospetto rate se includiRate è disattivato", () => {
    const conti = [
      {
        id: "c-banca",
        revision: "1",
        deleted: false,
        data: {
          nome: "Banca",
          tipo: "banca",
          iban: "IT29F03069034911000000011243",
        },
      },
    ];
    const rate = [
      { id: "r1", tipo: "rata", importo: 7500, scadenza: "2026-09-17", contoId: "c-banca" },
      { id: "r2", tipo: "rata", importo: 7500, scadenza: "2026-10-17", contoId: "c-banca" },
    ];
    const res = datiPagamentoComunicazione(rate, conti, undefined, {
      includiRate: false,
    });
    expect(res.istruzioni_pagamento).not.toContain("Rate previste");
    expect(res.istruzioni_pagamento).toBe(
      "Bonifico bancario\n" +
        "Intestatario: PharmaTek\n" +
        "IBAN: IT29F03069034911000000011243.",
    );
  });

  it("gestisce conti misti nel sollecito (contrassegno + bonifico): dettaglio sulla riga e coordinate con riferimento rata senza contrassegno isolato", () => {
    const conti = [
      {
        id: "c-contrassegno",
        revision: "1",
        deleted: false,
        data: {
          nome: "Contrassegno",
          tipo: "contrassegno",
        },
      },
      {
        id: "c-banca",
        revision: "1",
        deleted: false,
        data: {
          nome: "Banca",
          tipo: "banca",
          iban: "IT29F03069034911000000011243",
        },
      },
    ];
    const rata1 = {
      ...pagamento("r1", "rata", 7500, "2026-09-17"),
      contoId: "c-contrassegno",
      contoTipo: "contrassegno",
      contoNome: "Contrassegno",
    };
    const rata2 = {
      ...pagamento("r2", "rata", 7500, "2026-10-17"),
      contoId: "c-banca",
      contoTipo: "banca",
      contoNome: "Banca",
    };

    const riep = riepilogoSollecitoPagamenti([rata1], [rata1, rata2], "2026-09-20", conti);
    expect(riep.dettaglio_rate).toContain(
      "- Rata 1 di 2 scaduta il 17/09/2026: € 75,00 in contrassegno al corriere alla consegna",
    );
    expect(riep.dettaglio_rate).toContain(
      "- Rata 2 di 2 con scadenza 17/10/2026: € 75,00 tramite bonifico bancario",
    );

    const datiPag = datiPagamentoComunicazione(
      riep.pagamentiAperti,
      conti,
      undefined,
      { tuttiPagamenti: [rata1, rata2], includiRate: false },
    );
    expect(datiPag.istruzioni_pagamento).not.toContain("contrassegno");
    expect(datiPag.istruzioni_pagamento).toBe(
      "Bonifico bancario (per Rata 2):\n" +
        "Intestatario: PharmaTek\n" +
        "IBAN: IT29F03069034911000000011243.",
    );
  });

  it("non comunica importi nulli o negativi come somme da saldare", () => {
    expect(importoResiduoComunicazione(12_345)).toBe("€ 123,45");
    expect(importoResiduoComunicazione(0)).toBe(
      "nessun importo da saldare",
    );
    expect(importoResiduoComunicazione(-5_000)).toBe(
      "nessun importo da saldare",
    );
  });

  it("distingue acconto scaduto e saldo successivo", () => {
    const acconto = pagamento(
      "acconto",
      "acconto",
      10_000,
      "2026-01-10",
    );
    const saldo = pagamento("saldo", "saldo", 20_000, "2026-03-10");
    const risultato = riepilogoSollecitoPagamenti(
      [acconto],
      [acconto, saldo],
      "2026-02-01",
    );

    expect(risultato.totale_scaduto).toBe("€ 100,00");
    expect(risultato.dettaglio_rate).toContain(
      "Acconto scaduto il 10/01/2026: € 100,00",
    );
    expect(risultato.dettaglio_rate).toContain(
      "Altri pagamenti ancora da saldare",
    );
    expect(risultato.dettaglio_rate).toContain(
      "Saldo con scadenza 10/03/2026: € 200,00",
    );
  });

  it("menziona tutte le altre rate ancora da saldare", () => {
    const rata1 = pagamento("rata-1", "rata", 10_000, "2026-01-10");
    const rata2 = pagamento("rata-2", "rata", 20_000, "2026-03-10");
    const rata3 = pagamento("rata-3", "rata", 30_000, "2026-04-10");
    const risultato = riepilogoSollecitoPagamenti(
      [rata1],
      [rata1, rata2, rata3],
      "2026-02-01",
    );

    expect(risultato.dettaglio_rate).toContain(
      "Rata 1 di 3 scaduta il 10/01/2026",
    );
    expect(risultato.dettaglio_rate).toContain(
      "Rata 2 di 3 con scadenza 10/03/2026",
    );
    expect(risultato.dettaglio_rate).toContain(
      "Rata 3 di 3 con scadenza 10/04/2026",
    );
    expect(risultato.pagamentiAperti).toHaveLength(3);
    expect(risultato.pagamentiScaduti).toHaveLength(1);
  });

  it("include nei solleciti il pagamento che scade oggi", () => {
    const saldo = pagamento("saldo", "saldo", 20_000, "2026-02-01");
    const risultato = riepilogoSollecitoPagamenti(
      [saldo],
      [saldo],
      "2026-02-01",
    );

    expect(risultato.pagamentiScaduti.map((item) => item.id)).toEqual([
      "saldo",
    ]);
    expect(risultato.totale_scaduto).toBe("€ 200,00");
    expect(risultato.dettaglio_rate).toContain(
      "Saldo scaduto il 01/02/2026",
    );
  });

  it("non include nel totale scaduto rate future o già saldate", () => {
    const scaduta = pagamento("rata-1", "rata", 10_000, "2026-01-10");
    const futura = pagamento("rata-2", "rata", 20_000, "2026-03-10");
    const saldata = pagamento(
      "rata-0",
      "rata",
      5_000,
      "2025-12-10",
      "ordine-1",
      "2026-001",
      true,
    );
    const risultato = riepilogoSollecitoPagamenti(
      [scaduta],
      [saldata, scaduta, futura],
      "2026-02-01",
    );

    expect(risultato.totale_scaduto).toBe("€ 100,00");
    expect(risultato.pagamentiAperti.map((item) => item.id)).toEqual([
      "rata-1",
      "rata-2",
    ]);
    expect(risultato.dettaglio_rate).not.toContain("€ 50,00");
  });

  it("separa chiaramente pagamenti appartenenti a ordini diversi", () => {
    const rata = pagamento("rata", "rata", 10_000, "2026-01-10");
    const saldo = pagamento(
      "saldo",
      "saldo",
      20_000,
      "2026-01-20",
      "ordine-2",
      "2026-002",
    );
    const risultato = riepilogoSollecitoPagamenti(
      [rata, saldo],
      [rata, saldo],
      "2026-02-01",
    );

    expect(risultato.riferimento_ordine).toBe("2026-001, 2026-002");
    expect(risultato.dettaglio_rate).not.toContain("Ordine 2026-001");
    expect(risultato.dettaglio_rate).not.toContain("Ordine 2026-002");
    expect(risultato.dettaglio_rate).toContain("- Rata scaduta il 10/01/2026: € 100,00");
    expect(risultato.dettaglio_rate).toContain("- Saldo scaduto il 20/01/2026: € 200,00");
    expect(risultato.totale_scaduto).toBe("€ 300,00");
  });
});

describe("stima non invasiva degli invii", () => {
  it("somma i canali sequenziali e compatta i batch lunghi", () => {
    expect(stimaInvioSecondi(["email"])).toBe(2);
    expect(stimaInvioSecondi(["whatsapp"])).toBe(7);
    expect(stimaInvioSecondi(["email", "whatsapp"])).toBe(9);
    expect(formattaStimaInvio(9)).toBe("≈ 9 s");
    expect(formattaStimaInvio(70)).toBe("≈ 1 min 10 s");
  });
});

describe("payload della finestra comunicazione", () => {
  it("restituisce il JSON valido e scarta payload assenti o corrotti", () => {
    expect(leggiPayloadComunicazione<{ id: string }>("?payload=%7B%22id%22%3A%22x%22%7D"))
      .toEqual({ id: "x" });
    expect(leggiPayloadComunicazione("?altro=1")).toBeNull();
    expect(leggiPayloadComunicazione("?payload=%7Bnon-json")).toBeNull();
  });
});

describe("recapiti mancanti per canale della campagna", () => {
  const baseTarget = {
    destinatarioEntita: "cliente" as const,
    destinatarioId: "c-1",
    destinatarioNome: "Maxim Fronte",
  };

  it("non richiede nulla se su WhatsApp e il contatto ha solo WhatsApp (anche se manca e-mail)", () => {
    const target = { ...baseTarget, telefono: "3281234567", email: "" };
    expect(recapitiMancantiTarget(target, "whatsapp")).toEqual({
      richiediEmail: false,
      richiediTelefono: false,
    });
  });

  it("richiede solo e-mail se su E-mail e il contatto ha solo WhatsApp", () => {
    const target = { ...baseTarget, telefono: "3281234567", email: "" };
    expect(recapitiMancantiTarget(target, "email")).toEqual({
      richiediEmail: true,
      richiediTelefono: false,
    });
  });

  it("richiede solo e-mail se su Entrambi e il contatto ha solo WhatsApp", () => {
    const target = { ...baseTarget, telefono: "3281234567", email: "" };
    expect(recapitiMancantiTarget(target, "entrambi")).toEqual({
      richiediEmail: true,
      richiediTelefono: false,
    });
  });

  it("non richiede nulla se su E-mail e il contatto ha solo E-mail (anche se manca cellulare)", () => {
    const target = { ...baseTarget, telefono: "", email: "demo@example.invalid" };
    expect(recapitiMancantiTarget(target, "email")).toEqual({
      richiediEmail: false,
      richiediTelefono: false,
    });
  });

  it("richiede solo cellulare se su WhatsApp e il contatto ha solo E-mail", () => {
    const target = { ...baseTarget, telefono: "", email: "demo@example.invalid" };
    expect(recapitiMancantiTarget(target, "whatsapp")).toEqual({
      richiediEmail: false,
      richiediTelefono: true,
    });
  });

  it("richiede solo cellulare se su Entrambi e il contatto ha solo E-mail", () => {
    const target = { ...baseTarget, telefono: "", email: "demo@example.invalid" };
    expect(recapitiMancantiTarget(target, "entrambi")).toEqual({
      richiediEmail: false,
      richiediTelefono: true,
    });
  });

  it("non richiede nulla se il contatto ha entrambi i recapiti", () => {
    const target = { ...baseTarget, telefono: "3281234567", email: "demo@example.invalid" };
    expect(recapitiMancantiTarget(target, "whatsapp")).toEqual({
      richiediEmail: false,
      richiediTelefono: false,
    });
    expect(recapitiMancantiTarget(target, "email")).toEqual({
      richiediEmail: false,
      richiediTelefono: false,
    });
    expect(recapitiMancantiTarget(target, "entrambi")).toEqual({
      richiediEmail: false,
      richiediTelefono: false,
    });
  });

  it("richiede solo il recapito del canale attivo se il contatto è privo di entrambi", () => {
    const target = { ...baseTarget, telefono: "", email: "" };
    expect(recapitiMancantiTarget(target, "whatsapp")).toEqual({
      richiediEmail: false,
      richiediTelefono: true,
    });
    expect(recapitiMancantiTarget(target, "email")).toEqual({
      richiediEmail: true,
      richiediTelefono: false,
    });
    expect(recapitiMancantiTarget(target, "entrambi")).toEqual({
      richiediEmail: true,
      richiediTelefono: true,
    });
  });
});

