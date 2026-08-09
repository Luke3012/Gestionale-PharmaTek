import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Paper, Portal, UnstyledButton } from "@mantine/core";
import { IconClipboard, IconCopy } from "@tabler/icons-react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  attributiIndicanoCombobox,
  inputSupportaMenuTestuale,
  limitaMenuAlViewport,
} from "./menuContestualeTestoUtils";

type CampoTestuale = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

interface SelezioneCampo {
  campo: CampoTestuale;
  testo: string | null;
  incollabile: boolean;
  start?: number;
  end?: number;
  direzione?: "forward" | "backward" | "none";
  range?: Range;
}

interface MenuAperto {
  x: number;
  y: number;
  selezione: SelezioneCampo;
}

function trovaCampoTestuale(target: EventTarget | null): CampoTestuale | null {
  if (!(target instanceof Element)) return null;
  const input = target.closest("input");
  if (input instanceof HTMLInputElement) {
    const appartieneACombobox = input.closest('[role="combobox"]') != null
      || attributiIndicanoCombobox({
        role: input.getAttribute("role"),
        ariaHasPopup: input.getAttribute("aria-haspopup"),
        ariaAutocomplete: input.getAttribute("aria-autocomplete"),
        haLista: input.list != null,
      });
    if (appartieneACombobox) return null;
    return inputSupportaMenuTestuale(input.type, input.inputMode) ? input : null;
  }
  const textarea = target.closest("textarea");
  if (textarea instanceof HTMLTextAreaElement) return textarea;
  const modificabile = target.closest<HTMLElement>(
    '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]'
  );
  return modificabile?.isContentEditable ? modificabile : null;
}

function acquisisciSelezione(campo: CampoTestuale): SelezioneCampo {
  if (campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement) {
    const start = campo.selectionStart ?? undefined;
    const end = campo.selectionEnd ?? start;
    return {
      campo,
      start,
      end,
      direzione: campo.selectionDirection ?? "none",
      testo: start == null || end == null ? null : campo.value.slice(start, end),
      incollabile: !campo.disabled && !campo.readOnly,
    };
  }

  const selection = window.getSelection();
  const corrente = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const range = corrente && campo.contains(corrente.commonAncestorContainer)
    ? corrente.cloneRange()
    : undefined;
  return {
    campo,
    range,
    testo: range?.toString() ?? "",
    incollabile: campo.getAttribute("aria-readonly") !== "true",
  };
}

function ripristinaSelezione(selezione: SelezioneCampo) {
  const { campo } = selezione;
  campo.focus({ preventScroll: true });
  if (campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement) {
    if (selezione.start != null && selezione.end != null) {
      try {
        campo.setSelectionRange(selezione.start, selezione.end, selezione.direzione);
      } catch {}
    }
    return;
  }
  if (!selezione.range) return;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(selezione.range);
}

async function copiaSelezione(selezione: SelezioneCampo) {
  ripristinaSelezione(selezione);
  if (selezione.testo == null) {
    document.execCommand("copy");
    return;
  }
  try {
    await writeText(selezione.testo);
  } catch {
    document.execCommand("copy");
  }
}

function inserisciTesto(selezione: SelezioneCampo, testo: string) {
  ripristinaSelezione(selezione);
  const { campo } = selezione;
  if (campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement) {
    if (document.execCommand("insertText", false, testo)) return;
    const start = selezione.start ?? campo.selectionStart ?? campo.value.length;
    const end = selezione.end ?? campo.selectionEnd ?? start;
    campo.setRangeText(testo, start, end, "end");
    campo.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertFromPaste",
      data: testo,
    }));
    return;
  }

  if (document.execCommand("insertText", false, testo)) return;
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(testo);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  campo.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertFromPaste",
    data: testo,
  }));
}

async function incollaSelezione(selezione: SelezioneCampo) {
  try {
    const testo = await readText();
    inserisciTesto(selezione, testo);
  } catch {
    ripristinaSelezione(selezione);
  }
}

export function MenuContestualeTesto() {
  const [menu, setMenu] = useState<MenuAperto | null>(null);
  const [posizione, setPosizione] = useState({ left: 8, top: 8 });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const apri = (event: MouseEvent) => {
      const campo = trovaCampoTestuale(event.target);
      if (!campo) {
        setMenu(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setMenu({ x: event.clientX, y: event.clientY, selezione: acquisisciSelezione(campo) });
    };
    window.addEventListener("contextmenu", apri, true);
    return () => window.removeEventListener("contextmenu", apri, true);
  }, []);

  useLayoutEffect(() => {
    if (!menu) return;
    const rect = menuRef.current?.getBoundingClientRect();
    setPosizione(limitaMenuAlViewport(
      { x: menu.x, y: menu.y },
      { width: rect?.width ?? 168, height: rect?.height ?? 88 },
      { width: window.innerWidth, height: window.innerHeight }
    ));
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const chiudiFuori = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    const intercettaEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setMenu(null);
    };
    const chiudi = () => setMenu(null);
    const chiudiSeNascosta = () => {
      if (document.visibilityState !== "visible") chiudi();
    };
    window.addEventListener("pointerdown", chiudiFuori, true);
    window.addEventListener("keydown", intercettaEscape, true);
    window.addEventListener("resize", chiudi);
    window.addEventListener("blur", chiudi);
    window.addEventListener("scroll", chiudi, true);
    document.addEventListener("visibilitychange", chiudiSeNascosta);
    return () => {
      window.removeEventListener("pointerdown", chiudiFuori, true);
      window.removeEventListener("keydown", intercettaEscape, true);
      window.removeEventListener("resize", chiudi);
      window.removeEventListener("blur", chiudi);
      window.removeEventListener("scroll", chiudi, true);
      document.removeEventListener("visibilitychange", chiudiSeNascosta);
    };
  }, [menu]);

  if (!menu) return null;
  const esegui = (azione: "copia" | "incolla") => {
    const selezione = menu.selezione;
    setMenu(null);
    if (azione === "copia") void copiaSelezione(selezione);
    else void incollaSelezione(selezione);
  };

  return (
    <Portal>
      <Paper
        ref={menuRef}
        role="menu"
        aria-label="Menu contestuale testo"
        withBorder
        shadow="lg"
        radius="md"
        p={5}
        className="pt-menu-contestuale-testo"
        onContextMenu={(event) => event.preventDefault()}
        style={{ left: posizione.left, top: posizione.top }}
      >
        <UnstyledButton
          role="menuitem"
          disabled={menu.selezione.testo === ""}
          className="pt-menu-contestuale-azione"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => esegui("copia")}
        >
          <IconCopy size={16} aria-hidden />
          <span>Copia</span>
        </UnstyledButton>
        <UnstyledButton
          role="menuitem"
          disabled={!menu.selezione.incollabile}
          className="pt-menu-contestuale-azione"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => esegui("incolla")}
        >
          <IconClipboard size={16} aria-hidden />
          <span>Incolla</span>
        </UnstyledButton>
      </Paper>
    </Portal>
  );
}
