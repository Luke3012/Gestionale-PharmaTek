import { describe, expect, it, vi } from "vitest";
import {
  aggiungiGiorniIso,
  aggiungiGiorniDaOggiIso,
  aggiungiMesiIso,
  dataIsoLocale,
  estremiMeseIso,
  estremiPeriodoIso,
  formattaDataLocale,
  formattaDataOraBreve,
  formattaDataFileItaliana,
  formattaDataIsoItaliana,
  formattaDataIsoLocale,
  formattaDataItaliana,
  formattaDataSeparataItaliana,
  isoLocale,
  intervalloMeseIso,
  intervalloSettimanaIso,
  oggiIso,
} from "./date";

describe("date locali", () => {
  it("formatta una Date usando il calendario locale", () => {
    expect(isoLocale(new Date(2026, 6, 11, 0, 5))).toBe("2026-07-11");
  });

  it("calcola oggi senza conversioni UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 11, 0, 5));
    expect(oggiIso()).toBe("2026-07-11");
    expect(aggiungiGiorniDaOggiIso("", 1)).toBe("2026-07-12");
    vi.useRealTimers();
  });

  it("interpreta e sposta le date ISO nel calendario locale", () => {
    const data = dataIsoLocale("2026-07-31");
    expect([data.getFullYear(), data.getMonth(), data.getDate(), data.getHours()]).toEqual([
      2026,
      6,
      31,
      12,
    ]);
    expect(aggiungiGiorniIso("2026-07-31", 1)).toBe("2026-08-01");
    expect(aggiungiMesiIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(aggiungiMesiIso("2026-12-15", 1)).toBe("2027-01-15");
  });

  it("calcola gli intervalli settimanali e mensili da una data ISO", () => {
    expect(intervalloSettimanaIso("2026-08-19")).toEqual({
      dal: "2026-08-17",
      al: "2026-08-23",
    });
    expect(intervalloMeseIso("2026-01-15", -1)).toEqual({
      dal: "2025-12-01",
      al: "2025-12-31",
    });
  });

  it("formatta data e ora breve mantenendo il fallback", () => {
    const ms = new Date(2026, 6, 11, 15, 30).getTime();
    expect(formattaDataOraBreve(ms)).toBe(
      new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short" }).format(ms),
    );
    expect(formattaDataOraBreve(0)).toBe("—");
  });

  it("riusa il formato data italiano predefinito", () => {
    const data = new Date(2026, 6, 11, 12);
    expect(formattaDataLocale(data)).toBe(
      new Intl.DateTimeFormat("it-IT").format(data),
    );
  });

  it("formatta solo date ISO complete mantenendo il fallback richiesto", () => {
    expect(formattaDataIsoLocale("2026-07-11")).toBe(
      new Intl.DateTimeFormat("it-IT").format(new Date("2026-07-11T12:00:00")),
    );
    expect(formattaDataIsoLocale("11/07/2026", "da concordare")).toBe("da concordare");
  });

  it("calcola gli estremi mensili anche oltre il cambio d'anno", () => {
    expect(estremiMeseIso(new Date(2026, 0, 15), -1)).toEqual([
      "2025-12-01",
      "2025-12-31",
    ]);
    expect(estremiMeseIso(new Date(2026, 1, 15))).toEqual([
      "2026-02-01",
      "2026-02-28",
    ]);
  });

  it("calcola i periodi mensili condivisi con estremi inclusivi", () => {
    const oggi = new Date(2026, 0, 15);
    expect(estremiPeriodoIso("tutto", "", "", 0, oggi)).toBeNull();
    expect(estremiPeriodoIso("custom", "", "2026-03-04", 0, oggi)).toEqual([
      "0000-01-01",
      "2026-03-04",
    ]);
    expect(estremiPeriodoIso("mese", "", "", 0, oggi)).toEqual([
      "2026-01-01",
      "2026-01-31",
    ]);
    expect(estremiPeriodoIso("scorso", "", "", 0, oggi)).toEqual([
      "2025-12-01",
      "2025-12-31",
    ]);
    expect(estremiPeriodoIso("trimestre", "", "", 0, oggi)).toEqual([
      "2025-11-01",
      "2026-01-31",
    ]);
    expect(estremiPeriodoIso("anno", "", "", 2024, oggi)).toEqual([
      "2024-01-01",
      "2024-12-31",
    ]);
    expect(estremiPeriodoIso("tutto", "", "", 2024, oggi)).toEqual([
      "2024-01-01",
      "2024-12-31",
    ]);
    expect(estremiPeriodoIso("mese", "", "", 2024, oggi)).toEqual([
      "2024-01-01",
      "2024-01-31",
    ]);
    expect(estremiPeriodoIso("custom", "2023-06-01", "2025-02-01", 2024, oggi)).toEqual([
      "2024-01-01",
      "2024-12-31",
    ]);
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

  it("mantiene i fallback storici della formattazione ISO compatta", () => {
    expect(formattaDataIsoItaliana("2026-07-11")).toBe("11/07/2026");
    expect(formattaDataIsoItaliana("")).toBe("");
    expect(formattaDataIsoItaliana("", "—")).toBe("—");
  });

  it("formatta i segmenti data preservando valori liberi e fallback", () => {
    expect(formattaDataSeparataItaliana("2026-07-11")).toBe("11/07/2026");
    expect(formattaDataSeparataItaliana("2026-7-1")).toBe("1/7/2026");
    expect(formattaDataSeparataItaliana("data libera")).toBe("data libera");
    expect(formattaDataSeparataItaliana("")).toBe("—");
  });
});
