//! Builds the PDF that goes to the reader: one full-page grayscale image per dashboard page, plus invisible link
//! annotations so a page can jump to another page. Written by hand (a few objects, a cross-reference table) so there is
//! nothing to go wrong in a general-purpose PDF library, and the output is small and predictable.

use std::io::Write;

use flate2::{write::ZlibEncoder, Compression};
use serde::Deserialize;

/// The reader's screen is about 150 pixels per inch; PDF user space is 72 points per inch.
const PX_TO_PT: f64 = 72.0 / 150.0;

#[derive(Debug, Clone, Deserialize)]
pub struct Link {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// 1-based target page
    pub page: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PageSpec {
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub links: Vec<Link>,
}

fn deflate(data: &[u8]) -> Vec<u8> {
    let mut e = ZlibEncoder::new(Vec::new(), Compression::default());
    e.write_all(data).expect("writing to memory cannot fail");
    e.finish().expect("finishing an in-memory stream cannot fail")
}

/// PDF text string: UTF-16BE with a byte order mark, hex encoded.
fn pdf_text(s: &str) -> String {
    let mut out = String::from("<FEFF");
    for u in s.encode_utf16() {
        out.push_str(&format!("{u:04X}"));
    }
    out.push('>');
    out
}

fn num(v: f64) -> String {
    let s = format!("{v:.3}");
    s.trim_end_matches('0').trim_end_matches('.').to_string()
}

/// `pixels` holds every page's 8-bit grayscale pixels back to back (row-major, no padding).
pub fn build(title: &str, pages: &[PageSpec], pixels: &[u8]) -> Result<Vec<u8>, String> {
    if pages.is_empty() {
        return Err("a dashboard needs at least one page".into());
    }
    let expected: usize = pages.iter().map(|p| p.width as usize * p.height as usize).sum();
    if expected != pixels.len() {
        return Err(format!("page sizes add up to {expected} bytes but {} arrived", pixels.len()));
    }
    if pages.iter().any(|p| p.width == 0 || p.height == 0) {
        return Err("a page has no size".into());
    }

    // object numbers: 1 catalog, 2 page tree, 3.. the pages, then per page: content, image, link annotations
    let n = pages.len();
    let page_id = |i: usize| 3 + i;
    let mut next = 3 + n;
    let mut objects: Vec<(usize, Vec<u8>)> = Vec::new();

    let kids: Vec<String> = (0..n).map(|i| format!("{} 0 R", page_id(i))).collect();
    objects.push((1, b"<< /Type /Catalog /Pages 2 0 R >>".to_vec()));
    objects.push((2, format!("<< /Type /Pages /Kids [{}] /Count {n} >>", kids.join(" ")).into_bytes()));

    let mut offset = 0usize;
    for (i, spec) in pages.iter().enumerate() {
        let len = spec.width as usize * spec.height as usize;
        let (w_pt, h_pt) = (spec.width as f64 * PX_TO_PT, spec.height as f64 * PX_TO_PT);
        let content_id = next;
        let image_id = next + 1;
        next += 2;

        let mut annots = Vec::new();
        for link in &spec.links {
            if link.page == 0 || link.page > n {
                continue;
            }
            let (x1, x2) = (link.x * PX_TO_PT, (link.x + link.w) * PX_TO_PT);
            let (y1, y2) = (h_pt - (link.y + link.h) * PX_TO_PT, h_pt - link.y * PX_TO_PT);
            let id = next;
            next += 1;
            annots.push(id);
            objects.push((
                id,
                format!("<< /Type /Annot /Subtype /Link /Rect [{} {} {} {}] /Border [0 0 0] /Dest [{} 0 R /Fit] >>", num(x1), num(y1), num(x2), num(y2), page_id(link.page - 1)).into_bytes(),
            ));
        }
        let annots_entry = if annots.is_empty() { String::new() } else { format!(" /Annots [{}]", annots.iter().map(|a| format!("{a} 0 R")).collect::<Vec<_>>().join(" ")) };
        objects.push((
            page_id(i),
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] /Resources << /XObject << /Im0 {image_id} 0 R >> >> /Contents {content_id} 0 R{annots_entry} >>",
                num(w_pt),
                num(h_pt)
            )
            .into_bytes(),
        ));

        let content = format!("q {} 0 0 {} 0 0 cm /Im0 Do Q", num(w_pt), num(h_pt));
        objects.push((content_id, stream("<< ", content.as_bytes())));

