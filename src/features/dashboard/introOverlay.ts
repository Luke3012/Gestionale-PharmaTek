let skipIntroOverlay = false;

export function disattivaIntroOverlay() {
  skipIntroOverlay = true;
}

export function deveSaltareIntroOverlay() {
  return skipIntroOverlay;
}

export function consumaIntroOverlaySaltata() {
  const salta = skipIntroOverlay;
  skipIntroOverlay = false;
  return salta;
}
