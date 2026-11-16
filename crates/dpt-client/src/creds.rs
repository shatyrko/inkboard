//! The key pair that identifies this computer to a reader after pairing. The file names match the ones used by
//! the open-source dpt-rp1-py tool, so keys made by either program work in the other.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use rsa::pkcs1::{DecodeRsaPrivateKey, EncodeRsaPrivateKey};
use rsa::pkcs8::DecodePrivateKey;
use rsa::PrivateKey;

use crate::error::{Error, Result};

pub const CLIENT_ID_FILE: &str = "deviceid.dat";
pub const PRIVATE_KEY_FILE: &str = "privatekey.dat";

#[derive(Clone)]
pub struct Credentials {
    pub client_id: String,
    /// PEM text, PKCS#1 ("RSA PRIVATE KEY") or PKCS#8
    pub private_key_pem: String,
}

impl std::fmt::Debug for Credentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credentials").field("client_id", &"<redacted>").field("private_key_pem", &"<redacted>").finish()
    }
}

impl Credentials {
    pub fn new(client_id: String, private_key_pem: String) -> Self {
        Self { client_id, private_key_pem }
    }

    pub fn private_key(&self) -> Result<PrivateKey> {
        let pem = self.private_key_pem.trim();
        PrivateKey::from_pkcs1_pem(pem)
            .or_else(|_| PrivateKey::from_pkcs8_pem(pem))
            .map_err(|e| Error::Key(format!("unreadable private key: {e}")))
    }

    /// Sign the reader's nonce (RSA PKCS#1 v1.5 over SHA-256) and return it base64 encoded.
    pub fn sign_nonce(&self, nonce: &str) -> Result<String> {
        use base64::Engine;
        let key = self.private_key()?;
        let sig = key.pkcs1v15_sign::<rsa::sha2::Sha256>(nonce.as_bytes()).map_err(|e| Error::Key(format!("signing failed: {e}")))?;
        Ok(base64::engine::general_purpose::STANDARD.encode(sig.to_vec()))
    }

    pub fn exists_in(dir: &Path) -> bool {
        dir.join(CLIENT_ID_FILE).is_file() && dir.join(PRIVATE_KEY_FILE).is_file()
    }

    pub fn load_from(dir: &Path) -> Result<Credentials> {
        let id = fs::read_to_string(dir.join(CLIENT_ID_FILE))?;
        let pem = fs::read_to_string(dir.join(PRIVATE_KEY_FILE))?;
        let creds = Credentials::new(id.trim().to_string(), pem);
        creds.private_key()?; // fail early on a corrupt file
        Ok(creds)
    }

    /// Writes both files, readable by the owner only.
    pub fn save_to(&self, dir: &Path) -> Result<()> {
        fs::create_dir_all(dir)?;
        write_private(&dir.join(CLIENT_ID_FILE), self.client_id.as_bytes())?;
        write_private(&dir.join(PRIVATE_KEY_FILE), self.private_key_pem.as_bytes())?;
        Ok(())
    }

    pub fn delete_from(dir: &Path) {
        let _ = fs::remove_file(dir.join(CLIENT_ID_FILE));
        let _ = fs::remove_file(dir.join(PRIVATE_KEY_FILE));
    }

    /// Where dpt-rp1-py keeps its keys: `~/.config/dpt`.
    pub fn legacy_dir() -> Option<PathBuf> {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config").join("dpt"))
    }

    pub fn pem_from_key(key: &PrivateKey) -> Result<String> {
        let pem = key.to_pkcs1_pem(rsa::pkcs1::LineEnding::LF).map_err(|e| Error::Key(e.to_string()))?;
        Ok(pem.to_string())
    }
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
        f.write_all(bytes)?;
        // an existing file keeps its old mode when truncated
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    {
        let mut f = fs::File::create(path)?;
        f.write_all(bytes)?;
    }
    Ok(())
}
