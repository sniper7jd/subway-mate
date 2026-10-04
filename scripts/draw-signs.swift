import AppKit
import CoreText

let width = 1200
let height = 680
let outDir = "/Users/jd/subway-mate/public/signs"

let red = (CGFloat(0.933), CGFloat(0.208), CGFloat(0.180))
let yellow = (CGFloat(0.988), CGFloat(0.800), CGFloat(0.039))
let purple = (CGFloat(0.725), CGFloat(0.200), CGFloat(0.678))

let signX: CGFloat = 36
let signY: CGFloat = 118
let signW: CGFloat = 1128
let signH: CGFloat = 444

func makeRep() -> (NSBitmapImageRep, CGContext) {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: width,
        pixelsHigh: height,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: width * 4,
        bitsPerPixel: 32
    )!
    let gfx = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = gfx
    gfx.imageInterpolation = .high
    let cg = gfx.cgContext
    cg.setShouldAntialias(true)
    cg.setAllowsAntialiasing(true)
    cg.interpolationQuality = .high
    return (rep, cg)
}

func fromTop(_ y: CGFloat) -> CGFloat { CGFloat(height) - y }

func fillRect(_ cg: CGContext, _ x: CGFloat, _ yTop: CGFloat, _ w: CGFloat, _ h: CGFloat, _ rgb: (CGFloat, CGFloat, CGFloat)) {
    cg.setFillColor(CGColor(red: rgb.0, green: rgb.1, blue: rgb.2, alpha: 1))
    cg.fill(CGRect(x: x, y: fromTop(yTop + h), width: w, height: h))
}

func font(_ size: CGFloat) -> NSFont {
    NSFont(name: "Helvetica-Bold", size: size)
        ?? NSFont(name: "Arial-BoldMT", size: size)
        ?? NSFont.boldSystemFont(ofSize: size)
}

func textLine(_ string: String, _ size: CGFloat, _ color: NSColor) -> CTLine {
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font(size),
        .foregroundColor: color,
    ]
    return CTLineCreateWithAttributedString(NSAttributedString(string: string, attributes: attrs))
}

func drawText(_ cg: CGContext, _ string: String, _ x: CGFloat, _ baselineFromTop: CGFloat, _ size: CGFloat, _ color: NSColor) {
    let run = textLine(string, size, color)
    cg.textMatrix = .identity
    cg.textPosition = CGPoint(x: x, y: fromTop(baselineFromTop))
    CTLineDraw(run, cg)
}

func drawCentered(_ cg: CGContext, _ string: String, _ cx: CGFloat, _ cy: CGFloat, _ size: CGFloat, _ color: NSColor) {
    let run = textLine(string, size, color)
    var ascent: CGFloat = 0
    var descent: CGFloat = 0
    let w = CGFloat(CTLineGetTypographicBounds(run, &ascent, &descent, nil))
    let baselineFromTop = cy + (ascent - descent) / 2
    cg.textMatrix = .identity
    cg.textPosition = CGPoint(x: cx - w / 2, y: fromTop(baselineFromTop))
    CTLineDraw(run, cg)
}

func tiles(_ cg: CGContext) {
    fillRect(cg, 0, 0, CGFloat(width), CGFloat(height), (0.86, 0.84, 0.80))
    let tile: CGFloat = 86
    let gap: CGFloat = 8
    var y: CGFloat = -36
    var row = 0
    while y < CGFloat(height) + tile {
        var x: CGFloat = row % 2 == 0 ? -28 : -4
        while x < CGFloat(width) + tile {
            fillRect(cg, x, y, tile, tile, (0.965, 0.965, 0.958))
            x += tile + gap
        }
        y += tile + gap
        row += 1
    }
}

func signBand(_ cg: CGContext) {
    cg.setFillColor(CGColor(gray: 0, alpha: 0.28))
    cg.fill(CGRect(x: signX + 8, y: fromTop(signY + signH + 16), width: signW, height: signH))
    fillRect(cg, signX, signY, signW, signH, (0.04, 0.04, 0.04))
    fillRect(cg, signX + 18, signY + 12, signW - 36, 4, (1, 1, 1))
}

func bullet(_ cg: CGContext, _ cx: CGFloat, _ cy: CGFloat, _ d: CGFloat, _ rgb: (CGFloat, CGFloat, CGFloat), _ label: String, _ labelColor: NSColor) {
    let r = d / 2
    cg.setFillColor(CGColor(red: rgb.0, green: rgb.1, blue: rgb.2, alpha: 1))
    cg.fillEllipse(in: CGRect(x: cx - r, y: fromTop(cy + r), width: d, height: d))
    drawCentered(cg, label, cx, cy + d * 0.02, d * 0.52, labelColor)
}

func save(_ rep: NSBitmapImageRep, _ name: String) {
    let path = "\(outDir)/\(name)"
    guard let data = rep.representation(using: .png, properties: [:]) else {
        fputs("png encode failed for \(name)\n", stderr)
        exit(1)
    }
    try! data.write(to: URL(fileURLWithPath: path))
    print("wrote \(path)")
}

func render(_ name: String, _ draw: (CGContext) -> Void) {
    let (rep, cg) = makeRep()
    tiles(cg)
    signBand(cg)
    draw(cg)
    save(rep, name)
}

// Upper band sits clear of the lower band so each sign's color lands on different grid cells.
let upperY: CGFloat = 250
let lowerY: CGFloat = 455

render("uptown-bronx-1.png") { cg in
    drawText(cg, "Uptown & The Bronx", 78, 250, 62, .white)
    bullet(cg, 990, lowerY, 176, red, "1", .white)
}

render("one-train-uptown.png") { cg in
    bullet(cg, 210, upperY, 168, red, "1", .white)
    drawText(cg, "1 Train Uptown", 340, 268, 64, .white)
}

render("seven-flushing.png") { cg in
    drawText(cg, "7 Train Flushing", 78, 250, 60, .white)
    bullet(cg, 600, lowerY, 176, purple, "7", .white)
}

render("seven-platform.png") { cg in
    bullet(cg, 210, lowerY, 176, purple, "7", .white)
    drawText(cg, "To 7 Train Platform", 360, 250, 54, .white)
}

render("nqrw.png") { cg in
    drawText(cg, "N Q R W Trains", 78, 430, 48, .white)
    let letters = ["N", "Q", "R", "W"]
    let d: CGFloat = 132
    let gap: CGFloat = 36
    var cx: CGFloat = 520
    for letter in letters {
        bullet(cg, cx, upperY, d, yellow, letter, NSColor(calibratedWhite: 0.06, alpha: 1))
        cx += d + gap
    }
}
