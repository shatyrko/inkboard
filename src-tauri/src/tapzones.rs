//! Tap zones for page turning.
//!
//! The Digital Paper turns pages by swiping, and its swipe detection is unreliable. It does follow PDF links when they are tapped, so a
//! square in the bottom right corner of every page that links to the next page, and one in the bottom left corner that links to the
//! previous page, give it tap-to-turn without touching the firmware. The squares are 5 cm on the reader's screen.
//!
//! The squares are added as an incremental update: the original file is kept byte for byte and the changed pages and the new link
//! annotations are appended after it, so a book is never re-encoded and a failure never damages it.

use lopdf::{Dictionary, Document, IncrementalDocument, Object, ObjectId};

/// The side of a tap square on the reader's screen.
pub const ZONE_CM: f32 = 5.0;
const POINTS_PER_CM: f32 = 72.0 / 2.54;

/// The Digital Paper's screen (13.3 inches, 3:4) in points, which is what a page is fitted into when it is shown.
const SCREEN_W_PT: f32 = 574.6;
const SCREEN_H_PT: f32 = 766.1;

/// The annotation name that marks a square as ours, so running this again replaces the squares instead of stacking more.
const NAME: &[u8] = b"inkboard-tap";

/// Larger files are left alone: the update is built in memory.
const MAX_BYTES: usize = 300 * 1024 * 1024;

fn follow<'a>(doc: &'a Document, mut object: &'a Object) -> &'a Object {
    for _ in 0..8 {
        match object {
            Object::Reference(id) => match doc.get_object(*id) {
                Ok(next) => object = next,
                Err(_) => break,
            },
            _ => break,
        }
    }
    object
}

/// A page attribute, looked up on the page and then on its ancestors in the page tree.
fn inherited<'a>(doc: &'a Document, page: ObjectId, key: &[u8]) -> Option<&'a Object> {
    let mut node = page;
    for _ in 0..32 {
        let dict = doc.get_object(node).ok()?.as_dict().ok()?;
        if let Ok(value) = dict.get(key) {
            return Some(follow(doc, value));
        }
        node = dict.get(b"Parent").ok()?.as_reference().ok()?;
    }
    None
}

fn number(doc: &Document, o: &Object) -> Option<f32> {
    follow(doc, o).as_float().ok()
}

fn rect_of(doc: &Document, o: &Object) -> Option<[f32; 4]> {
    let a = follow(doc, o).as_array().ok()?;
    if a.len() != 4 {
        return None;
    }
    let n: Vec<f32> = a.iter().map(|v| number(doc, v)).collect::<Option<_>>()?;
    let (x0, x1) = (n[0].min(n[2]), n[0].max(n[2]));
    let (y0, y1) = (n[1].min(n[3]), n[1].max(n[3]));
    (x1 - x0 > 1.0 && y1 - y0 > 1.0).then_some([x0, y0, x1, y1])
}

/// What the reader shows of the page: the crop box when there is one, else the media box, else a letter page.
fn visible_box(doc: &Document, page: ObjectId) -> [f32; 4] {
    inherited(doc, page, b"CropBox")
        .and_then(|o| rect_of(doc, o))
        .or_else(|| inherited(doc, page, b"MediaBox").and_then(|o| rect_of(doc, o)))
        .unwrap_or([0.0, 0.0, 612.0, 792.0])
}

/// 0, 90, 180 or 270: how far the page is turned clockwise when shown.
fn rotation(doc: &Document, page: ObjectId) -> i64 {
    let r = inherited(doc, page, b"Rotate").and_then(|o| o.as_i64().ok()).unwrap_or(0).rem_euclid(360);
    if r % 90 == 0 {
        r
    } else {
        0
    }
}

