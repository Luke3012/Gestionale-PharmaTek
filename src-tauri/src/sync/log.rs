//! Log append-only su disco (la cartella `events/` dentro OneDrive).
//!
//! Regola d'oro: **ogni dispositivo scrive solo il proprio file**
//! `events/<deviceId>.ndjson`. Due dispositivi non toccano mai lo stesso file,
//! quindi OneDrive non ha nulla da fondere e non genera "conflicted copy".
//!
//! La lettura è **incrementale** (per byte-offset) e **resistente ai troncamenti**:
//! se l'ultima riga è incompleta (blackout durante una scrittura) viene scartata,
//! e l'offset si ferma all'ultimo `\n` valido così la riga verrà riletta intera
//! quando sarà completa.

use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};

use super::event::Event;

/// Gestisce la cartella `events/` e il file di questo dispositivo.
pub struct LogStore {
    events_dir: PathBuf,
    device: String,
}

/// Esito della lettura incrementale di un file di log.
pub struct ReadResult {
    /// Eventi completi e ben formati letti a partire dall'offset richiesto.
    pub events: Vec<Event>,
    /// Nuovo offset (byte) fino a cui si è consumato: si ferma all'ultimo `\n`.
    pub consumed: u64,
    /// Prima riga completa corrotta, se presente. L'offset si ferma prima di
    /// questa riga: non viene mai marcata come consumata silenziosamente.
    pub corruption: Option<LogCorruption>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogCorruption {
    pub offset: u64,
    pub reason: String,
}

impl LogStore {
    /// Apre (creando se serve) la cartella `events/` per il dispositivo dato.
    pub fn new(events_dir: impl Into<PathBuf>, device: impl Into<String>) -> io::Result<Self> {
        let events_dir = events_dir.into();
        fs::create_dir_all(&events_dir)?;
        Ok(LogStore {
            events_dir,
            device: device.into(),
        })
    }

    /// Percorso del file di log di **questo** dispositivo.
    pub fn own_path(&self) -> PathBuf {
        self.events_dir.join(format!("{}.ndjson", self.device))
    }

    /// Aggiunge un evento al proprio file con append atomico + flush + fsync.
    ///
    /// `sync_all` forza la scrittura su disco: protegge dai blackout (l'evento
    /// confermato all'utente è durevole). In coda al file resta sempre un `\n`.
    #[cfg(test)]
    pub fn append(&self, event: &Event) -> io::Result<()> {
        self.append_many(std::slice::from_ref(event))
    }

    /// Appende più eventi con una sola apertura/flush/fsync, mantenendo nel log
    /// esattamente gli stessi eventi individuali e nello stesso ordine.
    pub fn append_many(&self, events: &[Event]) -> io::Result<()> {
        if events.is_empty() {
            return Ok(());
        }
        let mut buf = Vec::new();
        for event in events {
            let line = event
                .to_ndjson()
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
            buf.extend_from_slice(line.as_bytes());
            buf.push(b'\n');
        }
        let mut f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.own_path())?;
        f.write_all(&buf)?;
        f.flush()?;
        f.sync_all()?;
        Ok(())
    }

    /// Elenca tutti i file `*.ndjson` nella cartella `events/`.
    ///
    /// Include esplicitamente eventuali `… conflicted copy.ndjson` creati da
    /// OneDrive: vengono trattati come una normale sorgente di eventi (assorbiti,
    /// non persi). L'elenco è ordinato per nome per determinismo.
    pub fn ndjson_files(&self) -> io::Result<Vec<PathBuf>> {
        let mut out = Vec::new();
        for entry in fs::read_dir(&self.events_dir)? {
            let path = entry?.path();
            if path.is_file()
                && path
                    .extension()
                    .map(|e| e.eq_ignore_ascii_case("ndjson"))
                    .unwrap_or(false)
            {
                out.push(path);
            }
        }
        out.sort();
        Ok(out)
    }

    /// Legge gli eventi di `path` a partire da `from_offset` (in byte).
    ///
    /// - Le righe complete (terminate da `\n`) vengono parse-ate.
    /// - Una riga che non termina con `\n` (troncamento o scrittura in corso) è
    ///   ignorata e l'offset si ferma prima di essa.
    /// - Davanti a una riga completa ma non parse-abile si ferma e segnala la
    ///   corruzione senza avanzare l'offset: nessun evento sparisce in silenzio.
    pub fn read_from(path: &Path, from_offset: u64) -> io::Result<ReadResult> {
        let mut file = match File::open(path) {
            Ok(f) => f,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                return Ok(ReadResult {
                    events: Vec::new(),
                    consumed: from_offset,
                    corruption: None,
                })
            }
            Err(e) => return Err(e),
        };

