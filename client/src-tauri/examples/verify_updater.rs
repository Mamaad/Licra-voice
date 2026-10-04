use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use std::{env, fs};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().collect();
    if args.len() != 4 {
        return Err("Usage: verify_updater public.key setup.exe.sig setup.exe".into());
    }
    let public = PublicKey::decode(&String::from_utf8(
        STANDARD.decode(fs::read_to_string(&args[1])?.trim())?,
    )?)?;
    let signature = Signature::decode(&String::from_utf8(
        STANDARD.decode(fs::read_to_string(&args[2])?.trim())?,
    )?)?;
    let mut artifact = fs::read(&args[3])?;
    public.verify(&artifact, &signature, true)?;
    if artifact.is_empty() {
        return Err("Empty artifact".into());
    };
    artifact[0] ^= 1;
    if public.verify(&artifact, &signature, true).is_ok() {
        return Err("Tampered artifact accepted".into());
    };
    println!("Signature verified; tampered artifact rejected");
    Ok(())
}