/// The side of the tap squares in the page's own units: 5 cm once the page is fitted to the reader's screen, so a small book page
/// (which is shown enlarged) gets a smaller square than a big one. A square never takes more than 40 % of the page.
pub fn zone_size(bounds: [f32; 4], rotate: i64, user_unit: f32) -> f32 {
    let unit = if user_unit.is_finite() && user_unit > 0.0 { user_unit } else { 1.0 };
    let (w, h) = ((bounds[2] - bounds[0]) * unit, (bounds[3] - bounds[1]) * unit);
    let (shown_w, shown_h) = if rotate == 90 || rotate == 270 { (h, w) } else { (w, h) };
    let fit = (SCREEN_W_PT / shown_w).min(SCREEN_H_PT / shown_h);
    let side = POINTS_PER_CM * ZONE_CM / fit; // in points of the page
    side.min(0.4 * w.min(h)) / unit
}

/// The rectangles, in the page's own coordinates, of the square at the bottom left of what is shown (previous page) and the one at
/// the bottom right (next page). A turned page shows another of its corners there.
pub fn corners(bounds: [f32; 4], rotate: i64, side: f32) -> ([f32; 4], [f32; 4]) {
    let [x0, y0, x1, y1] = bounds;
    let bottom_left = [x0, y0, x0 + side, y0 + side];
    let bottom_right = [x1 - side, y0, x1, y0 + side];
    let top_left = [x0, y1 - side, x0 + side, y1];
    let top_right = [x1 - side, y1 - side, x1, y1];
    match rotate {
        90 => (bottom_right, top_right),
        180 => (top_right, top_left),
        270 => (top_left, bottom_left),
        _ => (bottom_left, bottom_right),
    }
}

fn is_ours(doc: &Document, annot: &Object) -> bool {
    follow(doc, annot).as_dict().ok().and_then(|d| d.get(b"NM").ok()).and_then(|n| n.as_str().ok()).map(|s| s == NAME).unwrap_or(false)
}

fn link(rect: [f32; 4], target: ObjectId) -> Dictionary {
    let mut d = Dictionary::new();
    d.set("Type", "Annot");
    d.set("Subtype", "Link");
    d.set("Rect", rect.iter().map(|v| Object::Real(*v)).collect::<Vec<_>>());
    d.set("Border", vec![Object::Integer(0), Object::Integer(0), Object::Integer(0)]);
    d.set("Dest", vec![Object::Reference(target), Object::Name(b"Fit".to_vec())]);
    d.set("NM", Object::string_literal(NAME));
    d
}

/// The annotations a page already has, without any squares of ours from an earlier run.
fn other_annotations(doc: &Document, page: ObjectId) -> Vec<Object> {
    let Some(dict) = doc.get_object(page).ok().and_then(|o| o.as_dict().ok()) else { return Vec::new() };
    let Some(list) = dict.get(b"Annots").ok().map(|a| follow(doc, a)).and_then(|a| a.as_array().ok()) else { return Vec::new() };
    list.iter().filter(|a| !is_ours(doc, a)).cloned().collect()
}

/// The PDF with tap squares added to every page, `Ok(None)` when there is nothing to add (a single page), or the reason it was left as it is
/// (encrypted, damaged, too large). The result is checked by reading it back before it is returned.
pub fn add_tap_zones(pdf: &[u8]) -> Result<Option<Vec<u8>>, String> {
    if pdf.len() > MAX_BYTES {
        return Err("The PDF is too large to add tap zones to".into());
    }
    let doc = Document::load_mem(pdf).map_err(|e| format!("The PDF could not be read ({e})"))?;
    if doc.is_encrypted() {
        return Err("The PDF is encrypted".into());
    }
    let ids: Vec<ObjectId> = doc.get_pages().values().copied().collect();
    if ids.len() < 2 {
        return Ok(None);
    }

    // everything that needs the original is worked out first; then the update is built
    let plan: Vec<(Vec<Object>, [f32; 4], [f32; 4])> = ids
        .iter()
        .map(|&id| {
            let bounds = visible_box(&doc, id);
            let rotate = rotation(&doc, id);
            let unit = inherited(&doc, id, b"UserUnit").and_then(|o| o.as_float().ok()).unwrap_or(1.0);
            let (prev, next) = corners(bounds, rotate, zone_size(bounds, rotate, unit));
            (other_annotations(&doc, id), prev, next)
        })
        .collect();

    let mut update = IncrementalDocument::create_from(pdf.to_vec(), doc);
    for (i, (&id, (mut annots, prev, next))) in ids.iter().zip(plan).enumerate() {
        if i > 0 {
            annots.push(Object::Reference(update.new_document.add_object(link(prev, ids[i - 1]))));
        }
        if i + 1 < ids.len() {
            annots.push(Object::Reference(update.new_document.add_object(link(next, ids[i + 1]))));
        }
        update.opt_clone_object_to_new_document(id).map_err(|e| format!("The PDF could not be changed ({e})"))?;
        let page = update.new_document.get_object_mut(id).and_then(Object::as_dict_mut).map_err(|e| format!("The PDF could not be changed ({e})"))?;
        page.set("Annots", annots);
    }
    let mut out = Vec::with_capacity(pdf.len() + ids.len() * 500);
    update.save_to(&mut out).map_err(|e| format!("The PDF could not be written ({e})"))?;

    verify(&out, ids.len())?;
    Ok(Some(out))
}

