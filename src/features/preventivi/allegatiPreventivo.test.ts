import { describe, expect, it } from "vitest";
import {
  formatiPreventivoWhatsapp,
  preventivoRichiedePdfSuWhatsapp,
} from "./allegatiPreventivo";

describe("allegati preventivo", () => {
  it("usa immagine e PDF WhatsApp per un preventivo a pagina singola", () => {
    expect(preventivoRichiedePdfSuWhatsapp({ pagine: [] })).toBe(false);
    expect(formatiPreventivoWhatsapp({ pagine: [] })).toEqual([
      "image/png",
      "application/pdf",
    ]);
  });

  it("usa il solo PDF WhatsApp appena il preventivo ha più pagine", () => {
    expect(preventivoRichiedePdfSuWhatsapp({ pagine: [[]] })).toBe(true);
    expect(preventivoRichiedePdfSuWhatsapp({ pagine: [[], []] })).toBe(true);
    expect(formatiPreventivoWhatsapp({ pagine: [[]] })).toEqual([
      "application/pdf",
    ]);
  });
});
