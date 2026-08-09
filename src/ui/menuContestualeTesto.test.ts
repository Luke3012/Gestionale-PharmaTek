import { describe, expect, it } from "vitest";
import {
  attributiIndicanoCombobox,
  inputSupportaMenuTestuale,
  limitaMenuAlViewport,
} from "./menuContestualeTestoUtils";

describe("menu contestuale dei campi testuali", () => {
  it.each(["text", "search", "email", "tel", "url", "password", "TEXT"])(
    "accetta il tipo %s",
    (tipo) => expect(inputSupportaMenuTestuale(tipo)).toBe(true)
  );

  it.each(["number", "date", "checkbox", "radio", "file", "color", "hidden"])(
    "esclude il tipo %s",
    (tipo) => expect(inputSupportaMenuTestuale(tipo)).toBe(false)
  );

  it.each(["numeric", "decimal"])("esclude l'inputMode %s usato dai campi numerici", (inputMode) => {
    expect(inputSupportaMenuTestuale("text", inputMode)).toBe(false);
  });

  it.each([
    { role: "combobox" },
    { role: "COMBOBOX" },
    { ariaHasPopup: "listbox" },
    { ariaAutocomplete: "list" },
    { ariaAutocomplete: "both" },
    { haLista: true },
  ])("riconosce i campi gestiti da combobox: %o", (attributi) => {
    expect(attributiIndicanoCombobox(attributi)).toBe(true);
  });

  it("non scambia un normale campo testuale per una combobox", () => {
    expect(attributiIndicanoCombobox({ role: null, ariaHasPopup: null })).toBe(false);
  });

  it("mantiene il menu dentro tutti i bordi del viewport", () => {
    expect(
      limitaMenuAlViewport({ x: 790, y: 590 }, { width: 160, height: 90 }, { width: 800, height: 600 })
    ).toEqual({ left: 632, top: 502 });
    expect(
      limitaMenuAlViewport({ x: -20, y: -10 }, { width: 160, height: 90 }, { width: 800, height: 600 })
    ).toEqual({ left: 8, top: 8 });
  });
});
