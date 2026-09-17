import { describe, expect, it } from "vitest";
import {
  dataEntroAnnoDiLavoro,
  dataNellAnno,
  dataNellAnnoEIntervallo,
  ordineDaSpedireNelContesto,
} from "./annoLavoro";

describe("anno di lavoro", () => {
  it("distingue le viste storiche dalle code con arretrati", () => {
    expect(dataNellAnno("2024-12-31", 2025)).toBe(false);
    expect(dataEntroAnnoDiLavoro("2024-12-31", 2025)).toBe(true);
    expect(dataEntroAnnoDiLavoro("2026-01-01", 2025)).toBe(false);
    expect(dataEntroAnnoDiLavoro("2026-01-01", 0)).toBe(true);
  });

  it("esclude i Nuovo arretrati dalla coda da spedire", () => {
    expect(ordineDaSpedireNelContesto({ data: "2024-05-01", stato: "Nuovo" }, 2025)).toBe(false);
    expect(ordineDaSpedireNelContesto({ data: "2024-05-01", stato: "Confermato" }, 2025)).toBe(true);
    expect(ordineDaSpedireNelContesto({ data: "2026-05-01", stato: "Confermato" }, 2025)).toBe(false);
    expect(ordineDaSpedireNelContesto({ data: "2024-05-01", stato: "Nuovo" }, 0)).toBe(true);
  });

  it("interseca anno storico e intervallo locale", () => {
    expect(dataNellAnnoEIntervallo("2024-06-10", 2025, "2024-01-01", "2024-12-31")).toBe(false);
    expect(dataNellAnnoEIntervallo("2024-06-10", 0, "2024-01-01", "2024-12-31")).toBe(true);
    expect(dataNellAnnoEIntervallo("2025-06-10", 2025, "2025-07-01", "")).toBe(false);
  });
});
