import { describe, expect, it, vi } from "vitest";
import { formattaDataFileItaliana, formattaDataItaliana, isoLocale, oggiIso } from "./date";

describe("date locali", () => {
  it("formatta una Date usando il calendario locale", () => {
    expect(isoLocale(new Date(2026, 6, 11, 0, 5))).toBe("2026-07-11");
  });

  it("calcola oggi senza conversioni UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 11, 0, 5));
    expect(oggiIso()).toBe("2026-07-11");
    vi.useRealTimers();
  });

  it("mantiene fallback e valori non ISO nella formattazione italiana", () => {
    expect(formattaDataItaliana("2026-07-11")).toBe("11/07/2026");
    expect(formattaDataItaliana("")).toBe("—");
    expect(formattaDataItaliana("data libera")).toBe("data libera");
  });

  it("usa giorno-mese-anno nei nomi file", () => {
    expect(formattaDataFileItaliana("2026-07-11")).toBe("11-07-2026");
    expect(formattaDataFileItaliana("")).toBe("");
    expect(formattaDataFileItaliana("data libera")).toBe("data libera");
  });
});
