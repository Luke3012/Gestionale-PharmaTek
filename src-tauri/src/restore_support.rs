use std::fs::File;
use std::io::{Read, Result};
use std::path::Path;

/// Calcola il checksum FNV-1a usato dal manifest di ripristino per verificare
/// che OneDrive abbia consegnato esattamente i byte attesi.
pub(crate) fn checksum_file(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    checksum_reader(&mut file, None).map(|(_, checksum)| checksum)
}

/// Legge lunghezza e checksum dallo stesso stream. È usato quando un log può
/// crescere mentre viene creato il manifest: una `metadata()` separata potrebbe
/// descrivere un prefisso diverso da quello effettivamente sottoposto a checksum.
pub(crate) fn checksum_file_with_len(path: &Path) -> Result<(u64, String)> {
    let mut file = File::open(path)?;
    checksum_reader(&mut file, None)
}

/// Verifica il prefisso immutabile di un log append-only. Dopo un ripristino il
/// file può legittimamente crescere prima che OneDrive lo consegni a un altro PC:
/// il checksum dell'intero file non sarebbe quindi più uguale al manifest, mentre
/// i primi `bytes` devono restare identici.
pub(crate) fn checksum_file_prefix(path: &Path, bytes: u64) -> Result<String> {
    let mut file = File::open(path)?;
    checksum_reader(&mut file, Some(bytes)).map(|(_, checksum)| checksum)
}

fn checksum_reader(reader: &mut impl Read, limite: Option<u64>) -> Result<(u64, String)> {
    let mut hash: u64 = 0xcbf29ce484222325;
    let mut buffer = [0u8; 64 * 1024];
    let mut rimanenti = limite.unwrap_or(u64::MAX);
    let mut totali = 0u64;
    loop {
        if rimanenti == 0 {
            break;
        }
        let richiesti = usize::try_from(rimanenti.min(buffer.len() as u64)).unwrap_or(buffer.len());
        let letti = reader.read(&mut buffer[..richiesti])?;
        if letti == 0 {
            if limite.is_some() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "file più corto del prefisso dichiarato nel manifest",
                ));
            }
            break;
        }
        for byte in &buffer[..letti] {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        totali += letti as u64;
        rimanenti = rimanenti.saturating_sub(letti as u64);
    }
    Ok((totali, format!("{hash:016x}")))
}

/// Dati tecnici runtime che non devono essere archiviati nel backup né inclusi
/// nel manifest del payload ripristinato.
pub(crate) fn is_restore_runtime_artifact(rel: &str) -> bool {
    rel == "meta/locks"
        || rel.starts_with("meta/locks/")
        || rel == "meta/restore_coordination"
        || rel.starts_with("meta/restore_coordination/")
        || (rel.starts_with("events/.restore-") && rel.ends_with(".marker"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checksum_fnv1a_ha_valore_stabile() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hello.bin");
        std::fs::write(&path, b"hello").unwrap();

        assert_eq!(checksum_file(&path).unwrap(), "a430d84680aabd0b");
    }

    #[test]
    fn checksum_prefisso_ignora_la_coda_ma_non_un_file_troncato() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("log.ndjson");
        std::fs::write(&path, b"hello-coda").unwrap();

        assert_eq!(checksum_file_prefix(&path, 5).unwrap(), "a430d84680aabd0b");
        assert_eq!(
            checksum_file_prefix(&path, 10).unwrap(),
            checksum_file(&path).unwrap()
        );
        assert_eq!(checksum_file_with_len(&path).unwrap().0, 10);
        assert_eq!(
            checksum_file_prefix(&path, 11).unwrap_err().kind(),
            std::io::ErrorKind::UnexpectedEof
        );
    }

    #[test]
    fn riconosce_solo_gli_artefatti_runtime_del_restore() {
        for rel in [
            "meta/locks",
            "meta/locks/PC-A.json",
            "meta/restore_coordination",
            "meta/restore_coordination/committed-R1.json",
            "events/.restore-PC-A-123.marker",
        ] {
            assert!(
                is_restore_runtime_artifact(rel),
                "{rel} deve essere escluso"
            );
        }

        for rel in [
            "events/PC-A.ndjson",
            "snapshots/PC-A-00000001.json",
            "meta/avatars/U1.png",
            "events/.restore-PC-A-123.marker.bak",
            "meta/locks-archivio/PC-A.json",
        ] {
            assert!(
                !is_restore_runtime_artifact(rel),
                "{rel} deve restare nel payload"
            );
        }
    }
}
