//! Pairing: how a computer becomes a known client of a reader.
//!
//! The reader shows a PIN on its screen; the handshake proves both sides know it without sending it, then the reader's
//! CA certifies a fresh RSA key pair that this computer generates. Two phases because a human sits in between:
//! [`PairingSession::start`] makes the reader show the PIN, [`PairingSession::finish`] takes what the user read off the screen.

use base64::Engine;
use num_bigint::BigUint;
use rsa::pkcs8::EncodePublicKey;
use rsa::PrivateKey;
use serde_json::{json, Value};
use ureq::{Agent, SendBody};

use crate::client::{error_from_response, make_agent, Config};
use crate::creds::Credentials;
use crate::crypto::{derive_keys, hmac_sha256, random_bytes, unwrap, wrap, DiffieHellman};
use crate::error::{Error, Result};

fn b64(data: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(data)
}
fn unb64(v: &Value, key: &str) -> Result<Vec<u8>> {
    let s = v.get(key).and_then(Value::as_str).ok_or_else(|| Error::Pairing(format!("the reader's reply is missing \"{key}\"")))?;
    base64::engine::general_purpose::STANDARD.decode(s.as_bytes()).map_err(|_| Error::Pairing(format!("\"{key}\" is not valid base64")))
}

pub struct Pairing {
    pub credentials: Credentials,
    /// The reader's own CA-issued certificate (PEM); kept for anyone who wants to pin it.
    pub device_certificate: String,
}

pub struct PairingSession {
    cfg: Config,
    agent: Agent,
    auth_key: [u8; 32],
    wrap_key: [u8; 16],
    n1: Vec<u8>,
    n2: [u8; 16],
    mac: Vec<u8>,
    ya: Vec<u8>,
    yb: Vec<u8>,
    m3_hmac: Vec<u8>,
    e_hash: Vec<u8>,
    m2_hmac: [u8; 32],
}

impl PairingSession {
    fn call(agent: &Agent, cfg: &Config, method: &str, path: &str, body: Option<&Value>) -> Result<Value> {
        let url = cfg.reg_url(path);
        let bytes = body.map(serde_json::to_vec).transpose()?;
        let mut b = ureq::http::Request::builder().method(method).uri(url);
        let req = match &bytes {
            Some(data) => {
                b = b.header("Content-Type", "application/json").header("Content-Length", data.len().to_string());
                b.body(SendBody::from_owned_reader(std::io::Cursor::new(data.clone())))
            }
            None => b.body(SendBody::none()),
        }
        .map_err(|e| Error::Protocol(e.to_string()))?;
        let mut resp = agent.run(req)?;
        let status = resp.status().as_u16();
        let text = resp.body_mut().read_to_string().unwrap_or_default();
        if status >= 400 {
            return Err(match error_from_response(status, &text) {
                Error::Api { message, .. } => Error::Pairing(format!("the reader said no ({status}): {message}")),
                other => other,
            });
        }
        if text.trim().is_empty() {
            Ok(Value::Null)
        } else {
            Ok(serde_json::from_str(&text)?)
        }
    }

