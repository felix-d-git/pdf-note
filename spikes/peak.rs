// Peak-Working-Set des eigenen Prozesses (Windows), ohne Zusatz-Crate.
#[repr(C)]
#[derive(Default)]
struct Pmc {
    cb: u32,
    faults: u32,
    peak_ws: usize,
    ws: usize,
    a: usize,
    b: usize,
    c: usize,
    d: usize,
    pagefile: usize,
    peak_pagefile: usize,
}
unsafe extern "system" {
    fn GetCurrentProcess() -> isize;
    fn K32GetProcessMemoryInfo(p: isize, c: *mut Pmc, cb: u32) -> i32;
}
pub fn mb() -> (usize, usize) {
    let mut c = Pmc {
        cb: std::mem::size_of::<Pmc>() as u32,
        ..Default::default()
    };
    unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut c, c.cb) };
    (c.peak_ws >> 20, c.peak_pagefile >> 20)
}
