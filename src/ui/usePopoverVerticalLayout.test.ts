import { describe, expect, it } from "vitest";
import { calcolaPopoverVerticalLayout } from "./usePopoverVerticalLayout";

describe("layout verticale dei popover", () => {
  it("preferisce il basso quando ha spazio sufficiente", () => {
    expect(calcolaPopoverVerticalLayout({ top: 100, bottom: 140 }, 800)).toEqual({
      position: "bottom-end",
      maxHeight: "520px",
    });
  });

  it("usa lo spazio superiore quando è maggiore", () => {
    expect(calcolaPopoverVerticalLayout({ top: 650, bottom: 690 }, 720)).toEqual({
      position: "top-end",
      maxHeight: "520px",
    });
  });

  it("mantiene l'altezza minima storica negli spazi stretti", () => {
    expect(calcolaPopoverVerticalLayout({ top: 100, bottom: 140 }, 260)).toEqual({
      position: "bottom-end",
      maxHeight: "180px",
    });
  });
});
