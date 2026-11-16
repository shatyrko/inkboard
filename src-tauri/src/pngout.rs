//! 8-bit grayscale PNG for readers that show pictures instead of PDFs (the Gallery of an Android e-reader).

/// 150 pixels per inch, the same scale as the PDF pages, in pixels per metre.
const PIXELS_PER_METER: u32 = 5906;

pub fn encode_gray(width: u32, height: u32, pixels: &[u8]) -> Result<Vec<u8>, String> {
    if pixels.len() != width as usize * height as usize {
        return Err(format!("expected {} bytes for a {width}x{height} page, got {}", width as usize * height as usize, pixels.len()));
    }
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, width, height);
        enc.set_color(png::ColorType::Grayscale);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_pixel_dims(Some(png::PixelDimensions { xppu: PIXELS_PER_METER, yppu: PIXELS_PER_METER, unit: png::Unit::Meter }));
        let mut w = enc.write_header().map_err(|e| e.to_string())?;
        w.write_image_data(pixels).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_a_decoder() {
        let px: Vec<u8> = (0..16 * 8).map(|i| (i * 3 % 256) as u8).collect();
        let bytes = encode_gray(16, 8, &px).unwrap();
        assert!(bytes.starts_with(&[0x89, b'P', b'N', b'G']));
        let dec = png::Decoder::new(std::io::Cursor::new(bytes));
        let mut reader = dec.read_info().unwrap();
        let mut buf = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut buf).unwrap();
        assert_eq!((info.width, info.height), (16, 8));
        assert_eq!(&buf[..px.len()], &px[..]);
    }

    #[test]
    fn wrong_size_is_rejected() {
        assert!(encode_gray(4, 4, &[0; 15]).is_err());
    }
}
