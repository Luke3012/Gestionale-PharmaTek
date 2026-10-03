import { describe, expect, it } from "vitest";
import { corrispondeRicercaTesto, preparaRicercaTesto, filtroOpzioniRicerca } from "./ricercaTesto";

describe("ricerca per parole indipendenti dall'ordine", () => {
  it("mantiene i gruppi delle anagrafiche e limita dopo aver cercato", () => {
    const options = [{ group: "Clienti", items: [{ value: "anna", label: "Anna Tartaglia" }, { value: "luca", label: "Luca Tartaglia" }] }, { group: "Medici", items: [{ value: "dottore", label: "Luca Tartaglia" }] }];
    expect(filtroOpzioniRicerca({ options, search: "Tartaglia Luca", limit: 1 })).toEqual([{ group: "Clienti", items: [{ value: "luca", label: "Luca Tartaglia" }] }]);
    expect(filtroOpzioniRicerca({ options, search: "Tartaglia Luca", limit: 20 })).toHaveLength(2);
    expect(filtroOpzioniRicerca({ options, search: "sconosciuto", limit: 20 })).toEqual([]);
  });
  it.each(["Luca Tartaglia", "Tartaglia Luca", "  TARTAGLIA   luca ", "Tartag Luc"])("trova %s", (query) => {
    expect(corrispondeRicercaTesto("ORD-22 Luca Tartaglia CORRIERE_B 03/10/2026", query)).toBe(true);
  });
  it("richiede tutti i termini senza mescolare record di persone diverse", () => {
    const cerca = preparaRicercaTesto("Tartaglia Luca");
    expect(["Anna Tartaglia", "Luca Bianchi", "Luca Tartaglia"].filter(cerca)).toEqual(["Luca Tartaglia"]);
  });
  it("conserva numeri, date, email e termini distribuiti tra campi", () => {
    const blob = "2026-22 Luca Tartaglia CORRIERE_B 03/10/2026 demo@example.invalid";
    expect(corrispondeRicercaTesto(blob, "03/10/2026 tartaglia 2026-22")).toBe(true);
    expect(corrispondeRicercaTesto(blob, "demo@example.invalid")).toBe(true);
    expect(corrispondeRicercaTesto(blob, "2026-23")).toBe(false);
  });
  it("normalizza gli accenti e ammette la ricerca vuota", () => {
    expect(corrispondeRicercaTesto("Oriétta Mènegon", "menegon orietta")).toBe(true);
    expect(corrispondeRicercaTesto("qualsiasi", " \t ")).toBe(true);
  });
});
