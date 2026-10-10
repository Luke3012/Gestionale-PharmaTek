import { describe, expect, it } from "vitest";
import type { Spedizione, RecordDto } from "../../lib/tauri";
import type { DestinatarioComunicazioneSpedizione } from "../../lib/tauriTypes";
import {
  preparaAvvisiSpedizione,
  numeroComunicazioniSpedizione,
} from "./comunicazioniSpedizione";
import {
  indirizzoConsegnaDaRecord,
  variabiliAnagraficaDestinatario,
} from "../comunicazioni/apriComunicazione";
import { aggiornaTargetDaRecord } from "../comunicazioni/CampagnaComunicazioni";
import { risolviModello, aggiornaTestoModelloNonModificato } from "../comunicazioni/modelliComunicazione";

function persona(
  id: string,
  importo: number,
): DestinatarioComunicazioneSpedizione {
  return {
    clienteId: id,
    clienteNome: id,
    email: "demo@example.invalid",
    telefono: "3331234567",
    avvisato: false,
    fingerprint: `fp-${id}`,
    ordini: [
      {
        ordineId: `ordine-${id}`,
        ordineNumero: `2026-${id}`,
        medicoNome: "",
        agenteNome: "",
        pagamenti: [
          {
            id: `pagamento-${id}`,
            tipo: "rata",
            importo,
            saldato: false,
            contoId: "banca",
            contoNome: "Banca",
            contoTipo: "banca",
            scadenza: "2026-10-10",
          },
        ],
      },
    ],
  };
}
function collo(
  destinatari: DestinatarioComunicazioneSpedizione[],
  id = "collo-1",
): Spedizione {
  return {
    id,
    data: "2026-10-03",
    corriereNome: "CORRIERE_B",
    clienteId: destinatari[0].clienteId,
    righe: destinatari.flatMap((d) =>
      d.ordini.map((o) => ({
        ordineId: o.ordineId,
        ordineNumero: o.ordineNumero,
        numero: `tracking-${d.clienteId}`,
      })),
    ),
    destinatariComunicazione: destinatari,
  } as Spedizione;
}
const conti = [
  {
    id: "banca",
    data: { tipo: "banca", iban: "IT00TEST", nome: "Banca" },
    deleted: false,
    revision: "r1",
  },
] as RecordDto[];

describe("avvisi delle spedizioni unite", () => {
  it("separa le anagrafiche anche con recapiti identici e non espone dati dell'altra persona", () => {
    const targets = preparaAvvisiSpedizione(
      [collo([persona("Mario", 10000), persona("Anna", 20000)])],
      conti,
    );
    expect(targets).toHaveLength(2);
    for (const target of targets) {
      const mario = target.destinatarioId === "Mario";
      expect(JSON.stringify(target)).not.toContain(mario ? "Anna" : "Mario");
      expect(target.variabili?.importo_residuo).toContain(
        mario ? "100,00" : "200,00",
      );
      expect(target.variabili?.riferimento_ordine).toBe(
        `2026-${target.destinatarioId}`,
      );
      expect(target.variabili?.istruzioni_pagamento).not.toContain("Ordine ");
      expect(target.variabili?.istruzioni_pagamento).not.toContain(`2026-${target.destinatarioId}`);
      expect(target.variabili?.istruzioni_pagamento).toContain("IBAN: IT00TEST");
    }
  });
  it("mantiene un messaggio per persona con più prodotti, ordini e colli", () => {
    const mario = persona("Mario", 10000);
    const altro = persona("altro-ordine", 5000).ordini[0];
    mario.ordini.push(altro);
    const primo = collo([mario]);
    primo.righe.push({ ...primo.righe[0], numero: "secondo-prodotto" });
    const secondo = collo([persona("Mario", 2000)], "collo-2");
    const targets = preparaAvvisiSpedizione([primo, secondo, primo], conti);
    expect(targets).toHaveLength(1);
    expect(targets[0].originiCorrelate).toEqual([
      { id: "collo-2", fingerprint: "fp-Mario" },
    ]);
    expect(targets[0].variabili?.istruzioni_pagamento).not.toContain("Ordine ");
    expect(targets[0].variabili?.istruzioni_pagamento).toContain("120,00");
    expect(targets[0].variabili?.istruzioni_pagamento).toContain("50,00");
    expect(targets[0].variabili?.riferimento_ordine).toBe("2026-altro-ordine, 2026-Mario");
    expect(targets[0].variabili?.importo_residuo).toContain("170,00");
  });
  it("riprende i soli invii mancanti e mantiene visibile chi non ha recapiti", () => {
    const mario = persona("Mario", 10000);
    mario.avvisato = true;
    const anna = persona("Anna", 20000);
    anna.email = "";
    anna.telefono = "";
    const spedizione = collo([mario, anna]);
    expect(numeroComunicazioniSpedizione([spedizione])).toBe(1);
    expect(
      preparaAvvisiSpedizione([spedizione], conti).map((t) => t.destinatarioId),
    ).toEqual(["Anna"]);
    anna.avvisato = true;
    expect(preparaAvvisiSpedizione([spedizione], conti)).toEqual([]);
  });
  it("numera le rate per ordine ed esclude dal residuo quelle saldate", () => {
    const mario = persona("Mario", 10000);
    mario.ordini[0].pagamenti[0].saldato = true;
    mario.ordini[0].pagamenti.push({
      ...mario.ordini[0].pagamenti[0],
      id: "rata-2",
      saldato: false,
      importo: 5000,
      scadenza: "2026-11-10",
    });
    const altro = persona("secondo", 7000).ordini[0];
    mario.ordini.push(altro);
    const target = preparaAvvisiSpedizione([collo([mario])], conti)[0];
    expect(target.variabili?.importo_residuo).toContain("120,00");
    expect(target.variabili?.istruzioni_pagamento).toContain("Rata 2: € 50,00");
    expect(target.variabili?.istruzioni_pagamento).not.toContain("100,00");
    expect(target.variabili?.istruzioni_pagamento).toContain("70,00");
    expect(target.variabili?.istruzioni_pagamento).not.toContain("Ordine ");
    expect(target.variabili?.istruzioni_pagamento).toContain("10/11/2026");
  });
  it("non introduce riferimenti automatici quando il residuo è nullo", () => {
    const mario = persona("Mario", 10000);
    mario.ordini[0].pagamenti[0].saldato = true;
    const target = preparaAvvisiSpedizione([collo([mario])], conti)[0];
    expect(target.variabili?.importo_residuo).toBe("nessun importo da saldare");
    expect(target.variabili?.istruzioni_pagamento).toBe("Nessun pagamento richiesto alla consegna.");
  });
  it("consente la riapertura esplicita dal dettaglio completo senza reinviare ai già avvisati nel recupero dei mancanti", () => {
    const mario = persona("Mario", 10000);
    mario.avvisato = true;
    const anna = persona("Anna", 20000);
    const spedizione = collo([mario, anna]);
    const opzioni = { riapriSeCompleto: true };
    expect(preparaAvvisiSpedizione([spedizione], conti, opzioni).map(t => t.destinatarioId)).toEqual(["Anna"]);
    anna.avvisato = true;
    expect(preparaAvvisiSpedizione([spedizione], conti)).toEqual([]);
    expect(preparaAvvisiSpedizione([spedizione], conti, opzioni).map(t => t.destinatarioId)).toEqual(["Mario", "Anna"]);
    expect(numeroComunicazioniSpedizione([spedizione])).toBe(0);
    expect(preparaAvvisiSpedizione([collo([mario])], conti, opzioni)).toHaveLength(1);
  });
});

