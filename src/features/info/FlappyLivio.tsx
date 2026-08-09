// Gioco "Flappy Utente Demo" (FASE 7B). Canvas leggero, niente librerie: barra spaziatrice
// (o click) per far saltare la faccia di Utente Demo — disegnata OVALE (allungata) così non è
// riconoscibile. Il campo è RESPONSIVO: riempie tutta la finestra (larghezza+altezza) e la
// fisica si scala sulla dimensione, quindi funziona a qualsiasi misura e si ridimensiona.
// Cielo con nuvole, intro con Utente Demo da sinistra e ostacoli da destra. Punteggio + record
// (localStorage). Suoni offline. L'uscita (Esc) la gestisce InfoWindow (componente montato
// solo durante il gioco). Rispetta «Riduci animazioni» (niente intro).
import { useCallback, useEffect, useRef, useState } from "react";
import { ActionIcon, Badge, Box, Group, Text, Tooltip } from "@mantine/core";
import { IconPlayerPlayFilled, IconVolume, IconVolumeOff } from "@tabler/icons-react";
import { usePrefs } from "../../lib/prefs";
import livioUrl from "../../assets/game/livio.png";
import { precaricaSuoniGioco, suonaGioco } from "./giocoSuoni";
import { motion, AnimatePresence } from "framer-motion";

// Costanti come FRAZIONI della dimensione del campo → look e difficoltà costanti a ogni misura.
const GAP_FRAC = 0.42; // apertura verticale (frazione dell'altezza)
const GRAV_FACT = 3.3; // gravità = altezza * fattore (px/s²)
const JUMP_FACT = 1.0; // spinta del salto = altezza * fattore (px/s)
const VEL_FACT = 0.46; // scorrimento ostacoli = larghezza * fattore (px/s)
const RY_FACT = 0.062; // semiasse verticale di Utente Demo = altezza * fattore (ovale)
const LIVIO_X_FACT = 0.24; // x di Utente Demo = larghezza * fattore
const COLW_FACT = 0.12; // larghezza colonna = larghezza * fattore
const SPACING_FACT = 0.62; // distanza tra colonne = larghezza * fattore

type Fase = "intro" | "pronto" | "gioco" | "morto";

interface Colonna {
  x: number; // px
  gapFrac: number; // centro apertura come frazione dell'altezza (resta valido al resize)
  superata: boolean;
  target?: number; // intro: x dove fermarsi (decorativa)
}

interface Nuvola {
  x: number;
  y: number;
  s: number; // scala
  vf: number; // velocità come frazione della larghezza al secondo
}

interface Stato {
  fase: Fase;
  y: number;
  v: number;
  x: number; // x corrente di Utente Demo (per l'intro che entra da sinistra)
  rot: number;
  colonne: Colonna[];
  nuvole: Nuvola[];
  punti: number;
  scuoti: number;
  decorPronte: boolean; // intro: colonne decorative già create
}

const RECORD_KEY = "pt.flappyRecord";

// x,y partono come FRAZIONI (0..1): `adatta()` le converte in px alla prima misura.
function nuoveNuvole(): Nuvola[] {
  return Array.from({ length: 4 }, () => ({
    x: Math.random(),
    y: 0.08 + Math.random() * 0.5,
    s: 0.7 + Math.random() * 0.8,
    vf: 0.02 + Math.random() * 0.03,
  }));
}

function nuovoStato(fase: Fase): Stato {
  return {
    fase,
    y: 0,
    v: 0,
    x: fase === "intro" ? -60 : 0,
    rot: 0,
    colonne: [],
    nuvole: nuoveNuvole(),
    punti: 0,
    scuoti: 0,
    decorPronte: false,
  };
}

