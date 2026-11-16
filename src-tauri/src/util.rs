//! Small helpers shared by the command modules.

use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub type CmdResult<T> = Result<T, String>;

/// One file of an upload batch.
#[derive(serde::Serialize)]
pub struct UploadResult {
    name: String,
    ok: bool,
    error: Option<String>,
    /// something worth telling the user about a file that did go up (for example that tap squares could not be added)
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
}

impl UploadResult {
    pub fn ok(name: String) -> Self {
        Self { name, ok: true, error: None, note: None }
    }
    pub fn ok_with_note(name: String, note: Option<String>) -> Self {
        Self { name, ok: true, error: None, note }
    }
    pub fn failed(name: String, error: String) -> Self {
        Self { name, ok: false, error: Some(error), note: None }
    }
}

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Runs blocking work (network calls to the reader, file IO) off the async runtime.
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(err)
}

/// "2026-01-31T12:00:00Z", the format the reader expects.
pub fn now_iso() -> String {
    use time::format_description::well_known::Rfc3339;
    time::OffsetDateTime::now_utc().replace_nanosecond(0).expect("zero is a valid nanosecond").format(&Rfc3339).expect("RFC 3339 formatting")
}

/// Runs `command` through the shell, waiting at most `timeout`; returns stdout (stderr when stdout is empty), capped.
pub fn run_shell(command: &str, timeout: Duration, cap: usize) -> CmdResult<String> {
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg(command);
        c
    };
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(err)?;
    let mut stdout = child.stdout.take().expect("piped");
    let mut stderr = child.stderr.take().expect("piped");
    let out = std::thread::spawn(move || read_capped(&mut stdout, cap));
    let errs = std::thread::spawn(move || read_capped(&mut stderr, cap));

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait().map_err(err)? {
            Some(_) => break,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("the command did not finish within {} seconds", timeout.as_secs()));
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    }
    let stdout = out.join().unwrap_or_default();
    let stderr = errs.join().unwrap_or_default();
    Ok(if stdout.trim().is_empty() { stderr } else { stdout })
}

/// Keeps reading to the end (so the child never blocks on a full pipe) but stores only the first `cap` bytes.
fn read_capped(r: &mut impl Read, cap: usize) -> String {
    let mut kept = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        match r.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if kept.len() < cap {
                    kept.extend_from_slice(&buf[..n.min(cap - kept.len())]);
                }
            }
        }
    }
    String::from_utf8_lossy(&kept).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn shell_output_and_timeout() {
        assert_eq!(run_shell("printf hello", Duration::from_secs(5), 100).unwrap(), "hello");
        assert_eq!(run_shell("echo oops 1>&2", Duration::from_secs(5), 100).unwrap().trim(), "oops");
        assert_eq!(run_shell("yes | head -c 100000", Duration::from_secs(5), 10).unwrap().len(), 10);
        assert!(run_shell("sleep 5", Duration::from_millis(200), 10).is_err());
    }

    #[test]
    fn iso_timestamp_shape() {
        let t = now_iso();
        assert_eq!(t.len(), 20, "{t}");
        assert!(t.ends_with('Z'));
    }
}
