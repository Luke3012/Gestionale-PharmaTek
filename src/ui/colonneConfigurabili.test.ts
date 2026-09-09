import { describe, expect, it } from "vitest";
import {
  caricaStatoColonne,
  colonneTabellaConfigurabili,
  normalizzaStatoColonne,
  statoColonnePredefinito,
} from "./colonneConfigurabili";

const DEFINIZIONI = [
  { key: "a", defaultVisible: true },
  { key: "b", defaultVisible: false },
  { key: "c", defaultVisible: true },
] as const;

describe("stato delle colonne configurabili", () => {
  it("costruisce il default rispettando le colonne prioritarie", () => {
    expect(statoColonnePredefinito(DEFINIZIONI, ["c"])).toEqual({
      ordine: ["c", "a", "b"],
      nascoste: ["b"],
    });
  });

  it("rimuove chiavi obsolete e accoda le nuove", () => {
    expect(
      normalizzaStatoColonne(
        DEFINIZIONI,
        { ordine: ["a", "obsoleta"], nascoste: ["obsoleta"] },
        { nascondiNuoveOpzionali: true },
      ),
    ).toEqual({ ordine: ["a", "b", "c"], nascoste: ["b"] });
  });

  it("può lasciare visibili le nuove colonne opzionali", () => {
    expect(
      normalizzaStatoColonne(DEFINIZIONI, { ordine: ["a"], nascoste: [] }),
    ).toEqual({ ordine: ["a", "b", "c"], nascoste: [] });
  });

  it("legge la prima chiave disponibile e tollera JSON corrotto", () => {
    const normalizza = (salvato?: { ordine?: readonly string[]; nascoste?: readonly string[] }) =>
      normalizzaStatoColonne(DEFINIZIONI, salvato);
    const valori = new Map([
      ["precedente", JSON.stringify({ ordine: ["c", "a"], nascoste: ["b"] })],
    ]);
    const storage = { getItem: (chiave: string) => valori.get(chiave) ?? null };

    expect(caricaStatoColonne(storage, ["corrente", "precedente"], normalizza)).toEqual({
      ordine: ["c", "a", "b"],
      nascoste: ["b"],
    });
    valori.set("corrente", "{non-json");
    expect(caricaStatoColonne(storage, ["corrente", "precedente"], normalizza)).toEqual(
      statoColonnePredefinito(DEFINIZIONI),
    );
  });

  it("traduce le definizioni nel contratto tabella conservando la presenza della larghezza", () => {
    const definizioni = [{
      key: "nome",
      label: "Nome",
      defaultVisible: true,
      align: "center" as const,
      width: 120,
      sortAccessor: (record: { nome: string }) => record.nome,
      render: (record: { nome: string }) => record.nome,
    }];

    const senzaLarghezza = colonneTabellaConfigurabili(definizioni);
    const conLarghezza = colonneTabellaConfigurabili(definizioni, {
      includiLarghezza: true,
      render: (_colonna, record) => record.nome.toUpperCase(),
    });

    expect(senzaLarghezza[0]).toMatchObject({
      accessor: "nome",
      title: "Nome",
      textAlign: "center",
      sortable: true,
      resizable: true,
    });
    expect(senzaLarghezza[0]).not.toHaveProperty("width");
    expect(conLarghezza[0]).toHaveProperty("width", 120);
    expect(conLarghezza[0].render?.({ nome: "anna" }, 0)).toBe("ANNA");
  });
});
