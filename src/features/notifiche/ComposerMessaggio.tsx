// Composer di un messaggio tra PC (FASE 6E) — "il giochino". Riusato in tre punti:
//  • nel pop-over campanella (nuovo messaggio, con scelta destinatario);
//  • come risposta inline a un messaggio ricevuto (destinatario bloccato sul mittente);
//  • dentro la card del pop-up custom (overlay).
// Nessuna cronologia: invia e basta. Il backend invalida campanelle e overlay aperti;
// read-state e derivazione fanno il resto.
import { useEffect, useRef, useState } from "react";
import { Button, Group, NativeSelect, Stack, Textarea } from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
import { api, inTauri, type Identity, type UserDto } from "../../lib/tauri";
import { toast } from "../../ui/toast/store";
import { DEST_TUTTI, inviaMessaggio, listaDestinatariMessaggi } from "./messaggi";

export interface RispostaA {
  mittenteId: string;
  mittenteNome: string;
  /** Id del messaggio a cui si risponde. */
  parent: string;
}

export function ComposerMessaggio({
  identity,
  rispostaA,
  destinatarioIniziale,
  onInviato,
  onAnnulla,
  autoFocus = true,
}: {
  identity?: Identity;
  /** Se presente: è una risposta, destinatario bloccato sul mittente originale. */
  rispostaA?: RispostaA;
  /** Per un messaggio nuovo già "indirizzato" (es. dal box sincronizzazione). */
  destinatarioIniziale?: string;
  onInviato?: () => void;
  onAnnulla?: () => void;
  autoFocus?: boolean;
}) {
  const [utenti, setUtenti] = useState<UserDto[]>([]);
  const [destinatario, setDestinatario] = useState<string>(
    rispostaA ? rispostaA.mittenteId : destinatarioIniziale ?? DEST_TUTTI
  );
  const [testo, setTesto] = useState("");
  const [inviando, setInviando] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (rispostaA) return; // niente lista utenti per le risposte
    listaDestinatariMessaggi(identity?.userId)
      .then(setUtenti)
      .catch(() => {});
  }, [identity?.userId, rispostaA]);

  useEffect(() => {
    if (autoFocus) requestAnimationFrame(() => areaRef.current?.focus());
  }, [autoFocus]);

  const opzioni = [
    { value: "", label: "A chi?", disabled: true },
    { value: DEST_TUTTI, label: "Tutti" },
    ...utenti.map((u) => ({ value: u.id, label: u.nome })),
  ];

  const valido = testo.trim().length > 0 && (rispostaA != null || destinatario !== "");

  async function invia() {
    if (!valido || inviando) return;
    setInviando(true);
    try {
      const destId = rispostaA ? rispostaA.mittenteId : destinatario;
      const destNome = rispostaA
        ? rispostaA.mittenteNome
        : opzioni.find((o) => o.value === destId)?.label ?? "";
      await inviaMessaggio(
        { destinatario: destId, destinatarioNome: destNome, testo, parent: rispostaA?.parent },
        identity
      );
      if (inTauri) await api.notificheCheck().catch(() => {});
      setTesto("");
      onInviato?.();
    } catch (e) {
      toast.error(`Invio messaggio non riuscito: ${e}`);
    } finally {
      setInviando(false);
    }
  }

  function onKey(e: React.KeyboardEvent) {
    // Invio = manda subito; Shift+Invio = vai a capo.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void invia();
    } else if (e.key === "Escape" && onAnnulla) {
      e.preventDefault();
      onAnnulla();
    }
  }

  return (
    <Stack gap={8}>
      {!rispostaA && (
        // NativeSelect (non Mantine Select): il suo dropdown è nativo del SO, così
        // sceglierne una voce NON conta come «clic fuori» → il pop-over campanella
        // non si chiude (col Select portalato invece si chiudeva).
        <NativeSelect
          data={opzioni}
          value={destinatario}
          onChange={(e) => setDestinatario(e.currentTarget.value)}
          size="xs"
        />
      )}
      <Textarea
        ref={areaRef}
        value={testo}
        onChange={(e) => setTesto(e.currentTarget.value)}
        onKeyDown={onKey}
        placeholder={rispostaA ? `Rispondi a ${rispostaA.mittenteNome}… (Invio per inviare)` : "Scrivi un messaggio… (Invio per inviare)"}
        autosize
        minRows={2}
        maxRows={5}
        size="xs"
      />
      <Group justify="flex-end" gap={6}>
        {onAnnulla && (
          <Button variant="subtle" color="gray" size="compact-xs" onClick={onAnnulla}>
            Annulla
          </Button>
        )}
        <Button
          size="compact-xs"
          leftSection={<IconSend size={14} />}
          onClick={() => void invia()}
          loading={inviando}
          disabled={!valido}
        >
          Invia
        </Button>
      </Group>
    </Stack>
  );
}
