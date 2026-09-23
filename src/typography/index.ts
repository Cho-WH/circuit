import './math.css';
import fontData from './LibertinusMath-Regular.woff2?inline';

export const mathFontFamily = "'Libertinus Math', 'Noto Sans KR', serif";
/** Embedded in standalone SVG so exported PNG and offline SVG use the same glyphs. */
export const mathFontFace = `@font-face{font-family:'Libertinus Math';src:url('${fontData}') format('woff2');font-style:normal;font-weight:400;font-display:block;}`;
