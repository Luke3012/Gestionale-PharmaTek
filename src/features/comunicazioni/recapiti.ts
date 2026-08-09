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

export function telefonoWhatsappValido(
  value: string | undefined,
): boolean {
  const originale = value?.trim() ?? "";
  if (!originale) return false;
  let cifre = originale.replace(/\D/g, "");
  if (cifre.startsWith("00")) cifre = cifre.slice(2);
  if (cifre.startsWith("39"))
    return cifre.length === 12 && cifre.slice(2).startsWith("3");
  if (!originale.startsWith("+"))
    return cifre.length === 10 && cifre.startsWith("3");
  return cifre.length >= 8 && cifre.length <= 15 && !cifre.startsWith("0");
}

/** Deep-link nativo alla conversazione WhatsApp, senza testo precompilato. */
export function urlConversazioneWhatsapp(
  value: string | undefined,
): string | null {
  const originale = value?.trim() ?? "";
  if (!telefonoWhatsappValido(originale)) return null;
  let cifre = originale.replace(/\D/g, "");
  if (cifre.startsWith("00")) {
    cifre = cifre.slice(2);
  } else if (
    !originale.startsWith("+") &&
    cifre.length === 10 &&
    cifre.startsWith("3")
  ) {
    cifre = `39${cifre}`;
  }
  return `whatsapp://send?phone=${cifre}`;
}

/** URI per il programma e-mail predefinito, con il recapito codificato. */
export function urlNuovaEmail(value: string | undefined): string | null {
  const email = value?.trim() ?? "";
  if (!emailComunicazioneValida(email)) return null;
  return `mailto:${encodeURIComponent(email)}`;
}
