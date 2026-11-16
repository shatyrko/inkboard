//! The cryptographic pieces of the pairing handshake: Diffie-Hellman (RFC 3526 group 14), PBKDF2 key derivation,
//! HMAC-SHA256 and the reader's AES-CBC "wrap" format (data + 8 byte HMAC tag, PKCS#7 padded, IV appended).

use aes::Aes128;
use cbc::cipher::{block_padding::NoPadding, BlockModeDecrypt, BlockModeEncrypt, KeyIvInit};
use hmac::{Hmac, KeyInit, Mac};
use num_bigint::BigUint;
use sha2::Sha256;

use crate::error::{Error, Result};

const MODP_2048_HEX: &str = include_str!("modp2048.hex");

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    getrandom::fill(&mut buf).expect("the operating system has no random number generator");
    buf
}

pub fn hmac_sha256(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(key).expect("HMAC accepts keys of any length");
    for p in parts {
        mac.update(p);
    }
    mac.finalize().into_bytes().into()
}

pub struct DiffieHellman {
    p: BigUint,
    private: BigUint,
}

impl DiffieHellman {
    pub fn new() -> Self {
        let p = BigUint::parse_bytes(MODP_2048_HEX.trim().as_bytes(), 16).expect("embedded prime is valid hex");
        // 256 random bits are plenty for a 2048-bit group and match the reader's own client
        let private = BigUint::from_bytes_be(&random_bytes::<32>());
        Self { p, private }
    }

    /// g^a mod p with g = 2
    pub fn public(&self) -> BigUint {
        BigUint::from(2u8).modpow(&self.private, &self.p)
    }

    /// The shared secret, as 256 big-endian bytes. Rejects values outside the prime-order subgroup.
    pub fn shared(&self, other: &BigUint) -> Result<[u8; 256]> {
        let two = BigUint::from(2u8);
        let one = BigUint::from(1u8);
        let upper = &self.p - &two;
        let q = (&self.p - &one) >> 1u32;
        if *other < two || *other > upper || other.modpow(&q, &self.p) != one {
            return Err(Error::Pairing("the reader sent an invalid key-exchange value".into()));
        }
        let bytes = other.modpow(&self.private, &self.p).to_bytes_be();
        let mut out = [0u8; 256];
        out[256 - bytes.len()..].copy_from_slice(&bytes);
        Ok(out)
    }
}

/// PBKDF2-HMAC-SHA256 (10 000 rounds) split into a 32 byte auth key and a 16 byte AES key.
pub fn derive_keys(shared: &[u8], salt: &[u8]) -> ([u8; 32], [u8; 16]) {
    let mut out = [0u8; 48];
    pbkdf2::pbkdf2_hmac::<Sha256>(shared, salt, 10_000, &mut out);
    let mut auth = [0u8; 32];
    let mut wrap = [0u8; 16];
    auth.copy_from_slice(&out[..32]);
    wrap.copy_from_slice(&out[32..]);
    (auth, wrap)
}

fn pad(data: &[u8]) -> Vec<u8> {
    let n = 16 - data.len() % 16;
    let mut v = data.to_vec();
    v.extend(std::iter::repeat(n as u8).take(n));
    v
}

pub fn wrap_with_iv(data: &[u8], auth_key: &[u8], wrap_key: &[u8; 16], iv: [u8; 16]) -> Vec<u8> {
    let tag = hmac_sha256(auth_key, &[data]);
    let mut plain = data.to_vec();
    plain.extend_from_slice(&tag[..8]);
    let padded = pad(&plain);
    let enc = cbc::Encryptor::<Aes128>::new(wrap_key.into(), &iv.into());
    let mut out = enc.encrypt_padded_vec::<NoPadding>(&padded);
    out.extend_from_slice(&iv);
    out
}

pub fn wrap(data: &[u8], auth_key: &[u8], wrap_key: &[u8; 16]) -> Vec<u8> {
    wrap_with_iv(data, auth_key, wrap_key, random_bytes::<16>())
}

