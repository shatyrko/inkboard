//! Client for the local REST API of Sony's Digital Paper readers (DPT-RP1, DPT-CP1).
//!
//! The protocol was worked out by the open-source dpt-rp1-py project; this crate is an independent Rust implementation of it.
//! Firmware updates are deliberately not part of it.

mod client;
mod creds;
mod crypto;
mod error;
mod model;
mod register;

#[cfg(feature = "discovery")]
pub mod discovery;

pub use client::{quote_plus, Client, Config};
pub use creds::{Credentials, CLIENT_ID_FILE, PRIVATE_KEY_FILE};
pub use error::{Error, Result};
pub use model::*;
pub use register::{Pairing, PairingSession};