        let len = file.metadata()?.len();
        if from_offset >= len {
            // Nulla di nuovo (o file rimpicciolito: rimaniamo prudenti).
            return Ok(ReadResult {
                events: Vec::new(),
                consumed: from_offset.min(len),
                corruption: None,
            });
        }

        use std::io::Seek;
        file.seek(io::SeekFrom::Start(from_offset))?;
        let mut bytes = Vec::with_capacity((len - from_offset) as usize);
        file.read_to_end(&mut bytes)?;

        // Trova l'ultimo '\n': tutto ciò che lo segue è una riga incompleta.
        let last_nl = bytes.iter().rposition(|&b| b == b'\n');
        let complete = match last_nl {
            Some(idx) => &bytes[..=idx],
            None => {
                // Nessuna riga completa nei nuovi byte.
                return Ok(ReadResult {
                    events: Vec::new(),
                    consumed: from_offset,
                    corruption: None,
                });
            }
        };

        let mut events = Vec::new();
        let mut consumed = from_offset;
        let mut cursor = 0usize;
        for chunk in complete.split_inclusive(|&b| b == b'\n') {
            let line_offset = from_offset + cursor as u64;
            cursor += chunk.len();
            let raw = chunk.strip_suffix(b"\n").unwrap_or(chunk);
            if raw.is_empty() {
                consumed = from_offset + cursor as u64;
                continue;
            }
            let line = match std::str::from_utf8(raw) {
                Ok(s) => s.trim(),
                Err(err) => {
                    return Ok(ReadResult {
                        events,
                        consumed,
                        corruption: Some(LogCorruption {
                            offset: line_offset,
                            reason: format!("UTF-8 non valido: {err}"),
                        }),
                    })
                }
            };
            if line.is_empty() {
                consumed = from_offset + cursor as u64;
                continue;
            }
            match Event::from_ndjson(line) {
                Ok(ev) => events.push(ev),
                Err(err) => {
                    return Ok(ReadResult {
                        events,
                        consumed,
                        corruption: Some(LogCorruption {
                            offset: line_offset,
                            reason: format!("JSON evento non valido: {err}"),
                        }),
                    })
                }
            }
            consumed = from_offset + cursor as u64;
        }

