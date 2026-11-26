import './math.css';

const mathFontUrl =
  'https://cdn.jsdelivr.net/gh/Cho-WH/circuit@ba0d77828454bc1fa67230baa66cad05a00e11ca/src/typography/LibertinusMath-Regular.woff2';
const mathFontName = 'Libertinus Math';
export const mathFontFamily = "'Libertinus Math', 'Noto Sans KR', serif";

export class MathFontError extends Error {
  constructor(cause: unknown) {
    super('Failed to load the mathematics font', { cause });
    this.name = 'MathFontError';
  }
}

let mathFont: Promise<ArrayBuffer> | undefined;
let embeddedFontFace: string | undefined;

/** The live FontFace and standalone exports share one download per page. */
export function loadMathFont(): Promise<ArrayBuffer> {
  mathFont ??= (async () => {
    const response = await fetch(mathFontUrl, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Font request returned ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (globalThis.document?.fonts && typeof globalThis.FontFace === 'function') {
      const font = new FontFace(mathFontName, bytes);
      await font.load();
      document.fonts.add(font);
    }
    return bytes;
  })().catch((cause: unknown) => {
    mathFont = undefined;
    throw new MathFontError(cause);
  });
  return mathFont;
}

export async function embeddedMathFontFace(): Promise<string> {
  const bytes = new Uint8Array(await loadMathFont());
  if (!embeddedFontFace) {
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += 8192) {
      chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    }
    const data = btoa(chunks.join(''));
    embeddedFontFace = `@font-face{font-family:'${mathFontName}';src:url('data:font/woff2;base64,${data}') format('woff2');font-style:normal;font-weight:400;font-display:block;}`;
  }
  return embeddedFontFace;
}
