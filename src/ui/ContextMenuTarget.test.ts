import { describe, expect, it, vi } from "vitest";
import { puntoDaEventoContextMenu } from "./ContextMenuTarget";

describe("puntoDaEventoContextMenu", () => {
  it("blocca il menu nativo e conserva le coordinate del clic", () => {
    const preventDefault = vi.fn();

    expect(puntoDaEventoContextMenu({ clientX: 17, clientY: 29, preventDefault })).toEqual({
      x: 17,
      y: 29,
    });
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
