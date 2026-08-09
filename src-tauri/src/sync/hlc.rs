//! Hybrid Logical Clock (HLC).
//!
//! Un HLC ordina gli eventi in modo deterministico anche se gli orologi dei PC
//! sono leggermente disallineati. È la tupla `(wall, counter, device)`:
//! - `wall`    : millisecondi dall'epoch (componente "fisico")
//! - `counter` : contatore logico che cresce quando il wall-clock non avanza
//! - `device`  : identificativo del dispositivo, usato solo come tie-break finale
//!
//! La rappresentazione testuale `"{wall:016x}-{counter:08x}-{device}"` è
//! **lessicograficamente ordinabile** sulle prime due componenti: confrontare le
//! stringhe dà lo stesso ordine di `Ord`. Questo permette di salvare l'HLC come
//! TEXT in SQLite e fare confronti `<`/`>` direttamente in SQL.

use std::cmp::Ordering;
use std::fmt;
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Un timestamp HLC. L'ordinamento è `(wall, counter, device)`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Hlc {
    pub wall: u64,
    pub counter: u32,
    pub device: String,
}

impl Hlc {
    pub fn new(wall: u64, counter: u32, device: impl Into<String>) -> Self {
        Hlc {
            wall,
            counter,
            device: device.into(),
        }
    }
}

impl Ord for Hlc {
    fn cmp(&self, other: &Self) -> Ordering {
        self.wall
            .cmp(&other.wall)
            .then(self.counter.cmp(&other.counter))
            .then_with(|| self.device.cmp(&other.device))
    }
}

impl PartialOrd for Hlc {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl fmt::Display for Hlc {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // 16 hex per wall (u64) + 8 hex per counter (u32) -> ordinabile come stringa.
        write!(f, "{:016x}-{:08x}-{}", self.wall, self.counter, self.device)
    }
}

/// Errore di parsing di un HLC da stringa.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HlcParseError(pub String);

impl fmt::Display for HlcParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "HLC non valido: {}", self.0)
    }
}

impl std::error::Error for HlcParseError {}

impl FromStr for Hlc {
    type Err = HlcParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        // Formato: "<wall:16hex>-<counter:8hex>-<device>".
        // Il device può contenere '-', quindi splitto solo le prime due parti.
        let mut it = s.splitn(3, '-');
        let wall_s = it.next().ok_or_else(|| HlcParseError(s.to_string()))?;
        let cnt_s = it.next().ok_or_else(|| HlcParseError(s.to_string()))?;
        let device = it.next().ok_or_else(|| HlcParseError(s.to_string()))?;
        let wall = u64::from_str_radix(wall_s, 16).map_err(|_| HlcParseError(s.to_string()))?;
        let counter = u32::from_str_radix(cnt_s, 16).map_err(|_| HlcParseError(s.to_string()))?;
        if device.is_empty() {
            return Err(HlcParseError(s.to_string()));
        }
        Ok(Hlc::new(wall, counter, device))
    }
}

impl Serialize for Hlc {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for Hlc {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Hlc::from_str(&s).map_err(serde::de::Error::custom)
    }
}

/// Generatore di HLC per un dispositivo. Mantiene l'ultimo timestamp emesso per
/// garantire la monotonia anche quando il wall-clock non avanza o torna indietro.
#[derive(Debug, Clone)]
pub struct HlcClock {
    device: String,
    last_wall: u64,
    last_counter: u32,
}

impl HlcClock {
    pub fn new(device: impl Into<String>) -> Self {
        HlcClock {
            device: device.into(),
            last_wall: 0,
            last_counter: 0,
        }
    }

    /// Millisecondi correnti dall'epoch (wall-clock di sistema).
    pub fn now_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    /// Riallinea il clock interno a un HLC già visto (senza generarne uno nuovo),
    /// utile in fase di bootstrap da snapshot.
    pub fn bump_to(&mut self, seen: &Hlc) {
        if seen.wall > self.last_wall {
            self.last_wall = seen.wall;
            self.last_counter = seen.counter;
        } else if seen.wall == self.last_wall && seen.counter > self.last_counter {
            self.last_counter = seen.counter;
        }
    }

    /// Genera il prossimo HLC per un evento **locale**.
    pub fn tick(&mut self) -> Hlc {
        self.tick_at(Self::now_ms())
    }

