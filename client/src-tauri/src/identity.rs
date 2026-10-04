use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use argon2::Argon2;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ed25519_dalek::{Signer, SigningKey};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use zeroize::Zeroizing;
pub fn load(path: &Path) -> Result<SigningKey, String> {
    if !path.exists() {
        if let Some(p) = path.parent() {
            fs::create_dir_all(p).map_err(err)?;
        }
        let key = SigningKey::generate(&mut OsRng);
        store(path, &key)?;
        return Ok(key);
    };
    let bytes = Zeroizing::new(unprotect(&fs::read(path).map_err(err)?)?);
    let seed: [u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| "Invalid identity length")?;
    Ok(SigningKey::from_bytes(&seed))
}
pub fn store(path: &Path, key: &SigningKey) -> Result<(), String> {
    let protected = protect(&key.to_bytes())?;
    let temp = path.with_extension("tmp");
    fs::write(&temp, protected).map_err(err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temp, fs::Permissions::from_mode(0o600)).map_err(err)?;
    }
    if path.exists() {
        fs::copy(path, path.with_extension("previous")).map_err(err)?;
    }
    fs::rename(&temp, path).map_err(err)
}
pub fn public(key: &SigningKey) -> String {
    B64.encode(key.verifying_key().to_bytes())
}
pub fn sign(key: &SigningKey, context: &str) -> Result<String, String> {
    if !context.starts_with("licra:v1\n")
        || context.len() > 2048
        || context.lines().last() != Some(public(key).as_str())
    {
        return Err("Invalid identity challenge".into());
    };
    Ok(B64.encode(key.sign(context.as_bytes()).to_bytes()))
}
#[derive(Serialize, Deserialize)]
pub struct Backup {
    version: u8,
    salt: String,
    nonce: String,
    ciphertext: String,
}
fn derive(passphrase: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    if passphrase.chars().count() < 10 || passphrase.len() > 1024 {
        return Err("Passphrase: 10 characters minimum, 1024 bytes maximum".into());
    };
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, key.as_mut())
        .map_err(err)?;
    Ok(key)
}
pub fn export(key: &SigningKey, passphrase: &str) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; 32];
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    let derived = derive(passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(derived.as_ref()).map_err(err)?;
    let seed = Zeroizing::new(key.to_bytes());
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), seed.as_ref())
        .map_err(err)?;
    serde_json::to_vec_pretty(&Backup {
        version: 1,
        salt: B64.encode(salt),
        nonce: B64.encode(nonce),
        ciphertext: B64.encode(ciphertext),
    })
    .map_err(err)
}
pub fn import(data: &[u8], passphrase: &str) -> Result<SigningKey, String> {
    if data.len() > 4096 {
        return Err("Identity backup too large".into());
    };
    let b: Backup = serde_json::from_slice(data).map_err(err)?;
    if b.version != 1 {
        return Err("Unsupported backup version".into());
    };
    let salt = B64.decode(b.salt).map_err(err)?;
    let nonce = B64.decode(b.nonce).map_err(err)?;
    if salt.len() != 32 || nonce.len() != 12 {
        return Err("Invalid backup".into());
    };
    let derived = derive(passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(derived.as_ref()).map_err(err)?;
    let bytes = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                B64.decode(b.ciphertext).map_err(err)?.as_ref(),
            )
            .map_err(|_| "Incorrect passphrase or damaged backup")?,
    );
    let seed: [u8; 32] = bytes.as_slice().try_into().map_err(|_| "Invalid key")?;
    Ok(SigningKey::from_bytes(&seed))
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[cfg(not(windows))]
fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(data.to_vec())
}
#[cfg(not(windows))]
fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    Ok(data.to_vec())
}
#[cfg(windows)]
fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(data, true)
}
#[cfg(windows)]
fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    dpapi(data, false)
}
#[cfg(windows)]
fn dpapi(data: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    unsafe {
        let ok = if encrypt {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        } else {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        };
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData as _);
        Ok(result)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persistent_identity() {
        let mut random = [0u8; 8];
        OsRng.fill_bytes(&mut random);
        let directory =
            std::env::temp_dir().join(format!("licra-identity-{}", u64::from_le_bytes(random)));
        fs::create_dir_all(&directory).expect("temp dir");
        let path = directory.join("identity.dpapi");
        let first = load(&path).expect("first identity");
        let second = load(&path).expect("persistent identity");
        assert_eq!(public(&first), public(&second));
        #[cfg(windows)]
        assert_ne!(
            fs::read(&path).expect("read").as_slice(),
            first.to_bytes().as_slice()
        );
        let replacement = SigningKey::generate(&mut OsRng);
        store(&path, &replacement).expect("import replacement");
        assert_eq!(public(&replacement), public(&load(&path).expect("reload")));
        assert!(path.with_extension("previous").exists());
        fs::remove_dir_all(directory).expect("cleanup");
    }
    #[test]
    fn encrypted_roundtrip() {
        let k = SigningKey::generate(&mut OsRng);
        let b = export(&k, "a sufficiently long passphrase").expect("export");
        assert!(!String::from_utf8_lossy(&b).contains(&B64.encode(k.to_bytes())));
        let other = import(&b, "a sufficiently long passphrase").expect("import");
        assert_eq!(public(&k), public(&other));
        assert!(import(&b, "a wrong long passphrase").is_err());
        assert!(import(b"{}", "long password").is_err());
    }
}
