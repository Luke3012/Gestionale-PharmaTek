import { describe, expect, it } from "vitest";
import type { OrdineDaSpedire } from "../../lib/tauri";
import { applicaBozzeNumeriVaccino, conservaBozzeNumeriVaccino } from "./bozzeNumeriVaccino";

const ordini = (numero: string, ids = ["r1", "r2"]) => [{
  ordineId: "o1", righe: ids.map((rigaId) => ({ rigaId, numero })),
}] as OrdineDaSpedire[];

describe("bozze numeri vaccino", () => {
  it.each(["nuovo", "", "primo\nsecondo"])("usa il numero salvato altrove %j anche se esiste una bozza", (numero) => {
    const bozze = new Map([["r1", "bozza locale"]]);
    const fresh = ordini(numero);
    const rimaste = conservaBozzeNumeriVaccino(bozze, fresh, ordini("precedente"));
    expect(rimaste.has("r1")).toBe(false);
    expect(applicaBozzeNumeriVaccino(fresh, rimaste)[0].righe[0].numero).toBe(numero);
  });
  it("conserva svuotamenti e bozze se il numero salvato non cambia", () => {
    const bozze = new Map([["r1", ""], ["r2", "digitato durante la richiesta"]]);
    const prima = ordini("salvato");
    const fresh = ordini("salvato");
    fresh[0].medicoNome = "Medico aggiornato";
    expect(conservaBozzeNumeriVaccino(bozze, fresh, prima)).toBe(bozze);
    expect(applicaBozzeNumeriVaccino(fresh, bozze)[0].righe.map(r => r.numero))
      .toEqual(["", "digitato durante la richiesta"]);
  });
  it("preserva la bozza al refresh e aggiorna le righe non modificate", () => {
    const backend = ordini("remoto");
    const bozze = new Map([["r1", "locale"]]);
    const risultato = applicaBozzeNumeriVaccino(backend, conservaBozzeNumeriVaccino(bozze, backend));
    expect(risultato[0].righe.map((r) => r.numero)).toEqual(["locale", "remoto"]);
    expect(backend[0].righe[0].numero).toBe("remoto");
  });
  it.each(["", "primo\nsecondo"])("conserva la modifica esplicita %j", (numero) => {
    expect(applicaBozzeNumeriVaccino(ordini("salvato"), new Map([["r1", numero]]))[0].righe[0].numero).toBe(numero);
  });
  it("usa la modifica più recente anche se il refresh era già iniziato", async () => {
    const richiesta = Promise.resolve(ordini("vecchio"));
    const bozze = new Map([["r1", "digitato durante il caricamento"]]);
    const fresh = await richiesta;
    expect(applicaBozzeNumeriVaccino(fresh, conservaBozzeNumeriVaccino(bozze, fresh))[0].righe[0].numero)
      .toBe("digitato durante il caricamento");
  });
  it("scarta solo le righe uscite dalla coda e non ripristina vecchie bozze se tornano", () => {
    const bozze = new Map([["r1", "uno"], ["r2", "due"]]);
    const rimaste = conservaBozzeNumeriVaccino(bozze, ordini("remoto", ["r2"]));
    expect([...rimaste]).toEqual([["r2", "due"]]);
    expect(applicaBozzeNumeriVaccino(ordini("remoto"), rimaste)[0].righe[0].numero).toBe("remoto");
    expect(conservaBozzeNumeriVaccino(rimaste, [])).toEqual(new Map());
  });
  it("riusa le bozze e i dati quando non occorre riconciliarli", () => {
    const bozze = new Map([["r1", "uno"]]);
    const backend = ordini("remoto");
    expect(conservaBozzeNumeriVaccino(bozze, backend)).toBe(bozze);
    expect(applicaBozzeNumeriVaccino(backend, new Map())).toBe(backend);
  });
});
