import { describe, expect, it } from "vitest";
import {
  cercaCAPDigitato,
  cercaCittaSelezionata,
  nomiCittaSuggeriti,
} from "./cap-lookup";

describe("helper condivisi CAP e città", () => {
  it("distingue input incompleto, CAP ignoto, univoco e ambiguo", () => {
    expect(cercaCAPDigitato("0001")).toBeUndefined();
    expect(cercaCAPDigitato("99999")).toBeNull();
    expect(cercaCAPDigitato("00012")?.univoco).toBe(true);
    expect(cercaCAPDigitato("00010")?.univoco).toBe(false);
  });

  it("produce le etichette e risolve la selezione con la ricerca storica", () => {
    expect(nomiCittaSuggeriti("Guidonia", 10)).toContain("Guidonia Montecelio");
    expect(cercaCittaSelezionata("Guidonia Montecelio")?.sigla).toBe("RM");
  });
});
