import { describe, expect, it } from "vitest";
import { identityDaParametri } from "./identityParams";

describe("identità da parametri", () => {
  it("non crea un'identità senza utente", () => {
    expect(identityDaParametri(new URLSearchParams("nome=Luca"))).toBeUndefined();
  });

  it("mantiene i fallback delle finestre secondarie", () => {
    expect(identityDaParametri(new URLSearchParams("uid=u1&nome=Luca&dev=pc1"))).toEqual({
      userId: "u1",
      nome: "Luca",
      deviceId: "pc1",
      avatarTipo: "iniziali",
      avatarValore: "",
      deviceNome: "",
      dataDir: "",
    });
  });
});