    /// Variante di [`tick`] con wall-clock iniettato (per i test).
    pub fn tick_at(&mut self, now: u64) -> Hlc {
        if now > self.last_wall {
            self.last_wall = now;
            self.last_counter = 0;
        } else {
            self.last_counter += 1;
        }
        Hlc::new(self.last_wall, self.last_counter, self.device.clone())
    }

    /// Osserva un evento remoto usando un wall-clock iniettato.
    #[cfg(test)]
    fn observe_at(&mut self, now: u64, remote: &Hlc) -> Hlc {
        let wall = now.max(self.last_wall).max(remote.wall);
        let counter = if wall == self.last_wall && wall == remote.wall {
            self.last_counter.max(remote.counter) + 1
        } else if wall == self.last_wall {
            self.last_counter + 1
        } else if wall == remote.wall {
            remote.counter + 1
        } else {
            0
        };
        self.last_wall = wall;
        self.last_counter = counter;
        Hlc::new(self.last_wall, self.last_counter, self.device.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinamento_per_wall_poi_counter_poi_device() {
        let a = Hlc::new(100, 0, "PC-A");
        let b = Hlc::new(100, 1, "PC-A");
        let c = Hlc::new(101, 0, "PC-A");
        assert!(a < b, "counter maggiore vince a parità di wall");
        assert!(b < c, "wall maggiore vince");
        // tie-break sul device a parità di wall+counter
        let x = Hlc::new(100, 0, "PC-A");
        let y = Hlc::new(100, 0, "PC-B");
        assert!(x < y);
    }

    #[test]
    fn stringa_ordinabile_come_ord() {
        let mut v = vec![
            Hlc::new(0x10, 2, "PC-B"),
            Hlc::new(0x10, 2, "PC-A"),
            Hlc::new(0x10, 1, "PC-Z"),
            Hlc::new(0x0f, 99, "PC-A"),
        ];
        // ordino per Ord
        let mut by_ord = v.clone();
        by_ord.sort();
        // ordino per stringa
        v.sort_by_key(|h| h.to_string());
        assert_eq!(by_ord, v, "l'ordine per stringa deve coincidere con Ord");
    }

    #[test]
    fn roundtrip_stringa() {
        let h = Hlc::new(1718000000000, 7, "PC-LIVIO");
        let s = h.to_string();
        let back: Hlc = s.parse().unwrap();
        assert_eq!(h, back);
    }

    #[test]
    fn roundtrip_device_con_trattino() {
        let h = Hlc::new(42, 3, "PC-UFFICIO-2");
        let back: Hlc = h.to_string().parse().unwrap();
        assert_eq!(h, back);
    }

    #[test]
    fn roundtrip_json() {
        let h = Hlc::new(123, 4, "PC-A");
        let j = serde_json::to_string(&h).unwrap();
        assert_eq!(j, "\"000000000000007b-00000004-PC-A\"");
        let back: Hlc = serde_json::from_str(&j).unwrap();
        assert_eq!(h, back);
    }

    #[test]
    fn tick_monotono_anche_con_orologio_fermo() {
        let mut c = HlcClock::new("PC-A");
        let a = c.tick_at(1000);
        let b = c.tick_at(1000); // wall fermo -> counter avanza
        let d = c.tick_at(999); // wall indietro -> counter avanza, wall resta 1000
        let e = c.tick_at(2000); // wall avanza -> counter azzerato
        assert_eq!(a, Hlc::new(1000, 0, "PC-A"));
        assert_eq!(b, Hlc::new(1000, 1, "PC-A"));
        assert_eq!(d, Hlc::new(1000, 2, "PC-A"));
        assert_eq!(e, Hlc::new(2000, 0, "PC-A"));
        assert!(a < b && b < d && d < e);
    }

    #[test]
    fn observe_supera_il_remoto() {
        let mut c = HlcClock::new("PC-A");
        let remoto = Hlc::new(5000, 3, "PC-B");
        // il nostro orologio è indietro: dobbiamo "superare" il remoto
        let got = c.observe_at(1000, &remoto);
        assert_eq!(got, Hlc::new(5000, 4, "PC-A"));
        assert!(got > remoto);
        // un tick successivo resta monotono
        let next = c.tick_at(1000);
        assert!(next > got);
    }
}