        Ok(ReadResult {
            events,
            consumed,
            corruption: None,
        })
    }

    /// Legge solo il primo evento completo e valido del file.
    ///
    /// Serve ai controlli di gap senza rileggere l'intero log quando l'ingest
    /// incrementale parte gia' da un offset avanzato.
    pub fn read_first_event(path: &Path) -> io::Result<Option<Event>> {
        let file = match File::open(path) {
            Ok(f) => f,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e),
        };
        let mut reader = BufReader::new(file);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            let n = reader.read_until(b'\n', &mut buf)?;
            if n == 0 {
                return Ok(None);
            }
            if !buf.ends_with(b"\n") {
                return Ok(None);
            }
            let line = match std::str::from_utf8(&buf) {
                Ok(s) => s.trim(),
                Err(_) => continue,
            };
            if line.is_empty() {
                continue;
            }
            if let Ok(ev) = Event::from_ndjson(line) {
                return Ok(Some(ev));
            }
        }
    }

    /// Primitive legacy mantenuta nei test per verificare la lettura di dataset
    /// prodotti dalle versioni che troncavano il proprio log.
    #[cfg(test)]
    pub fn compact(&self, keep_recent: usize) -> io::Result<usize> {
        let path = self.own_path();
        let read = Self::read_from(&path, 0)?;
        if let Some(corruption) = read.corruption {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "log corrotto a byte {}: {}",
                    corruption.offset, corruption.reason
                ),
            ));
        }
        let events = read.events;
        if events.len() <= keep_recent {
            return Ok(0);
        }
        let drop_n = events.len() - keep_recent;
        let kept = &events[drop_n..];

        let tmp = self.events_dir.join(format!("{}.ndjson.tmp", self.device));
        {
            let mut f = File::create(&tmp)?;
            for ev in kept {
                let line = ev
                    .to_ndjson()
                    .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
                f.write_all(line.as_bytes())?;
                f.write_all(b"\n")?;
            }
            f.flush()?;
            f.sync_all()?;
        }
        fs::rename(&tmp, &path)?;
        Ok(drop_n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::event::EventBody;
    use crate::sync::hlc::Hlc;

    fn ev(n: u32) -> Event {
        Event::new(
            Hlc::new(1000, n, "PC-A"),
            "PC-A",
            "Livio",
            "order",
            format!("01ORDER{n}"),
            EventBody::Created,
        )
    }

    #[test]
    fn append_e_lettura_incrementale() {
        let dir = tempfile::tempdir().unwrap();
        let log = LogStore::new(dir.path().join("events"), "PC-A").unwrap();
        log.append_many(&[ev(0), ev(1)]).unwrap();

        let path = log.own_path();
        let r1 = LogStore::read_from(&path, 0).unwrap();
        assert_eq!(r1.events.len(), 2);

        // append di un terzo evento: leggendo dall'offset precedente vedo solo quello nuovo
        log.append(&ev(2)).unwrap();
        let r2 = LogStore::read_from(&path, r1.consumed).unwrap();
        assert_eq!(r2.events.len(), 1);
        assert_eq!(r2.events[0].entity_id, "01ORDER2");
    }

    #[test]
    fn riga_troncata_viene_scartata_e_riletta_quando_completa() {
        let dir = tempfile::tempdir().unwrap();
        let events = dir.path().join("events");
        let log = LogStore::new(&events, "PC-A").unwrap();
        log.append(&ev(0)).unwrap();

        // Simulo un blackout: scrivo una riga JSON incompleta SENZA '\n'.
        let path = log.own_path();
        {
            let mut f = OpenOptions::new().append(true).open(&path).unwrap();
            f.write_all(b"{\"id\":\"01J\",\"ts\":\"00").unwrap();
        }

        let r = LogStore::read_from(&path, 0).unwrap();
        assert_eq!(
            r.events.len(),
            1,
            "la riga troncata non deve essere contata"
        );

        // Completo la riga troncata (come farebbe il prosieguo della scrittura).
        // Per semplicità sovrascrivo con un file pulito di 2 eventi.
        fs::write(&path, "").unwrap();
        log.append(&ev(0)).unwrap();
        log.append(&ev(1)).unwrap();
        let r2 = LogStore::read_from(&path, 0).unwrap();
        assert_eq!(r2.events.len(), 2);
    }

    #[test]
    fn compact_tiene_solo_gli_ultimi_n() {
        let dir = tempfile::tempdir().unwrap();
        let log = LogStore::new(dir.path().join("events"), "PC-A").unwrap();
        for i in 0..10 {
            log.append(&ev(i)).unwrap();
        }
        assert_eq!(log.compact(4).unwrap(), 6, "eliminati i 6 più vecchi");

        let r = LogStore::read_from(&log.own_path(), 0).unwrap();
        assert_eq!(r.events.len(), 4);
        assert_eq!(r.events[0].entity_id, "01ORDER6", "tiene gli ultimi 4");
        assert_eq!(r.events[3].entity_id, "01ORDER9");

        // Compattare di nuovo con una soglia più alta del contenuto non elimina nulla.
        assert_eq!(log.compact(100).unwrap(), 0);
    }

    #[test]
    fn conflicted_copy_e_altri_ndjson_sono_elencati() {
        let dir = tempfile::tempdir().unwrap();
        let events = dir.path().join("events");
        let log = LogStore::new(&events, "PC-A").unwrap();
        log.append(&ev(0)).unwrap();
        // file di un altro device + una conflicted copy creata "da OneDrive"
        fs::write(events.join("PC-B.ndjson"), "").unwrap();
        fs::write(events.join("PC-A - conflicted copy.ndjson"), "").unwrap();
        fs::write(events.join("note.txt"), "ignorami").unwrap();

        let files = log.ndjson_files().unwrap();
        let names: Vec<String> = files
            .iter()
            .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert!(names.contains(&"PC-A.ndjson".to_string()));
        assert!(names.contains(&"PC-B.ndjson".to_string()));
        assert!(names.contains(&"PC-A - conflicted copy.ndjson".to_string()));
        assert!(!names.iter().any(|n| n == "note.txt"));
    }

    #[test]
    fn riga_corrotta_non_viene_consumata_ne_nasconde_la_coda() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("PC-A.ndjson");
        let first = ev(0).to_ndjson().unwrap();
        let last = ev(1).to_ndjson().unwrap();
        fs::write(&path, format!("{first}\nnon-json\n{last}\n")).unwrap();

        let read = LogStore::read_from(&path, 0).unwrap();
        assert_eq!(read.events.len(), 1);
        assert!(read.corruption.is_some());
        assert_eq!(read.consumed, first.len() as u64 + 1);

        fs::write(&path, format!("{first}\n{last}\n")).unwrap();
        let repaired = LogStore::read_from(&path, read.consumed).unwrap();
        assert_eq!(repaired.events.len(), 1);
        assert_eq!(repaired.events[0].entity_id, "01ORDER1");
        assert!(repaired.corruption.is_none());
    }
}
