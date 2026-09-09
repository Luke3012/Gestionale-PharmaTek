//! Verifica Minisign condivisa dal controllo remoto e dalla reinstallazione
//! forzata. La chiave deve restare allineata a `tauri.conf.json`.

use base64::Engine;

pub(crate) const APP_SIGNING_PUBKEY: &str = "untrusted comment: minisign public key: DE20386213E9D6AE\nRWSu1ukTYjgg3tb/zeFpm8Oz2Lb7Qn0OihKBYRa+lR0ETsPBnvevkzVj\n";

pub(crate) fn verify_signed_payload(
    payload: &[u8],
    encoded_signature: &str,
    context: &str,
) -> Result<(), String> {
    let public_key = minisign_verify::PublicKey::decode(APP_SIGNING_PUBKEY)
        .map_err(|error| format!("chiave pubblica {context} non valida: {error}"))?;
    let signature_text = base64::engine::general_purpose::STANDARD
        .decode(encoded_signature.trim())
        .map_err(|error| format!("firma {context} non decodificabile: {error}"))?;
    let signature_text = String::from_utf8(signature_text)
        .map_err(|error| format!("firma {context} non testuale: {error}"))?;
    let signature = minisign_verify::Signature::decode(&signature_text)
        .map_err(|error| format!("firma {context} non leggibile: {error}"))?;
    public_key
        .verify(payload, &signature, false)
        .map_err(|error| format!("firma {context} non valida: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONTROL_JSON: &[u8] = include_bytes!("../../.updater/control.json");
    const CONTROL_SIGNATURE: &str = include_str!("../../.updater/control.json.sig");

    #[test]
    fn firma_reale_del_controllo_remoto_e_valida() {
        verify_signed_payload(CONTROL_JSON, CONTROL_SIGNATURE, "test").unwrap();
    }

    #[test]
    fn firma_rifiuta_un_payload_modificato() {
        let mut modified = CONTROL_JSON.to_vec();
        modified.push(b' ');
        assert!(verify_signed_payload(&modified, CONTROL_SIGNATURE, "test").is_err());
    }

    #[test]
    fn chiave_tauri_e_quella_usata_dalla_reinstallazione() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let encoded = config["plugins"]["updater"]["pubkey"]
            .as_str()
            .expect("pubkey updater");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("pubkey base64");
        assert_eq!(String::from_utf8(decoded).unwrap(), APP_SIGNING_PUBKEY);
    }
}