        let data = deflate(&pixels[offset..offset + len]);
        offset += len;
        let dict = format!("<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode", spec.width, spec.height);
        objects.push((image_id, stream(&dict, &data)));
    }
    let info_id = next;
    objects.push((info_id, format!("<< /Title {} /Producer (Inkboard) >>", pdf_text(title)).into_bytes()));
    objects.sort_by_key(|(id, _)| *id);

    let mut out: Vec<u8> = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = vec![0usize; info_id + 1];
    for (id, body) in &objects {
        offsets[*id] = out.len();
        out.extend(format!("{id} 0 obj\n").as_bytes());
        out.extend(body);
        out.extend(b"\nendobj\n");
    }
    let xref = out.len();
    out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", info_id + 1).as_bytes());
    for o in &offsets[1..] {
        out.extend(format!("{o:010} 00000 n \n").as_bytes());
    }
    out.extend(format!("trailer\n<< /Size {} /Root 1 0 R /Info {info_id} 0 R >>\nstartxref\n{xref}\n%%EOF\n", info_id + 1).as_bytes());
    Ok(out)
}

/// A stream object: the dictionary text is completed with /Length here.
fn stream(dict_open: &str, data: &[u8]) -> Vec<u8> {
    let mut v = format!("{dict_open} /Length {} >>\nstream\n", data.len()).into_bytes();
    v.extend(data);
    v.extend(b"\nendstream");
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn spec(w: u32, h: u32, links: Vec<Link>) -> PageSpec {
        PageSpec { width: w, height: h, links }
    }

    fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
        hay.windows(needle.len()).position(|w| w == needle)
    }

    #[test]
    fn single_page_structure_and_offsets() {
        let pixels: Vec<u8> = (0..40 * 60).map(|i| (i % 256) as u8).collect();
        let pdf = build("Test", &[spec(40, 60, vec![])], &pixels).unwrap();
        assert!(pdf.starts_with(b"%PDF-1.4"));
        assert!(pdf.ends_with(b"%%EOF\n"));

        // startxref points at the xref table, and every xref entry points at "N 0 obj"
        let sx = find(&pdf, b"startxref\n").unwrap() + 10;
        let end = pdf[sx..].iter().position(|b| *b == b'\n').unwrap();
        let xref_pos: usize = std::str::from_utf8(&pdf[sx..sx + end]).unwrap().parse().unwrap();
        assert!(pdf[xref_pos..].starts_with(b"xref\n"));
        let table = std::str::from_utf8(&pdf[xref_pos..sx]).unwrap();
        for (i, line) in table.lines().skip(3).take_while(|l| l.ends_with(" n ")).enumerate() {
            let off: usize = line[..10].parse().unwrap();
            assert!(pdf[off..].starts_with(format!("{} 0 obj", i + 1).as_bytes()), "object {} offset", i + 1);
        }
    }

    #[test]
    fn image_stream_round_trips() {
        let pixels: Vec<u8> = (0..30 * 20).map(|i| (i * 7 % 256) as u8).collect();
        let pdf = build("x", &[spec(30, 20, vec![])], &pixels).unwrap();
        let marker = find(&pdf, b"/FlateDecode /Length ").unwrap() + 21;
        let len_end = pdf[marker..].iter().position(|b| *b == b' ').unwrap();
        let len: usize = std::str::from_utf8(&pdf[marker..marker + len_end]).unwrap().parse().unwrap();
        let start = marker + find(&pdf[marker..], b"stream\n").unwrap() + 7;
        let mut decoded = Vec::new();
        flate2::read::ZlibDecoder::new(&pdf[start..start + len]).read_to_end(&mut decoded).unwrap();
        assert_eq!(decoded, pixels);
    }

    #[test]
    fn links_point_at_the_right_page_and_flip_the_y_axis() {
        let pixels = vec![255u8; 2 * 150 * 300];
        let link = Link { x: 15.0, y: 30.0, w: 75.0, h: 60.0, page: 2 };
        let pdf = build("x", &[spec(150, 300, vec![link]), spec(150, 300, vec![])], &pixels).unwrap();
        let text = String::from_utf8_lossy(&pdf);
        // page 2 is object 4; page height 300 px = 144 pt; y range 30..90 px -> 144-43.2 .. 144-14.4
        assert!(text.contains("/Rect [7.2 100.8 43.2 129.6]"), "{text}");
        assert!(text.contains("/Dest [4 0 R /Fit]"));
        assert!(text.contains("/Annots ["));
    }

    #[test]
    fn links_to_missing_pages_are_dropped() {
        let pixels = vec![0u8; 10 * 10];
        let link = Link { x: 0.0, y: 0.0, w: 5.0, h: 5.0, page: 9 };
        let pdf = build("x", &[spec(10, 10, vec![link])], &pixels).unwrap();
        assert!(!String::from_utf8_lossy(&pdf).contains("/Annot "));
    }

    #[test]
    fn mismatched_pixel_count_is_rejected() {
        assert!(build("x", &[spec(10, 10, vec![])], &[0u8; 99]).is_err());
        assert!(build("x", &[], &[]).is_err());
    }

    #[test]
    fn title_is_utf16_hex() {
        let pdf = build("Дашборд", &[spec(2, 2, vec![])], &[0u8; 4]).unwrap();
        assert!(String::from_utf8_lossy(&pdf).contains("/Title <FEFF0414"));
    }
}