    /// Asks the reader to display a PIN and runs the first half of the handshake.
    pub fn start(cfg: Config) -> Result<PairingSession> {
        let agent = make_agent();
        Self::call(&agent, &cfg, "PUT", "/register/cleanup", None)?;
        let m1 = Self::call(&agent, &cfg, "POST", "/register/pin", None)?;

        let n1 = unb64(&m1, "a")?;
        let mac = unb64(&m1, "b")?;
        // Keep the reader's exact bytes for yb: it is a Java device and builds its HMACs from BigInteger.toByteArray(),
        // which prepends a zero byte when the top bit is set. Re-encoding to a fixed width would break the HMAC about half the time.
        let yb = unb64(&m1, "c")?;
        let yb_int = BigUint::from_bytes_be(&yb);
        let n2 = random_bytes::<16>();

        let dh = DiffieHellman::new();
        let mut ya = vec![0u8];
        let public = dh.public().to_bytes_be();
        ya.extend(std::iter::repeat(0u8).take(256 - public.len()));
        ya.extend(public);

        let shared = dh.shared(&yb_int)?;
        let salt: Vec<u8> = [n1.as_slice(), mac.as_slice(), n2.as_slice()].concat();
        let (auth_key, wrap_key) = derive_keys(&shared, &salt);

        let m2_hmac = hmac_sha256(&auth_key, &[&n1, &mac, &yb, &n1, &n2, &mac, &ya]);
        let m2 = json!({ "a": b64(&n1), "b": b64(&n2), "c": b64(&mac), "d": b64(&ya), "e": b64(&m2_hmac) });
        let m3 = Self::call(&agent, &cfg, "POST", "/register/hash", Some(&m2))?;

        if unb64(&m3, "a")? != n2 {
            return Err(Error::Pairing("the reader's first reply does not match this request".into()));
        }
        let e_hash = unb64(&m3, "b")?;
        let m3_hmac = unb64(&m3, "e")?;
        if hmac_sha256(&auth_key, &[&n1, &n2, &mac, &ya, &m2_hmac, &n2, &e_hash]).as_slice() != m3_hmac.as_slice() {
            return Err(Error::Pairing("the reader's first reply failed its integrity check".into()));
        }
        Ok(PairingSession { cfg, agent, auth_key, wrap_key, n1, n2, mac, ya, yb, m3_hmac, e_hash, m2_hmac })
    }

    /// Completes the handshake with the PIN shown on the reader and returns the new credentials.
    pub fn finish(self, pin: &str) -> Result<Pairing> {
        let pin = pin.trim();
        let psk = hmac_sha256(&self.auth_key, &[pin.as_bytes()]);

        let rs = random_bytes::<16>();
        let r_hash = hmac_sha256(&self.auth_key, &[&rs, &psk, &self.yb, &self.ya]);
        let wrapped_rs = wrap(&rs, &self.auth_key, &self.wrap_key);
        let m4_hmac = hmac_sha256(&self.auth_key, &[&self.n2, &self.e_hash, &self.m3_hmac, &self.n1, &r_hash, &wrapped_rs]);
        let m4 = json!({ "a": b64(&self.n1), "b": b64(&r_hash), "d": b64(&wrapped_rs), "e": b64(&m4_hmac) });
        let m5 = Self::call(&self.agent, &self.cfg, "POST", "/register/ca", Some(&m4)).map_err(|e| match e {
            Error::Pairing(m) => Error::Pairing(format!("{m}. Check the PIN and try again; a PIN works once.")),
            other => other,
        })?;

        if unb64(&m5, "a")? != self.n2 {
            return Err(Error::Pairing("the reader's certificate reply does not match this request".into()));
        }
        let wrapped_cert = unb64(&m5, "d")?;
        let m5_hmac = unb64(&m5, "e")?;
        if hmac_sha256(&self.auth_key, &[&self.n1, &r_hash, &wrapped_rs, &m4_hmac, &self.n2, &wrapped_cert]).as_slice() != m5_hmac.as_slice() {
            return Err(Error::Pairing("the reader's certificate reply failed its integrity check".into()));
        }
        let es_cert = unwrap(&wrapped_cert, &self.auth_key, &self.wrap_key)?;
        if es_cert.len() < 16 {
            return Err(Error::Pairing("the reader's certificate reply is too short".into()));
        }
        let (es, cert) = es_cert.split_at(16);
        if hmac_sha256(&self.auth_key, &[es, &psk, &self.yb, &self.ya]).as_slice() != self.e_hash.as_slice() {
            return Err(Error::Pairing("the PIN does not match".into()));
        }

        let key = PrivateKey::new(&mut getrandom::SysRng, 2048).map_err(|e| Error::Key(format!("could not generate a key: {e}")))?;
        let public_pem = key.to_public_key().to_public_key_pem(rsa::pkcs8::LineEnding::LF).map_err(|e| Error::Key(e.to_string()))?;
        let client_id = uuid_v4();
        let payload: Vec<u8> = [client_id.as_bytes(), public_pem.trim_end().as_bytes()].concat();
        let wrapped_payload = wrap(&payload, &self.auth_key, &self.wrap_key);
        let m6_hmac = hmac_sha256(&self.auth_key, &[&self.n2, &wrapped_cert, &m5_hmac, &self.n1, &wrapped_payload]);
        let m6 = json!({ "a": b64(&self.n1), "d": b64(&wrapped_payload), "e": b64(&m6_hmac) });
        Self::call(&self.agent, &self.cfg, "POST", "/register", Some(&m6))?;
        let _ = Self::call(&self.agent, &self.cfg, "PUT", "/register/cleanup", None);

        let _ = (&self.mac, &self.m2_hmac);
        Ok(Pairing {
            credentials: Credentials::new(client_id, Credentials::pem_from_key(&key)?),
            device_certificate: String::from_utf8_lossy(cert).into_owned(),
        })
    }
}

