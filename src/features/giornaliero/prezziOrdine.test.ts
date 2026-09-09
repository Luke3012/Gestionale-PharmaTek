import { describe, expect, it } from "vitest";
import { nuovaRiga, type RigaForm } from "./righeOrdine";
import { applicaPrezzoAutomaticoRiga } from "./prezziOrdine";

function riga(prezzo: RigaForm["prezzo"]): RigaForm {
  return { ...nuovaRiga(), prezzo };
}

describe("prezzi automatici ordine", () => {
  it("riempie un prezzo vuoto senza sovrascriverne uno manuale", () => {
    const manuale = riga(12);
    expect(applicaPrezzoAutomaticoRiga(riga(""), 2500).prezzo).toBe(25);
    expect(applicaPrezzoAutomaticoRiga(manuale, 2500)).toBe(manuale);
  });

  it("aggiorna un prezzo ancora automatico e rispetta le opzioni esplicite", () => {
    const automatica = riga(12);
    expect(applicaPrezzoAutomaticoRiga(automatica, 1500, { prezzoPrecedente: 1200 }).prezzo).toBe(15);
    expect(applicaPrezzoAutomaticoRiga(automatica, 1500, { sovrascrivi: true }).prezzo).toBe(15);
    expect(applicaPrezzoAutomaticoRiga(automatica, 1500, { sovrascrivi: true, soloSeVuoto: true })).toBe(automatica);
  });

  it("conserva il trattamento storico dei valori non numerici nei due flussi", () => {
    const nonNumerica = riga(Number.NaN);
    expect(applicaPrezzoAutomaticoRiga(nonNumerica, 1500).prezzo).toBe(15);
    expect(applicaPrezzoAutomaticoRiga(nonNumerica, 1500, { prezzoPrecedente: null })).toBe(nonNumerica);
  });
});
