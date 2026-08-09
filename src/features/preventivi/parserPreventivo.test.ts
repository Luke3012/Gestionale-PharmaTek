import { describe, expect, it } from "vitest";
import {
  distanzaDamerauLevenshtein,
  interpretaImportoItaliano,
  interpretaPreventivo,
  normalizzaTestoPreventivo,
} from "./parserPreventivo";

const prodotti = [
  {
    id: "pollini",
    nome: "Mix Pollini Graminacee",
    categoria: "Immunoterapia",
    alias: ["pollini", "graminacee"],
    prezzoSuggerito: 24_000,
  },
  {
    id: "acari",
    nome: "Mix Acari",
    categoria: "Immunoterapia",
    alias: ["acaro", "acari"],
    prezzoSuggerito: 18_000,
  },
  {
    id: "latte",
    nome: "Test intolleranza latte",
    categoria: "Diagnostica",
    prezzoSuggerito: 8_500,
  },
];

const prodottiReali = [
  {
    id: "sublinguale-2",
    nome: "Sublinguale 2 fiale",
    categoria: "Immunoterapia",
    prezzoSuggerito: 28_000,
  },
  {
    id: "lisato-3",
    nome: "Lisato batterico 3 fiale",
    categoria: "Immunoterapia",
    prezzoSuggerito: 28_000,
  },
];

describe("parser preventivo offline", () => {
  it("normalizza accenti, apostrofi e spazi senza dipendere dalla rete", () => {
    expect(normalizzaTestoPreventivo("  Èlite  d’Acari! ")).toBe("elite d'acari");
  });

  it("riconosce refusi con trasposizione", () => {
    expect(distanzaDamerauLevenshtein("acrai", "acari")).toBe(1);
  });

  it.each([
    ["250", 25_000],
    ["€ 250,50", 25_050],
    ["1.250,00 euro", 125_000],
    ["1,250.75", 125_075],
  ])("interpreta l'importo italiano %s", (value, expected) => {
    expect(interpretaImportoItaliano(value)).toBe(expected);
  });

  it("segmenta righe, quantità, prezzi e paziente", () => {
    const result = interpretaPreventivo(
      "due pollini a 250 euro per Mario Rossi; 1 acari € 180",
      { prodotti, lineeOrdine: ["Immunoterapia"] },
    );
    expect(result.righe).toHaveLength(2);
    expect(result.righe[0]).toMatchObject({
      prodottoId: "pollini",
      qta: 2,
      prezzo: 25_000,
      paziente: "Mario Rossi",
      livello: "alta",
    });
    expect(result.righe[1]).toMatchObject({
      prodottoId: "acari",
      qta: 1,
      prezzo: 18_000,
    });
  });

  it("separa i prodotti con virgola o punto e virgola e memorizza allergeni e ceppi", () => {
    const result = interpretaPreventivo(
      [
        "1 Sublinguale 2 fiale € 280 allergeni: d.pteronyssinus, d.farinae per Mario Rossi,",
        "1 Lisato batterico 3 fiale € 280 ceppi: h.influenzae, s.pneumoniae per Lucia Bianchi;",
      ].join(" "),
      { prodotti: prodottiReali, lineeOrdine: ["Immunoterapia"] },
    );

    expect(result.righe).toHaveLength(2);
    expect(result.righe[0]).toMatchObject({
      prodottoId: "sublinguale-2",
      paziente: "Mario Rossi",
      allergeni: ["d.pteronyssinus", "d.farinae"],
    });
    expect(result.righe[1]).toMatchObject({
      prodottoId: "lisato-3",
      paziente: "Lucia Bianchi",
      allergeni: ["h.influenzae", "s.pneumoniae"],
    });
  });

  it("riconosce liberamente posologia e allergeni senza etichette", () => {
    const result = interpretaPreventivo(
      "1 Sublinguale 2 fiale € 280, 2+2, parietaria, d.pter, miscela personale, d.farinae per Mario Rossi",
      {
        prodotti: prodottiReali,
        lineeOrdine: ["Immunoterapia"],
        dettagliProduzione: {
          formulazioni: ["polimerizzato", "gocce"],
          posologie: ["2+2", "3+3"],
          allergeni: [
            "parietaria",
            "d.pteronyssinus",
            "d.farinae",
          ],
        },
      },
    );

    expect(result.righe).toHaveLength(1);
    expect(result.righe[0]).toMatchObject({
      prodottoId: "sublinguale-2",
      paziente: "Mario Rossi",
      posologia: "2+2",
      allergeni: [
        "parietaria",
        "d.pteronyssinus",
        "miscela personale",
        "d.farinae",
      ],
    });
  });

  it("interpreta i dettagli inline del sublinguale dai valori del gestionale", () => {
    const result = interpretaPreventivo("1 sublinguale 2+2 cipresso", {
      prodotti: prodottiReali,
      lineeOrdine: ["Immunoterapia"],
      dettagliProduzione: {
        formulazioni: ["spray", "polimerizzato"],
        posologie: ["2+2", "3+3"],
        allergeni: ["cipresso", "parietaria"],
      },
    });

    expect(result.righe).toHaveLength(1);
    expect(result.righe[0]).toMatchObject({
      prodottoId: "sublinguale-2",
      formulazione: "spray",
      posologia: "2+2",
      allergeni: ["cipresso"],
    });
  });

  it("usa il prezzo suggerito quando il testo non contiene un importo", () => {
    const result = interpretaPreventivo("tre acari", {
      prodotti,
      lineeOrdine: ["Immunoterapia"],
    });
    expect(result.righe[0].prezzo).toBe(18_000);
    expect(result.righe[0].prezzoEsplicito).toBe(false);
  });

  it("corregge un refuso ma conserva motivazione e alternative", () => {
    const result = interpretaPreventivo("1 acarri € 190", {
      prodotti,
      lineeOrdine: ["Immunoterapia"],
    });
    expect(result.righe[0].prodottoId).toBe("acari");
    expect(result.righe[0].motivazioni.join(" ")).toMatch(/refuso|somiglianza/);
    expect(result.righe[0].alternative[0].id).toBe("acari");
  });

  it("prioritizza la linea dell'ordine a parità di somiglianza", () => {
    const result = interpretaPreventivo("test latte", {
      prodotti,
      lineeOrdine: ["Diagnostica"],
    });
    expect(result.righe[0].prodottoId).toBe("latte");
  });

  it("spiega il vantaggio dei prodotti già usati da cliente e medico", () => {
    const result = interpretaPreventivo("acari", {
      prodotti: prodotti.map((prodotto) =>
        prodotto.id === "acari"
          ? { ...prodotto, usiCliente: 3, usiMedico: 5 }
          : prodotto,
      ),
      lineeOrdine: ["Immunoterapia"],
    });
    expect(result.righe[0].motivazioni.join(" ")).toContain("già usato dal cliente");
    expect(result.righe[0].motivazioni.join(" ")).toContain("già usato dal medico");
  });

  it("non applica in silenzio un prodotto sconosciuto", () => {
    const result = interpretaPreventivo("2 preparato totalmente nuovo a 99 euro", {
      prodotti,
    });
    expect(result.righe[0].prodottoId).toBe("");
    expect(result.righe[0].testoLibero).toContain("preparato");
    expect(result.righe[0].richiedeRevisione).toBe(true);
  });

  it("separa le note dichiarate dalle righe commerciali", () => {
    const result = interpretaPreventivo(
      "1 acari\nNote: consegna urgente, chiamare prima",
      { prodotti },
    );
    expect(result.righe).toHaveLength(1);
    expect(result.note).toBe("consegna urgente, chiamare prima");
  });
});
