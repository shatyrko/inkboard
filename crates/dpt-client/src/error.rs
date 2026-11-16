use std::io;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// The reader could not be reached (wrong address, Wi-Fi off, asleep).
    #[error("could not reach the reader: {0}")]
    Network(String),
    /// The reader answered with an error status.
    #[error("the reader refused the request ({status}): {message}")]
    Api { status: u16, message: String },
    /// The session is missing or was rejected; authenticate again.
    #[error("the reader did not accept this computer's session")]
    Unauthorized,
    #[error("not found on the reader: {0}")]
    NotFound(String),
    #[error("pairing failed: {0}")]
    Pairing(String),
    #[error("key problem: {0}")]
    Key(String),
    #[error("unexpected reply from the reader: {0}")]
    Protocol(String),
    #[error(transparent)]
    Io(#[from] io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

impl From<ureq::Error> for Error {
    fn from(e: ureq::Error) -> Self {
        match e {
            ureq::Error::Io(e) => Error::Network(e.to_string()),
            other => Error::Network(other.to_string()),
        }
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Protocol(e.to_string())
    }
}
