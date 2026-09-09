import { describe, expect, it } from "vitest";
import { titoloProgressoAggiornamento } from "./aggiornamentoUi";

describe("UI aggiornamento", () => {
  it("mantiene il titolo previsto per ogni fase", () => {
    expect(titoloProgressoAggiornamento("preparo")).toBe("Aggiornamento in corso");
    expect(titoloProgressoAggiornamento("scarico")).toBe("Scarico l'aggiornamento");
    expect(titoloProgressoAggiornamento("installo")).toBe("Installo l'aggiornamento");
    expect(titoloProgressoAggiornamento("riavvio")).toBe("Riavvio in corso");
  });
});
