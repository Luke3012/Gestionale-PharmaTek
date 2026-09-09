import { describe, expect, it } from "vitest";
import { validaCodiceFiscale } from "../../lib/codice-fiscale";
import type { RecordDto } from "../../lib/tauri";
import {
  clienteDaMigrareArubaLegacy,
  clienteGiaEsportatoAruba,
  filtraClientiAruba,
  generaCodiceFiscaleProvvisorio,
  preparaRigheAruba,
  splitIndirizzoCivico,
  telefonoPreferitoAruba,
} from "./exportAruba";

function cliente(id: string, data: Record<string, unknown>): RecordDto {
  return { id, revision: "test", data, deleted: false };
}

describe("esportazione Aruba", () => {
  it("conserva il codice fiscale reale", () => {
    const result = preparaRigheAruba([cliente("01REAL", { nome: "Mario Rossi", cf: "RSSMRA80A01H501U" })]);
    expect(result.righe[0].cf).toBe("RSSMRA80A01H501U");
    expect(result.righe[0].cognome).toBe("Rossi");
    expect(result.codiciProvvisoriGenerati).toBe(0);
  });

  it("include automaticamente chi non ha il CF con un valore stabile e valido", () => {
    const first = generaCodiceFiscaleProvvisorio("01FAKE", "Anna Bianchi");
    const second = generaCodiceFiscaleProvvisorio("01FAKE", "Anna Bianchi");
    expect(second).toBe(first);
    expect(validaCodiceFiscale(first).valido).toBe(true);

    const result = preparaRigheAruba([cliente("01FAKE", { nome: "Anna Bianchi" })]);
    expect(result.righe).toHaveLength(1);
    expect(result.righe[0].cognome).toBe("Bianchi (FAKE)");
    expect(result.codiciProvvisoriGenerati).toBe(1);
  });

  it("rispetta entrambe le posizioni dello switch FAKE", () => {
    const conCf = cliente("01REAL", { nome: "Mario Rossi", cf: "RSSMRA80A01H501U" });
    const senzaCf = cliente("01FAKE", { nome: "Anna Bianchi" });
    expect(filtraClientiAruba([conCf, senzaCf], false).map((c) => c.id)).toEqual(["01REAL"]);
    expect(filtraClientiAruba([conCf, senzaCf], true).map((c) => c.id)).toEqual(["01REAL", "01FAKE"]);
  });

  it("la migrazione legacy non riassorbe un cliente ricandidato dal cambio CF", () => {
    const normale = cliente("01OLD", { cf: "RSSMRA80A01H501U" });
    const ricandidato = cliente("01OLD", {
      cf: "RSSMRA80A01H501U",
      aruba_ricandidato_il: "2026-07-17T10:00:00Z",
    });
    const esportato = cliente("01OLD", {
      cf: "RSSMRA80A01H501U",
      aruba_esportato_il: "2026-07-10T10:00:00Z",
    });

    expect(clienteDaMigrareArubaLegacy(normale, "01ZZZ")).toBe(true);
    expect(clienteDaMigrareArubaLegacy(ricandidato, "01ZZZ")).toBe(false);
    expect(clienteDaMigrareArubaLegacy(esportato, "01ZZZ")).toBe(false);
  });

  it("ignora un marcatore export tardivo riferito al vecchio CF", () => {
    const coerente = cliente("01OK", {
      cf: "RSSMRA80A01H501U",
      aruba_esportato_il: "2026-07-17T10:00:00Z",
      aruba_cf_esportato: "rssmra80a01h501u",
    });
    const tardivo = cliente("01LATE", {
      cf: "BNCLGI80A01H501Y",
      aruba_esportato_il: "2026-07-17T10:00:00Z",
      aruba_cf_esportato: "RSSMRA80A01H501U",
    });
    const legacy = cliente("01LEGACY", {
      cf: "RSSMRA80A01H501U",
      aruba_esportato_il: "2026-07-10T10:00:00Z",
    });

    expect(clienteGiaEsportatoAruba(coerente)).toBe(true);
    expect(clienteGiaEsportatoAruba(tardivo)).toBe(false);
    expect(clienteGiaEsportatoAruba(legacy)).toBe(true);
  });

  it("non inventa dati facoltativi e separa il civico quando riconoscibile", () => {
    const result = preparaRigheAruba([
      cliente("01ADDRESS", { nome: "Luca Verdi", indirizzo: "Via Roma, 78" }),
    ]);
    expect(result.righe[0]).toMatchObject({ indirizzo: "Via Roma", civico: "78", email: "", cap: "" });
    expect(splitIndirizzoCivico("Via 15 Dicembre")).toEqual({ via: "Via 15 Dicembre", civico: "" });
  });

  it("esporta soltanto il cellulare quando il campo contiene fisso e mobile", () => {
    const result = preparaRigheAruba([
      cliente("01PHONE", {
        nome: "Mario Rossi",
        cf: "RSSMRA80A01H501U",
        telefono: "072349 - 328188324",
      }),
    ]);

    expect(result.righe[0].telefono).toBe("328188324");
  });

  it.each([
    ["328 188 324", "328 188 324"],
    ["072349 / +39 328 188 324", "+39 328 188 324"],
    ["328188324 - 072349", "328188324"],
    ["3280622586 - 3337336428", "3280622586"],
    ["3331203822 - 069061035", "3331203822"],
    ["0774324311 - 3386355868", "3386355868"],
    ["3311125019 / 3497572442", "3311125019"],
    ["3403732234 - 0035679220977", "3403732234"],
    ["072349 - 061234", "072349"],
    ["055-123", "055-123"],
    ["", ""],
  ])("sceglie un solo recapito Aruba da %j", (telefono, atteso) => {
    expect(telefonoPreferitoAruba(telefono)).toBe(atteso);
  });
});