describe("indirizzo di consegna nei modelli", () => {
  it("aggiorna il testo del modello nel compositore conservando le modifiche manuali", () => {
    const prima = { indirizzo_consegna: "Via Roma 10" };
    const dopo = { indirizzo_consegna: "Via nuova 2" };
    expect(aggiornaTestoModelloNonModificato("Consegna: Via Roma 10", "Consegna: {{indirizzo_consegna}}", prima, dopo)).toBe("Consegna: Via nuova 2");
    expect(aggiornaTestoModelloNonModificato("Testo personalizzato", "Consegna: {{indirizzo_consegna}}", prima, dopo)).toBe("Testo personalizzato");
  });
  const cliente: RecordDto = {
    id: "cliente",
    revision: "r1",
    deleted: false,
    data: {
      nome: "Mario",
      indirizzo: " Via Roma 10 ",
      cap: "00100",
      citta: "Roma",
      prov: "RM",
      regione: "Lazio",
      fatturazione_indirizzo: "Via diversa",
      fatturazione_nome: "Altro",
    },
  };
  it("formatta soltanto via, CAP, città e provincia, anche con campi mancanti", () => {
    expect(indirizzoConsegnaDaRecord(cliente)).toBe(
      "Via Roma 10, 00100 Roma (RM)",
    );
    expect(
      indirizzoConsegnaDaRecord({ ...cliente, data: { citta: "Roma" } }),
    ).toBe("Roma");
    expect(
      indirizzoConsegnaDaRecord({
        ...cliente,
        data: { fatturazione_indirizzo: "Via diversa" },
      }),
    ).toBe("");
    expect(
      risolviModello("Consegna: {{indirizzo_consegna}}", {
        indirizzo_consegna: "",
      }),
    ).toEqual({ testo: "Consegna: ", mancanti: [] });
  });
  it("compare soltanto quando inserito nel modello e si aggiorna nella campagna", () => {
    const variabili = variabiliAnagraficaDestinatario(cliente, "Mario");
    expect(risolviModello("Gentile {{nome_cliente}}", variabili).testo).toBe(
      "Gentile Mario",
    );
    expect(
      risolviModello("Consegna: {{indirizzo_consegna}}", variabili).testo,
    ).toBe("Consegna: Via Roma 10, 00100 Roma (RM)");
    const target = aggiornaTargetDaRecord(
      {
        destinatarioEntita: "cliente",
        destinatarioId: "cliente",
        destinatarioNome: "Mario",
        variabili,
      },
      { ...cliente, data: { ...cliente.data, indirizzo: "Via nuova 2" } },
    );
    expect(target.variabili?.indirizzo_consegna).toBe(
      "Via nuova 2, 00100 Roma (RM)",
    );
    expect(target.variabili?.indirizzo_consegna).not.toContain("Altro");
  });
});
