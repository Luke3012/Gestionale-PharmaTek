import type { Identity } from "./tauri";

/** Ricostruisce l'identità minima trasmessa alle finestre secondarie via query string. */
export function identityDaParametri(params: URLSearchParams): Identity | undefined {
  const userId = params.get("uid");
  if (!userId) return undefined;
  return {
    userId,
    nome: params.get("nome") ?? "",
    deviceId: params.get("dev") ?? "",
    avatarTipo: "iniziali",
    avatarValore: "",
    deviceNome: "",
    dataDir: "",
  };
}
