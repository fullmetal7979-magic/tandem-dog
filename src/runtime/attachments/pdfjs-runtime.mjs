import { fileURLToPath } from 'node:url';
import { definePDFJSModule } from 'unpdf';

let configuredPromise = null;

// pdf.js polyfills DOMMatrix and Path2D from the optional native
// "@napi-rs/canvas" package, and evaluating its display layer constructs a
// DOMMatrix at module load. This runtime only calls getTextContent, which never
// paints, so the native package is not shipped. These stand-ins keep the module
// evaluating and the matrix helpers numerically correct; Path2D is inert.
class PdfjsDOMMatrix {
  constructor(init) {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;
    const values = Array.isArray(init) || ArrayBuffer.isView(init) ? Array.from(init) : null;
    if (values?.length === 6) {
      [this.a, this.b, this.c, this.d, this.e, this.f] = values.map(Number);
    } else if (values?.length === 16) {
      [this.a, this.b] = values.slice(0, 2).map(Number);
      [this.c, this.d] = values.slice(4, 6).map(Number);
      [this.e, this.f] = values.slice(12, 14).map(Number);
    } else if (init && typeof init === 'object') {
      for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) if (Number.isFinite(init[key])) this[key] = Number(init[key]);
    }
  }

  get is2D() {
    return true;
  }

  get isIdentity() {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
  }

  // this = this x other (column-vector convention, as DOMMatrix).
  multiplySelf(other) {
    const { a, b, c, d, e, f } = this;
    const o = other instanceof PdfjsDOMMatrix ? other : new PdfjsDOMMatrix(other);
    this.a = a * o.a + c * o.b;
    this.b = b * o.a + d * o.b;
    this.c = a * o.c + c * o.d;
    this.d = b * o.c + d * o.d;
    this.e = a * o.e + c * o.f + e;
    this.f = b * o.e + d * o.f + f;
    return this;
  }

  preMultiplySelf(other) {
    const o = other instanceof PdfjsDOMMatrix ? other : new PdfjsDOMMatrix(other);
    const product = new PdfjsDOMMatrix(o).multiplySelf(this);
    Object.assign(this, { a: product.a, b: product.b, c: product.c, d: product.d, e: product.e, f: product.f });
    return this;
  }

  translateSelf(tx = 0, ty = 0) {
    return this.multiplySelf(new PdfjsDOMMatrix([1, 0, 0, 1, tx, ty]));
  }

  scaleSelf(sx = 1, sy = sx) {
    return this.multiplySelf(new PdfjsDOMMatrix([sx, 0, 0, sy, 0, 0]));
  }

  invertSelf() {
    const { a, b, c, d, e, f } = this;
    const det = a * d - b * c;
    if (!det) {
      Object.assign(this, { a: NaN, b: NaN, c: NaN, d: NaN, e: NaN, f: NaN });
      return this;
    }
    this.a = d / det;
    this.b = -b / det;
    this.c = -c / det;
    this.d = a / det;
    this.e = (c * f - d * e) / det;
    this.f = (b * e - a * f) / det;
    return this;
  }

  multiply(other) {
    return new PdfjsDOMMatrix(this).multiplySelf(other);
  }

  translate(tx, ty) {
    return new PdfjsDOMMatrix(this).translateSelf(tx, ty);
  }

  scale(sx, sy) {
    return new PdfjsDOMMatrix(this).scaleSelf(sx, sy);
  }

  inverse() {
    return new PdfjsDOMMatrix(this).invertSelf();
  }

  transformPoint(point = {}) {
    const x = Number(point.x) || 0;
    const y = Number(point.y) || 0;
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 };
  }
}

class PdfjsPath2D {
  addPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  rect() {}
  arc() {}
}

/** Defines the two globals pdf.js expects, only where the host lacks them. */
export function installPdfjsGlobals(target = globalThis) {
  target.DOMMatrix ??= PdfjsDOMMatrix;
  target.Path2D ??= PdfjsPath2D;
}

/**
 * Directory (trailing slash, forward slashes) holding pdf.js's bundled
 * standard fonts. Without it a page set in Helvetica or Times renders with a
 * canvas fallback face whose widths do not match, which shows up as
 * letter-spaced text in previews.
 */
export function pdfjsStandardFontDataUrl() {
  const directory = fileURLToPath(
    new URL('../../standard_fonts/', import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs'))
  );
  return `${directory.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
}

// pdf.js probes for the absent native canvas while evaluating and warns on
// stderr once. The stand-ins above cover what it would have polyfilled, so
// drop only that one warning for the duration of the import.
async function importQuietly() {
  const warn = console.warn;
  console.warn = (...args) => {
    if (/@napi-rs\/canvas|polyfill `(?:DOMMatrix|Path2D)`/.test(String(args[0]))) return;
    warn.apply(console, args);
  };
  try {
    return await import('pdfjs-dist/legacy/build/pdf.mjs');
  } finally {
    console.warn = warn;
  }
}

export async function resolvedPdfJs() {
  configuredPromise ??= Promise.resolve().then(async () => {
    installPdfjsGlobals();
    const pdfjs = await importQuietly();
    pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    await definePDFJSModule(() => Promise.resolve(pdfjs));
    return pdfjs;
  });
  return await configuredPromise;
}
