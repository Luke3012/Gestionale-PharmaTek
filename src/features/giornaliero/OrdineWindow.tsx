// Pagina renderizzata nella finestra Ordine separata (vedi main.tsx).
import { useCallback, useEffect, useState } from "react";
import { Badge, Box, Group, Text } from "@mantine/core";
import { api, type Identity } from "../../lib/tauri";
import { OrdineForm } from "./OrdineEditor";
import { CATEGORIA_DEFAULT, SelettoreCategoriaNuovoOrdine } from "./categoriaOrdine";
import { coloreLinea } from "./colonne";
import { useRicordaGeometria } from "../../lib/geometriaFinestre";

export function OrdineWindow() {
  const params = new URLSearchParams(window.location.search);
  const ordineParam = params.get("ordine");
  const numero = params.get("numero") ?? undefined;
  const categoria = params.get("categoria") ?? undefined;
  const clientePre = params.get("precli") ?? undefined;
  const medicoPre = params.get("premed") ?? undefined;
  const focus = params.get("focus");
  const pagamentoFocusId = params.get("pagamento") ?? undefined;
  const ordineId = ordineParam === "new" ? null : ordineParam;
  // Categoria nel titolo: nota subito per i nuovi ordini, riportata dal form in modifica.
  const [catTitolo, setCatTitolo] = useState(
    ordineId === null ? categoria || CATEGORIA_DEFAULT : categoria
  );
  const [dirty, setDirty] = useState(false);

  // Identità passata via URL dalla finestra principale (apertura più rapida);
  // fallback a `whoami` se mancante.
  const uid = params.get("uid");
  const [identity, setIdentity] = useState<Identity | null>(
    uid
      ? {
          userId: uid,
          nome: params.get("nome") ?? "",
          deviceId: params.get("dev") ?? "",
          avatarTipo: "iniziali",
          avatarValore: "",
          deviceNome: "",
          dataDir: "",
        }
      : null
  );

  useEffect(() => {
    if (!identity) api.whoami().then(setIdentity).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ricorda dimensione e posizione: l'ultima impostata vale per le prossime finestre.
  useRicordaGeometria("ordine");

  const chiudi = useCallback(async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  }, []);

  const richiediChiusura = useCallback(() => {
    void chiudi();
  }, [chiudi]);

  async function salvato() {
    await chiudi();
  }

  if (!identity) return <Box style={{ flex: 1, height: "100vh", background: "var(--bg)" }} />;

  return (
    <Box p="lg" style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>
      <Box
        mb="md"
        style={{
          flex: "0 0 auto",
          display: "grid",
          gridTemplateColumns: "minmax(180px, 1fr) auto",
          alignItems: "center",
          columnGap: 16,
        }}
      >
        <Text fw={800} fz="xl" style={{ whiteSpace: "nowrap" }}>
          {ordineId ? `Ordine ${numero ?? ""}` : "Nuovo ordine"}
        </Text>
        <Group justify="flex-end">
          {!ordineId && (
            <SelettoreCategoriaNuovoOrdine
              value={catTitolo || CATEGORIA_DEFAULT}
              onChange={setCatTitolo}
              haContenuto={dirty}
            />
          )}
          {ordineId && catTitolo && (
            <Badge color={coloreLinea(catTitolo)} variant="light" size="lg">
              {catTitolo}
            </Badge>
          )}
        </Group>
      </Box>
      <Box className="pt-window-form">
        <OrdineForm
          ordineId={ordineId}
          numero={numero}
          categoria={ordineId ? categoria : catTitolo}
          clientePre={clientePre}
          medicoPre={medicoPre}
          identity={identity}
          focus={
            focus === "pagamenti"
              ? { sezione: "pagamenti", pagamentoId: pagamentoFocusId }
              : focus === "prodotti"
                ? { sezione: "prodotti" }
                : undefined
          }
          onClose={richiediChiusura}
          onSaved={salvato}
          onCategoria={setCatTitolo}
          onDirtyChange={setDirty}
          dentroFinestra={true}
        />
      </Box>
    </Box>
  );
}
