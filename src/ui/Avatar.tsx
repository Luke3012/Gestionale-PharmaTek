// Avatar utente: preset (gradiente+icona), foto (custom) o iniziali su colore.
import { useEffect, useState } from "react";
import { Box } from "@mantine/core";
import type { AvatarTipo } from "../lib/tauri";
import { api } from "../lib/tauri";
import { coloreNome, iniziali, presetById } from "./avatars";
import { useAnimazioniRidotte } from "./motion";

// Cache globale per gli url degli avatar, così da non ricaricarli ad ogni smontaggio/montaggio
// o in punti diversi dell'app per lo stesso utente.
const avatarCache = new Map<string, string>();

try {
  const stored = localStorage.getItem("pt.lastAvatarBase64");
  if (stored) {
    const p = JSON.parse(stored);
    if (p && p.userId && p.data) avatarCache.set(p.userId, p.data);
  }
} catch {}

export function aggiornaAvatarCache(userId: string, dataUrl: string) {
  avatarCache.set(userId, dataUrl);
  try {
    localStorage.setItem("pt.lastAvatarBase64", JSON.stringify({ userId, data: dataUrl }));
  } catch {}
}

/** Svuota la cache avatar in memoria e su localStorage. Da chiamare prima di un reset. */
export function svuotaCacheAvatar() {
  avatarCache.clear();
  try {
    localStorage.removeItem("pt.lastAvatarBase64");
  } catch {}
}


interface Props {
  nome: string;
  tipo: AvatarTipo;
  valore: string;
  /** Per le foto (`custom`): id utente da cui leggere i byte salvati. */
  userId?: string;
  /** Sorgente immagine già pronta (es. anteprima in onboarding). */
  src?: string;
  size?: number;
}

export function Avatar({ nome, tipo, valore, userId, src, size = 40 }: Props) {
  const [fotoSrc, setFotoSrc] = useState<string | undefined>(() => {
    if (src) return src;
    if (tipo === "custom" && userId && avatarCache.has(userId)) {
      return avatarCache.get(userId);
    }
    return undefined;
  });
  // La foto compare in dissolvenza una volta decodificata: niente «scatto» dal
  // riquadro con le iniziali alla foto (visibile soprattutto sullo schermo d'avvio).
  const [imgPronta, setImgPronta] = useState(() => {
    if (src) return true;
    if (tipo === "custom" && userId && avatarCache.has(userId)) {
      return true;
    }
    return false;
  });
  const ridotte = useAnimazioniRidotte();
  useEffect(() => {
    const targetSrc = src || (tipo === "custom" && userId ? avatarCache.get(userId) : undefined);
    if (fotoSrc !== targetSrc) {
      setImgPronta(false);
      setFotoSrc(targetSrc);
    }
    if (src || tipo !== "custom" || !userId) return;

    if (avatarCache.has(userId)) {
      return;
    }

    let url: string | undefined;
    let vivo = true;
    let timer: number;

    const carica = () => {
      api
        .readAvatar(userId)
        .then((bytes) => {
          if (!vivo || !bytes) return;
          const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
          url = URL.createObjectURL(blob);
          avatarCache.set(userId, url);
          setFotoSrc(url);

          const reader = new FileReader();
          reader.onloadend = () => {
            try {
              localStorage.setItem("pt.lastAvatarBase64", JSON.stringify({ userId, data: reader.result }));
            } catch {}
          };
          reader.readAsDataURL(blob);
        })
        .catch(() => {
          if (vivo) {
            // Riprova dopo 1 secondo se il backend non è ancora pronto/in bootstrap
            timer = window.setTimeout(carica, 1000);
          }
        });
    };

    carica();

    return () => {
      vivo = false;
      window.clearTimeout(timer);
    };
  }, [src, tipo, userId]);

  const common = {
    width: size,
    height: size,
    minWidth: size,
    minHeight: size,
    aspectRatio: "1 / 1",
    flexShrink: 0,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontWeight: 700,
    fontSize: size * 0.4,
    lineHeight: 1,
    overflow: "hidden",
    userSelect: "none" as const,
  };

  if (tipo === "custom") {
    // Base = iniziali su colore (come il fallback): resta visibile finché la foto non
    // è pronta, poi la foto le copre in dissolvenza. Nessun salto di layout/contenuto.
    return (
      <Box style={{ ...common, background: coloreNome(nome || "?"), position: "relative" }}>
        {(!fotoSrc || !imgPronta) && <span>{iniziali(nome || "?")}</span>}
        {fotoSrc && (
          <img
            src={fotoSrc}
            alt={nome}
            onLoad={() => setImgPronta(true)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: imgPronta ? 1 : 0,
              transition: ridotte ? "none" : "opacity 220ms ease",
            }}
          />
        )}
      </Box>
    );
  }

  if (tipo === "preset") {
    const p = presetById(valore);
    const Icon = p.Icon;
    return (
      <Box style={{ ...common, background: `linear-gradient(135deg, ${p.grad[0]}, ${p.grad[1]})` }}>
        <Icon size={size * 0.55} stroke={2} />
      </Box>
    );
  }

  return <Box style={{ ...common, background: coloreNome(nome || "?") }}>{iniziali(nome || "?")}</Box>;
}