/// Reads the result back: same number of pages, and every page has the squares it should have.
fn verify(pdf: &[u8], pages: usize) -> Result<(), String> {
    let doc = Document::load_mem(pdf).map_err(|e| format!("The changed PDF did not read back ({e})"))?;
    let ids: Vec<ObjectId> = doc.get_pages().values().copied().collect();
    if ids.len() != pages {
        return Err("The changed PDF has a different number of pages".into());
    }
    for (i, id) in ids.iter().enumerate() {
        let want = usize::from(i > 0) + usize::from(i + 1 < pages);
        let ours = doc.get_object(*id).ok().and_then(|o| o.as_dict().ok()).and_then(|d| d.get(b"Annots").ok()).map(|a| follow(&doc, a)).and_then(|a| a.as_array().ok()).map(|a| a.iter().filter(|x| is_ours(&doc, x)).count());
        if ours != Some(want) {
            return Err(format!("Page {} did not get its tap squares", i + 1));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: f32 = 612.0;
    const H: f32 = 792.0;

    /// A document of `pages` pages: the media box is inherited from the page tree; page 2 (index 1) is turned 90 degrees when `turned`,
    /// and the first page already carries a link of its own, once as a direct array and once as a reference to an array.
    fn fixture(pages: usize, turned: bool, existing: bool, modern: bool) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let mut kids = Vec::new();
        for i in 0..pages {
            let mut page = Dictionary::new();
            page.set("Type", "Page");
            page.set("Parent", Object::Reference(pages_id));
            if turned && i == 1 {
                page.set("Rotate", 90);
            }
            if existing && i == 0 {
                let mut uri = Dictionary::new();
                uri.set("Type", "Annot");
                uri.set("Subtype", "Link");
                uri.set("Rect", vec![Object::Integer(10), Object::Integer(10), Object::Integer(50), Object::Integer(20)]);
                uri.set("A", Object::Dictionary({
                    let mut a = Dictionary::new();
                    a.set("S", "URI");
                    a.set("URI", Object::string_literal("https://example.org"));
                    a
                }));
                let uri_id = doc.add_object(uri);
                let list_id = doc.add_object(Object::Array(vec![Object::Reference(uri_id)])); // an array kept as its own object
                page.set("Annots", Object::Reference(list_id));
            }
            kids.push(Object::Reference(doc.add_object(page)));
        }
        let mut tree = Dictionary::new();
        tree.set("Type", "Pages");
        tree.set("Kids", kids);
        tree.set("Count", pages as i64);
        tree.set("MediaBox", vec![Object::Integer(0), Object::Integer(0), Object::Real(W), Object::Real(H)]);
        doc.objects.insert(pages_id, Object::Dictionary(tree));
        let catalog = doc.add_object(Object::Dictionary({
            let mut c = Dictionary::new();
            c.set("Type", "Catalog");
            c.set("Pages", Object::Reference(pages_id));
            c
        }));
        doc.trailer.set("Root", Object::Reference(catalog));
        let mut out = Vec::new();
        if modern {
            doc.save_modern(&mut out).unwrap();
        } else {
            doc.save_to(&mut out).unwrap();
        }
        out
    }

    struct Strip {
        rect: [f32; 4],
        target: ObjectId,
    }

    /// For each page: its own links first, then our strips.
    fn read_back(pdf: &[u8]) -> Vec<(usize, Vec<Strip>)> {
        let doc = Document::load_mem(pdf).unwrap();
        doc.get_pages()
            .values()
            .map(|&id| {
                let annots = doc.get_object(id).unwrap().as_dict().unwrap().get(b"Annots").map(|a| follow(&doc, a).as_array().unwrap().clone()).unwrap_or_default();
                let others = annots.iter().filter(|a| !is_ours(&doc, a)).count();
                let ours = annots
                    .iter()
                    .filter(|a| is_ours(&doc, a))
                    .map(|a| {
                        let d = follow(&doc, a).as_dict().unwrap();
                        let dest = d.get(b"Dest").unwrap().as_array().unwrap();
                        Strip { rect: rect_of(&doc, d.get(b"Rect").unwrap()).unwrap(), target: dest[0].as_reference().unwrap() }
                    })
                    .collect();
                (others, ours)
            })
            .collect()
    }

    fn page_ids(pdf: &[u8]) -> Vec<ObjectId> {
        Document::load_mem(pdf).unwrap().get_pages().values().copied().collect()
    }

    fn near(a: [f32; 4], b: [f32; 4]) -> bool {
        a.iter().zip(b).all(|(x, y)| (x - y).abs() < 0.01)
    }

    #[test]
    fn every_page_links_to_its_neighbours_and_the_ends_have_one_square() {
        let pdf = fixture(4, false, false, false);
        let out = add_tap_zones(&pdf).unwrap().unwrap();
        let ids = page_ids(&out);
        let pages = read_back(&out);
        assert_eq!(pages.iter().map(|(_, s)| s.len()).collect::<Vec<_>>(), [1, 2, 2, 1]);
        let side = zone_size([0.0, 0.0, W, H], 0, 1.0);
        // page 1: next only, bottom right; later pages: previous at the bottom left, then next at the bottom right
        assert!(near(pages[0].1[0].rect, [W - side, 0.0, W, side]));
        assert_eq!(pages[0].1[0].target, ids[1]);
        assert!(near(pages[1].1[0].rect, [0.0, 0.0, side, side]));
        assert_eq!(pages[1].1[0].target, ids[0]);
        assert!(near(pages[1].1[1].rect, [W - side, 0.0, W, side]));
        assert_eq!(pages[1].1[1].target, ids[2]);
        assert_eq!(pages[3].1[0].target, ids[2]);
    }

    #[test]
    fn the_squares_are_five_centimetres_on_the_reader() {
        // a letter page is fitted to the 574.6 pt wide screen at 574.6 / 612 = 0.939, so 5 cm (141.7 pt) is 151 pt of page
        let side = zone_size([0.0, 0.0, 612.0, 792.0], 0, 1.0);
        assert!((side - 141.73 / 0.939).abs() < 1.0, "{side}");
        // a small book page is shown enlarged, so its square is smaller in the page's own units
        let small = zone_size([0.0, 0.0, 306.0, 396.0], 0, 1.0);
        assert!(small < side * 0.55 && small > side * 0.45, "{small}");
        // a turned page is fitted the other way up
        assert!((zone_size([0.0, 0.0, 792.0, 612.0], 90, 1.0) - side).abs() < 0.01);
        // UserUnit makes a unit bigger, so the same square needs fewer of them
        assert!((zone_size([0.0, 0.0, 306.0, 396.0], 0, 2.0) - side / 2.0).abs() < 1.0);
        // never more than 40 % of the page's short side (a very wide, low page); nonsense units count as 1
        assert!((zone_size([0.0, 0.0, 1000.0, 200.0], 0, 1.0) - 80.0).abs() < 0.01);
        assert_eq!(zone_size([0.0, 0.0, 612.0, 792.0], 0, f32::NAN), side);
    }

    #[test]
    fn the_original_file_is_kept_byte_for_byte_and_the_update_is_appended() {
        let pdf = fixture(3, false, false, false);
        let out = add_tap_zones(&pdf).unwrap().unwrap();
        assert_eq!(&out[..pdf.len()], &pdf[..]);
        assert!(out.len() > pdf.len());
        assert!(out.windows(5).rev().take(64).any(|w| w == b"%%EOF"));
    }

    #[test]
    fn links_a_page_already_has_are_kept_whether_the_list_is_direct_or_a_reference() {
        let out = add_tap_zones(&fixture(3, false, true, false)).unwrap().unwrap();
        let pages = read_back(&out);
        assert_eq!(pages[0].0, 1); // the page's own link survived
        assert_eq!(pages[0].1.len(), 1);
    }

    #[test]
    fn a_turned_page_gets_its_squares_in_the_corners_it_shows() {
        let out = add_tap_zones(&fixture(3, true, false, false)).unwrap().unwrap();
        let squares = &read_back(&out)[1].1;
        let side = zone_size([0.0, 0.0, W, H], 90, 1.0);
        // turned 90 degrees clockwise: what is the page's bottom right is now shown at the bottom left, its top right at the bottom right
        assert!(near(squares[0].rect, [W - side, 0.0, W, side]));
        assert!(near(squares[1].rect, [W - side, H - side, W, H]));
        let b = [0.0, 0.0, 100.0, 200.0];
        assert_eq!(corners(b, 0, 10.0), ([0.0, 0.0, 10.0, 10.0], [90.0, 0.0, 100.0, 10.0]));
        assert_eq!(corners(b, 180, 10.0), ([90.0, 190.0, 100.0, 200.0], [0.0, 190.0, 10.0, 200.0]));
        assert_eq!(corners(b, 270, 10.0), ([0.0, 190.0, 10.0, 200.0], [0.0, 0.0, 10.0, 10.0]));
    }

    #[test]
    fn running_it_twice_does_not_stack_squares() {
        let once = add_tap_zones(&fixture(3, false, true, false)).unwrap().unwrap();
        let twice = add_tap_zones(&once).unwrap().unwrap();
        let pages = read_back(&twice);
        assert_eq!(pages.iter().map(|(o, s)| (*o, s.len())).collect::<Vec<_>>(), [(1, 1), (0, 2), (0, 1)]);
    }

    #[test]
    fn works_on_a_file_with_compressed_object_streams() {
        let pdf = fixture(5, false, true, true);
        let out = add_tap_zones(&pdf).unwrap().unwrap();
        assert_eq!(&out[..pdf.len()], &pdf[..]);
        assert_eq!(read_back(&out).iter().map(|(_, s)| s.len()).collect::<Vec<_>>(), [1, 2, 2, 2, 1]);
    }

    #[test]
    fn nothing_to_do_for_one_page_and_garbage_is_refused() {
        assert!(add_tap_zones(&fixture(1, false, false, false)).unwrap().is_none());
        assert!(add_tap_zones(b"this is not a pdf").is_err());
        assert!(add_tap_zones(&[]).is_err());
    }

    #[test]
    fn page_boxes_are_read_with_inheritance_and_odd_corner_order() {
        let doc = Document::load_mem(&fixture(2, false, false, false)).unwrap();
        let id = doc.get_pages()[&1];
        assert_eq!(visible_box(&doc, id), [0.0, 0.0, W, H]); // inherited media box
        assert_eq!(rect_of(&doc, &Object::Array(vec![Object::Integer(10), Object::Integer(5), Object::Integer(0), Object::Integer(105)])), Some([0.0, 5.0, 10.0, 105.0]));
        assert_eq!(rect_of(&doc, &Object::Array(vec![Object::Integer(1), Object::Integer(2)])), None);
    }
}