fn uuid_v4() -> String {
    let mut b = random_bytes::<16>();
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h = crate::client::hex(&b);
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

#[cfg(test)]
mod tests {
    use super::*;
    use rsa::pkcs8::DecodePublicKey;
    use rsa::PublicKey;
    use std::sync::{Arc, Mutex};
    use tiny_http::{Header, Response, Server};

    /// The reader's side of the handshake, written from the same message layout, with a fixed PIN.
    struct FakeReader {
        pin: String,
        registered: Arc<Mutex<Option<(String, String)>>>,
    }

    fn jr(v: Value, status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
        Response::from_string(v.to_string()).with_status_code(status).with_header(Header::from_bytes("Content-Type", "application/json").unwrap())
    }

    impl FakeReader {
        fn serve(self, server: Server) {
            let dh = DiffieHellman::new();
            let n1 = random_bytes::<16>().to_vec();
            let mac = random_bytes::<6>().to_vec();
            let es = random_bytes::<16>().to_vec();
            let pub_b = dh.public().to_bytes_be();
            // Java's BigInteger.toByteArray(): a leading zero byte whenever the top bit is set
            let mut yb = if pub_b[0] & 0x80 != 0 { vec![0u8] } else { vec![] };
            yb.extend(&pub_b);
            let mut keys: Option<([u8; 32], [u8; 16])> = None;
            let (mut n2, mut ya, mut m2_hmac, mut e_hash, mut m3_hmac, mut psk) = (vec![], vec![], vec![], vec![], vec![], vec![]);
            let (mut wrapped_cert, mut m5_hmac) = (vec![], vec![]);
            let unb = |v: &Value, k: &str| unb64(v, k).unwrap();

            for mut req in server.incoming_requests() {
                let url = req.url().to_string();
                let mut body = String::new();
                std::io::Read::read_to_string(req.as_reader(), &mut body).unwrap();
                let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                let resp = match url.as_str() {
                    "/register/cleanup" => Response::from_string("").with_status_code(204),
                    "/register/pin" => jr(json!({ "a": b64(&n1), "b": b64(&mac), "c": b64(&yb) }), 200),
                    "/register/hash" => {
                        n2 = unb(&v, "b");
                        ya = unb(&v, "d");
                        let shared = dh.shared(&BigUint::from_bytes_be(&ya[1..])).unwrap();
                        let k = derive_keys(&shared, &[n1.as_slice(), mac.as_slice(), n2.as_slice()].concat());
                        keys = Some(k);
                        m2_hmac = unb(&v, "e");
                        assert_eq!(hmac_sha256(&k.0, &[&n1, &mac, &yb, &n1, &n2, &mac, &ya]).to_vec(), m2_hmac, "client M2 hmac");
                        psk = hmac_sha256(&k.0, &[self.pin.as_bytes()]).to_vec();
                        e_hash = hmac_sha256(&k.0, &[&es, &psk, &yb, &ya]).to_vec();
                        m3_hmac = hmac_sha256(&k.0, &[&n1, &n2, &mac, &ya, &m2_hmac, &n2, &e_hash]).to_vec();
                        jr(json!({ "a": b64(&n2), "b": b64(&e_hash), "e": b64(&m3_hmac) }), 200)
                    }
                    "/register/ca" => {
                        let (auth, wrap_key) = keys.unwrap();
                        let r_hash = unb(&v, "b");
                        let wrapped_rs = unb(&v, "d");
                        let m4_hmac = unb(&v, "e");
                        assert_eq!(hmac_sha256(&auth, &[&n2, &e_hash, &m3_hmac, &n1, &r_hash, &wrapped_rs]).to_vec(), m4_hmac, "client M4 hmac");
                        let rs = unwrap(&wrapped_rs, &auth, &wrap_key).unwrap();
                        if hmac_sha256(&auth, &[&rs, &psk, &yb, &ya]).to_vec() != r_hash {
                            jr(json!({ "message": "wrong pin" }), 400)
                        } else {
                            wrapped_cert = wrap(&[es.as_slice(), b"-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----"].concat(), &auth, &wrap_key);
                            m5_hmac = hmac_sha256(&auth, &[&n1, &r_hash, &wrapped_rs, &m4_hmac, &n2, &wrapped_cert]).to_vec();
                            jr(json!({ "a": b64(&n2), "d": b64(&wrapped_cert), "e": b64(&m5_hmac) }), 200)
                        }
                    }
                    "/register" => {
                        let (auth, wrap_key) = keys.unwrap();
                        let wrapped = unb(&v, "d");
                        assert_eq!(hmac_sha256(&auth, &[&n2, &wrapped_cert, &m5_hmac, &n1, &wrapped]).to_vec(), unb(&v, "e"), "client M6 hmac");
                        let payload = unwrap(&wrapped, &auth, &wrap_key).unwrap();
                        let (id, pem) = payload.split_at(36);
                        *self.registered.lock().unwrap() = Some((String::from_utf8(id.to_vec()).unwrap(), String::from_utf8(pem.to_vec()).unwrap()));
                        Response::from_string("").with_status_code(204)
                    }
                    other => jr(json!({ "message": format!("unhandled {other}") }), 404),
                };
                let _ = req.respond(resp);
            }
        }
    }

    fn spawn_reader(pin: &str) -> (Config, Arc<Mutex<Option<(String, String)>>>) {
        let server = Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let registered = Arc::new(Mutex::new(None));
        let reader = FakeReader { pin: pin.to_string(), registered: registered.clone() };
        std::thread::spawn(move || reader.serve(server));
        let mut cfg = Config::new("127.0.0.1");
        cfg.reg_port = port;
        (cfg, registered)
    }

    #[test]
    fn pairing_with_the_right_pin_registers_a_working_key() {
        // several rounds: the zero-byte case for yb shows up about half the time
        for _ in 0..4 {
            let (cfg, registered) = spawn_reader("12345678");
            let session = PairingSession::start(cfg).unwrap();
            let pairing = session.finish(" 12345678\n").unwrap();
            let (id, pem) = registered.lock().unwrap().clone().expect("the reader stored the client");
            assert_eq!(id, pairing.credentials.client_id);
            assert!(pairing.device_certificate.contains("BEGIN CERTIFICATE"));
            // the registered public key verifies signatures made with the private key we kept
            let sig = pairing.credentials.private_key().unwrap().pkcs1v15_sign::<rsa::sha2::Sha256>(b"nonce").unwrap();
            let public = PublicKey::from_public_key_pem(&pem).unwrap();
            public.pkcs1v15_verify::<rsa::sha2::Sha256>(b"nonce", &sig).unwrap();
        }
    }

    #[test]
    fn pairing_with_the_wrong_pin_fails_clearly() {
        let (cfg, registered) = spawn_reader("11112222");
        let err = PairingSession::start(cfg).unwrap().finish("99999999").err().expect("must fail");
        assert!(matches!(err, Error::Pairing(_)), "{err:?}");
        assert!(registered.lock().unwrap().is_none());
    }
}
