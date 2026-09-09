export function emailComunicazioneValida(
  value: string | undefined,
): boolean {
  const email = value?.trim() ?? "";
  return (
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    !/[\r\n]/.test(email)
  );
}

function normalizzaSingoloTelefonoWhatsapp(value: string): string | null {
  const originale = value.trim();
  if (!originale) return null;

  let cifre = originale.replace(/\D/g, "");
  const internazionale = originale.startsWith("+") || cifre.startsWith("00");
  if (cifre.startsWith("00")) cifre = cifre.slice(2);

  if (!internazionale) {
    // Un recapito senza prefisso internazionale proviene dalle anagrafiche
    // italiane. Conserviamo lo zero dei fissi: fa parte del numero anche in
    // formato E.164 (+39 0...). I cellulari italiani possono avere 9 o 10
    // cifre, perciò non imponiamo più la vecchia lunghezza fissa di 10.
    if (/^0\d{5,10}$/.test(cifre) || /^3\d{8,9}$/.test(cifre)) {
      cifre = `39${cifre}`;
    } else if (!(cifre.startsWith("39") && cifre.length >= 11)) {
      // Mantiene compatibili i numeri internazionali già salvati senza "+".
      // In assenza di un prefisso riconoscibile non inventiamo il +39.
      if (cifre.length < 8 || cifre.length > 15 || cifre.startsWith("0")) {
        return null;
      }
    }
  }

  if (cifre.length < 8 || cifre.length > 15 || cifre.startsWith("0")) {
    return null;
  }
  return `+${cifre}`;
}

/**
 * Restituisce un recapito nel formato internazionale usato dai deep-link.
 * Il campo storico può contenere fisso e cellulare: in quel caso preferisce
 * il cellulare italiano, senza scartare i fissi effettivamente usati su
 * WhatsApp Business.
 */
export function normalizzaTelefonoWhatsapp(
  value: string | undefined,
): string | null {
  const originale = value?.trim() ?? "";
  if (!originale) return null;
  const segmenti = originale
    .split(/\s+(?:[-–—/]\s+)|[;|,\n]+/)
    .map((segmento) => segmento.trim())
    .filter(Boolean);
  const candidati = (segmenti.length ? segmenti : [originale])
    .map(normalizzaSingoloTelefonoWhatsapp)
    .filter((numero): numero is string => !!numero);
  return (
    candidati.find((numero) => /^\+393\d{8,9}$/.test(numero)) ??
    candidati[0] ??
    null
  );
}

export function telefonoWhatsappValido(
  value: string | undefined,
): boolean {
  return normalizzaTelefonoWhatsapp(value) !== null;
}

/** Deep-link nativo alla conversazione WhatsApp, senza testo precompilato. */
export function urlConversazioneWhatsapp(
  value: string | undefined,
): string | null {
  const normalizzato = normalizzaTelefonoWhatsapp(value);
  if (!normalizzato) return null;
  return `whatsapp://send?phone=${normalizzato.slice(1)}`;
}

/** URI per il programma e-mail predefinito, con il recapito codificato. */
export function urlNuovaEmail(value: string | undefined): string | null {
  const email = value?.trim() ?? "";
  if (!emailComunicazioneValida(email)) return null;
  return `mailto:${encodeURIComponent(email)}`;
}