export function FlappyLivio() {
  const { giocoMuto, setGiocoMuto, ridurreAnimazioni } = usePrefs();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dimRef = useRef({ w: 360, h: 360 });
  const statoRef = useRef<Stato>(nuovoStato(ridurreAnimazioni ? "pronto" : "intro"));
  const mutoRef = useRef(giocoMuto);
  mutoRef.current = giocoMuto;
  const imgRef = useRef<HTMLImageElement | null>(null);
  const nuvoleInit = useRef(false);

  const [fase, setFase] = useState<Fase>(statoRef.current.fase);
  const [punti, setPunti] = useState(0);
  const [record, setRecord] = useState<number>(() => {
    const v = Number(localStorage.getItem(RECORD_KEY));
    return Number.isFinite(v) ? v : 0;
  });

  // Carica lo sprite una volta.
  useEffect(() => {
    precaricaSuoniGioco();
    const img = new Image();
    img.src = livioUrl;
    img.onload = () => (imgRef.current = img);
  }, []);

  const salta = useCallback(() => {
    const s = statoRef.current;
    const { h } = dimRef.current;
    if (s.fase === "intro") return; // l'intro va da sola
    if (s.fase === "pronto") {
      s.fase = "gioco";
      s.colonne = []; // via le decorative, parte la fisica
      setFase("gioco");
    } else if (s.fase === "morto") {
      const nuovo = nuovoStato("gioco");
      nuovo.nuvole = s.nuvole; // tieni le nuvole dove sono
      nuovo.y = h / 2;
      Object.assign(statoRef.current, nuovo);
      setPunti(0);
      setFase("gioco");
      // Nessun return: prosegue per fare il salto
    }
    s.v = -h * JUMP_FACT;
    s.rot = -0.5;
    suonaGioco("salto", mutoRef.current);
  }, []);

  // Input: barra spaziatrice / freccia su + click sul canvas (Esc lo gestisce InfoWindow).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        salta();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [salta]);

  // Loop di gioco (rAF) + ridimensionamento del canvas alla dimensione reale del wrapper.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const adatta = () => {
      const w = Math.max(160, wrap.clientWidth);
      const h = Math.max(160, wrap.clientHeight);
      dimRef.current = { w, h };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      // Nuvole: dalle frazioni iniziali a px reali (una volta sola).
      const s = statoRef.current;
      if (!nuvoleInit.current) {
        for (const n of s.nuvole) {
          n.x *= w;
          n.y *= h;
        }
        nuvoleInit.current = true;
        if (s.y === 0) s.y = h / 2;
      }
    };
    adatta();
    const ro = new ResizeObserver(adatta);
    ro.observe(wrap);

    let raf = 0;
    let ultimo = performance.now();

    const morte = () => {
      const s = statoRef.current;
      if (s.fase === "morto") return;
      s.fase = "morto";
      s.scuoti = 0.35;
      suonaGioco("colpo", mutoRef.current);
      window.setTimeout(() => suonaGioco("gameover", mutoRef.current), 180);
      setFase("morto");
      setRecord((r) => {
        const nuovo = Math.max(r, s.punti);
        if (nuovo !== r) localStorage.setItem(RECORD_KEY, String(nuovo));
        return nuovo;
      });
    };

    const passo = (dt: number) => {
      const s = statoRef.current;
      const { w: W, h: H } = dimRef.current;
      const GAP = H * GAP_FRAC;
      const VELX = W * VEL_FACT;
      const COLW = Math.max(34, W * COLW_FACT);
      const RAGGIO = H * RY_FACT * 0.7;
      const LIVIO_X = W * LIVIO_X_FACT;
      const SUOLO = H - H * 0.045;

      // Nuvole.
      for (const n of s.nuvole) {
        n.x -= n.vf * W * dt;
        if (n.x < -70 * n.s) {
          n.x = W + 40;
          n.y = H * (0.06 + Math.random() * 0.5);
        }
      }

      if (s.fase === "intro") {
        // Crea le colonne decorative che "arrivano da destra".
        if (!s.decorPronte) {
          s.decorPronte = true;
          s.colonne = [
            { x: W * 1.0, gapFrac: 0.32 + Math.random() * 0.36, superata: true, target: W * 0.6 },
            { x: W * 1.35, gapFrac: 0.32 + Math.random() * 0.36, superata: true, target: W * 0.92 },
          ];
        }
        s.x += VELX * 1.5 * dt;
        s.y = H / 2 + Math.sin(performance.now() / 120) * 6;
        s.rot = Math.sin(performance.now() / 90) * 0.16;
        for (const c of s.colonne) c.x = Math.max(c.target ?? 0, c.x - VELX * dt);
        if (s.x >= LIVIO_X) {
          s.x = LIVIO_X;
          s.fase = "pronto";
          s.y = H / 2;
          s.rot = 0;
          setFase("pronto");
        }
        return;
      }

      if (s.fase === "pronto") {
        s.x = LIVIO_X;
        s.y = H / 2 + Math.sin(performance.now() / 260) * 10;
        s.rot = Math.sin(performance.now() / 300) * 0.15; // Inarca a destra e sinistra dolcemente
        return;
      }

      if (s.fase === "morto") {
        if (s.scuoti > 0) s.scuoti = Math.max(0, s.scuoti - dt);
        s.v += H * GRAV_FACT * dt;
        s.y = Math.min(SUOLO - RAGGIO, s.y + s.v * dt);
        s.rot = Math.min(1.4, s.rot + 2.4 * dt);
        return;
      }

      // --- fase "gioco" ---
      s.x = LIVIO_X;
      s.v += H * GRAV_FACT * dt;
      s.y += s.v * dt;
      s.rot = Math.max(-0.5, Math.min(1.4, s.v / (H * 1.4)));

      // Spawn a distanza costante.
      const spacing = W * SPACING_FACT;
      const ultimaX = s.colonne.length ? Math.max(...s.colonne.map((c) => c.x)) : -Infinity;
      if (s.colonne.length === 0 || W - ultimaX >= spacing) {
        s.colonne.push({ x: W, gapFrac: 0.24 + Math.random() * 0.52, superata: false });
      }

      // Muovi colonne + punteggio.
      for (const c of s.colonne) {
        c.x -= VELX * dt;
        if (!c.superata && c.x + COLW < s.x - RAGGIO) {
          c.superata = true;
          s.punti += 1;
          setPunti(s.punti);
          suonaGioco("punto", mutoRef.current);
        }
      }
      s.colonne = s.colonne.filter((c) => c.x + COLW > -10);

      // Collisioni: pavimento/soffitto.
      if (s.y + RAGGIO >= SUOLO || s.y - RAGGIO <= 0) {
        s.y = Math.min(Math.max(s.y, RAGGIO), SUOLO - RAGGIO);
        morte();
        return;
      }
      // Collisioni colonne (Utente Demo approssimato a un cerchio di raggio RAGGIO).
      for (const c of s.colonne) {
        if (c.x > s.x + RAGGIO || c.x + COLW < s.x - RAGGIO) continue;
        const topBottom = c.gapFrac * H - GAP / 2;
        const botTop = c.gapFrac * H + GAP / 2;
        if (s.y - RAGGIO < topBottom || s.y + RAGGIO > botTop) {
          morte();
          return;
        }
      }
    };

    const disegna = () => {
      const s = statoRef.current;
      const { w: W, h: H } = dimRef.current;
      const GAP = H * GAP_FRAC;
      const COLW = Math.max(34, W * COLW_FACT);
      const RY = H * RY_FACT;
      const RX = RY * 0.72;
      const suolH = Math.max(10, H * 0.045);

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      if (s.scuoti > 0) {
        const m = s.scuoti * 14;
        ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      }

      // Cielo.
      const cielo = ctx.createLinearGradient(0, 0, 0, H);
      cielo.addColorStop(0, "#BFE3FF");
      cielo.addColorStop(1, "#EAF7FF");
      ctx.fillStyle = cielo;
      ctx.fillRect(0, 0, W, H);

      // Nuvole.
      const cloudScale = H / 400;
      for (const n of s.nuvole) disegnaNuvola(ctx, n.x, n.y, n.s * cloudScale);

      // Colonne.
      for (const c of s.colonne) {
        const cy = c.gapFrac * H;
        const topH = cy - GAP / 2;
        const botY = cy + GAP / 2;
        disegnaColonna(ctx, c.x, 0, COLW, topH, true);
        disegnaColonna(ctx, c.x, botY, COLW, H - suolH - botY, false);
      }

      // Suolo.
      ctx.fillStyle = "#1A1A1A";
      ctx.fillRect(0, H - suolH, W, suolH);
      ctx.fillStyle = "#F4C20D";
      ctx.fillRect(0, H - suolH, W, 3);

      // Utente Demo (ovale).
      if (s.fase !== "pronto") {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rot);
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(0, 0, RX + 2, RY + 2, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.shadowColor = "rgba(0,0,0,0.22)";
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.restore();
        const img = imgRef.current;
        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, -RX, -RY, RX * 2, RY * 2);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.ellipse(0, 0, RX, RY, 0, 0, Math.PI * 2);
          ctx.fillStyle = "#F4C20D";
          ctx.fill();
        }
        ctx.restore();
      }

      ctx.restore();
    };

    const loop = (ora: number) => {
      let dt = (ora - ultimo) / 1000;
      ultimo = ora;
      if (dt > 0.05) dt = 0.05;
      passo(dt);
      disegna();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <Box style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Group justify="space-between" align="center" mb={6} style={{ flex: "0 0 auto" }}>
        <Group gap="xs">
          <Badge variant="light" color="dark" size="lg">
            Punti {punti}
          </Badge>
          <Badge variant="light" color="accent" size="lg">
            Record {record}
          </Badge>
        </Group>
        <Tooltip label={giocoMuto ? "Riattiva i suoni" : "Disattiva i suoni"} withArrow>
          <ActionIcon variant="subtle" color="gray" onClick={() => setGiocoMuto(!giocoMuto)} aria-label="Muto">
            {giocoMuto ? <IconVolumeOff size={18} /> : <IconVolume size={18} />}
          </ActionIcon>
        </Tooltip>
      </Group>

      <Box
        ref={wrapRef}
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid var(--border)",
          cursor: "pointer",
          userSelect: "none",
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          salta();
        }}
      >
        <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />

        <AnimatePresence>
          {fase === "pronto" && (
            <Overlay key="pronto">
              <motion.div
                animate={{ y: [-12, 12, -12], rotate: [-4, 4, -4] }}
                transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
                style={{ marginBottom: 12 }}
              >
                <div
                  style={{
                    width: 72,
                    height: 100,
                    borderRadius: "50%",
                    overflow: "hidden",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                    border: "4px solid #fff",
                    backgroundColor: "#F4C20D",
                  }}
                >
                  <img src={livioUrl} alt="Livio" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              </motion.div>
              <Text
                fw={800}
                fz={50}
                style={{
                  letterSpacing: -1,
                  color: "#1A1A1A",
                  fontFamily: "system-ui, sans-serif",
                  lineHeight: 1.1,
                }}
                mb="xl"
              >
                Flappy <span style={{ color: "#F4C20D" }}>Livio</span>
              </Text>
              <IconPlayerPlayFilled size={34} color="#1A1A1A" />
              <Text fw={700} mt={6}>
                Premi <Kbd>Spazio</Kbd> per volare
              </Text>
              <Text size="sm" c="dimmed">
                <Kbd>Esc</Kbd> per tornare alle info.
              </Text>
            </Overlay>
          )}
          {fase === "morto" && (
            <Overlay key="morto">
              <Text fw={800} fz={26}>
                Game over
              </Text>
              <Text size="sm">
                Punti <b>{punti}</b> · Record <b>{record}</b>
              </Text>
              <Text size="sm" c="dimmed" mt={4}>
                <Kbd>Spazio</Kbd> per riprovare · <Kbd>Esc</Kbd> per uscire
              </Text>
            </Overlay>
          )}
        </AnimatePresence>
      </Box>
    </Box>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component={motion.div}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeInOut" }}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        background: "rgba(255,255,255,0.32)",
        backdropFilter: "blur(1px)",
        pointerEvents: "none",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ duration: 0.25, ease: "easeInOut" }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          padding: 16,
        }}
      >
        {children}
      </motion.div>
    </Box>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="kbd"
      style={{
        fontFamily: "inherit",
        fontSize: 12,
        fontWeight: 700,
        padding: "2px 6px",
        borderRadius: 5,
        background: "#fff",
        border: "1px solid var(--mantine-color-gray-4)",
        borderBottomWidth: 2,
      }}
    >
      {children}
    </Box>
  );
}

/** Nuvola soffice: tre lobi bianchi semitrasparenti. */
function disegnaNuvola(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath();
  ctx.ellipse(x, y, 26 * s, 16 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 22 * s, y + 4 * s, 20 * s, 13 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 22 * s, y + 5 * s, 18 * s, 12 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Una colonna stile "tubo" con testa, in palette brand. `dallAlto` cambia la testa. */
function disegnaColonna(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dallAlto: boolean
) {
  if (h <= 0) return;
  ctx.fillStyle = "#1A1A1A";
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  const testaH = 16;
  ctx.fillStyle = "#F4C20D";
  const ty = dallAlto ? y + h - testaH : y;
  roundRect(ctx, x - 4, ty, w + 8, testaH, 5);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
