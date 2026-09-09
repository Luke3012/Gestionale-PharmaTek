# Linee guida interfaccia (styleguide)

Riferimento visivo per tutte le fasi. UI in **italiano**, **extra-semplice** (utenti non tecnici).

> Specifica dettagliata schermata-per-schermata (componenti, finestre, responsive 1366×768):
> vedi [`UI-SPEC.md`](UI-SPEC.md).

## Direzione (decisa)
- **Tema**: sidebar/header **scuri** (come il logo) + area di lavoro **chiara**.
- **Stile**: **arioso e semplice** — testi e pulsanti grandi, molto spazio, pochi elementi
  per schermata. Si privilegia la facilità d'uso rispetto alla densità.
- **Libreria componenti**: **Mantine** (tabelle, form, date picker, notifiche, modali).

## Palette brand (PharmaTek)
| Ruolo | Colore | Hex |
|---|---|---|
| Scuro (sidebar/header) | nero brand | `#1A1A1A` |
| Accento (azioni primarie) | giallo/oro PharmaTek | `#F4C20D` |
| Testo su scuro | bianco | `#FFFFFF` |
| Sfondo contenuto | grigio chiarissimo | `#F5F7FA` |
| Testo principale | grigio scuro | `#1D2733` |

## Colori semantici — stati pagamento (dalla Legenda Excel)
Usati per badge/righe negli stati contabili (NON come colori di brand):
| Stato | Colore | Hex |
|---|---|---|
| `da_saldare` (rosso) | rosso | `#E03131` |
| `saldato` (verde scuro) | verde | `#2F9E44` |
| `saldato_da_verificare` (verde chiaro) | verde chiaro | `#94D82D` |
| `da_controllare` (arancione) | arancione | `#F08C00` |
| `omaggio_sostituzione` (azzurro Napoli) | ciano | `#15AABF` |
| `in_attesa_accredito` (azzurrino) | azzurro | `#74C0FC` |

## Layout
- **Sidebar scura** a sinistra: navigazione moduli (Giornaliero, Anagrafiche, Contabilità,
  Spedizioni, Produzione, CRM, Impostazioni). Logo PharmaTek in alto.
- **Barra superiore**: nome utente corrente, **stato sincronizzazione** (online/offline,
  ultima sync) e notifiche.
- **Area contenuto** chiara: liste/tabelle e form ariosi.
- **Numero ordine provvisorio**: badge giallo "provvisorio" finché non sincronizzato.

## Principi
- Azioni primarie in giallo, sempre evidenti; azioni distruttive con conferma.
- Tabelle con ricerca/filtri in alto, righe alte e leggibili.
- Form con etichette chiare e validazioni inline (CF, email, CAP).
- Niente gergo tecnico nei messaggi: linguaggio semplice in italiano.