pub fn unwrap(data: &[u8], auth_key: &[u8], wrap_key: &[u8; 16]) -> Result<Vec<u8>> {
    if data.len() < 32 || (data.len() - 16) % 16 != 0 {
        return Err(Error::Pairing("malformed wrapped value".into()));
    }
    let (body, iv) = data.split_at(data.len() - 16);
    let iv: [u8; 16] = iv.try_into().expect("split at 16");
    let dec = cbc::Decryptor::<Aes128>::new(wrap_key.into(), &iv.into());
    let plain = dec
        .decrypt_padded_vec::<NoPadding>(body)
        .map_err(|_| Error::Pairing("malformed wrapped value".into()))?;
    let pad_len = *plain.last().unwrap_or(&0) as usize;
    if pad_len == 0 || pad_len > 16 || pad_len > plain.len() {
        return Err(Error::Pairing("wrapped value has bad padding".into()));
    }
    let unpadded = &plain[..plain.len() - pad_len];
    if unpadded.len() < 8 {
        return Err(Error::Pairing("wrapped value is too short".into()));
    }
    let (value, tag) = unpadded.split_at(unpadded.len() - 8);
    if hmac_sha256(auth_key, &[value])[..8] != *tag {
        return Err(Error::Pairing("wrapped value failed its integrity check".into()));
    }
    Ok(value.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrap_round_trips() {
        let auth = [7u8; 32];
        let key = [9u8; 16];
        for len in [0usize, 1, 15, 16, 17, 255] {
            let data: Vec<u8> = (0..len).map(|i| i as u8).collect();
            assert_eq!(unwrap(&wrap(&data, &auth, &key), &auth, &key).unwrap(), data);
        }
    }

    /// Produced by the reference implementation (dpt-rp1-py) with fixed inputs; both directions must agree byte for byte.
    #[test]
    fn wrap_matches_reference_vector() {
        let auth: Vec<u8> = (0..32).collect();
        let key: [u8; 16] = core::array::from_fn(|i| i as u8);
        let iv: [u8; 16] = core::array::from_fn(|i| 16 + i as u8);
        let expected = "fe1df141dc68e96acbdefc7296072719d5a4b43899d7580a4d162295b47693173d12294a7e61d853c2bb5cf7687f65f9101112131415161718191a1b1c1d1e1f";
        let wrapped = wrap_with_iv(b"reference vector payload", &auth, &key, iv);
        let hexed: String = wrapped.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hexed, expected);
        assert_eq!(unwrap(&wrapped, &auth, &key).unwrap(), b"reference vector payload");
    }

    #[test]
    fn unwrap_detects_tampering() {
        let auth = [1u8; 32];
        let key = [2u8; 16];
        let mut w = wrap(b"hello reader", &auth, &key);
        w[0] ^= 0x55;
        assert!(unwrap(&w, &auth, &key).is_err());
        assert!(unwrap(&wrap(b"hello reader", &auth, &key), &[3u8; 32], &key).is_err());
    }

    #[test]
    fn dh_both_sides_agree() {
        let a = DiffieHellman::new();
        let b = DiffieHellman::new();
        assert_eq!(a.shared(&b.public()).unwrap(), b.shared(&a.public()).unwrap());
    }

    #[test]
    fn dh_rejects_degenerate_values() {
        let a = DiffieHellman::new();
        assert!(a.shared(&BigUint::from(0u8)).is_err());
        assert!(a.shared(&BigUint::from(1u8)).is_err());
        let p = BigUint::parse_bytes(MODP_2048_HEX.trim().as_bytes(), 16).unwrap();
        assert!(a.shared(&(p - 1u8)).is_err());
    }

    #[test]
    fn pbkdf2_hmac_sha256_known_vector() {
        // RFC 7914 section 11: PBKDF2-HMAC-SHA-256("passwd", "salt", 1, 64) starts with 55ac046e56e3089f...
        let mut out = [0u8; 16];
        pbkdf2::pbkdf2_hmac::<Sha256>(b"passwd", b"salt", 1, &mut out);
        assert_eq!(out, [0x55, 0xac, 0x04, 0x6e, 0x56, 0xe3, 0x08, 0x9f, 0xec, 0x16, 0x91, 0xc2, 0x25, 0x44, 0xb6, 0x05]);
    }

    #[test]
    fn hmac_sha256_known_vector() {
        // RFC 4231 test case 2
        let mac = hmac_sha256(b"Jefe", &[b"what do ya want ", b"for nothing?"]);
        assert_eq!(
            mac[..8],
            [0x5b, 0xdc, 0xc1, 0x46, 0xbf, 0x60, 0x75, 0x4e]
        );
    }
}
