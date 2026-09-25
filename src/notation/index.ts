import { parseQuantity, scalarPattern as scalar } from '../quantity';
export type NotationToken = {kind:'text';text:string} | {kind:'subscript';text:string} | {kind:'fraction';numerator:string;denominator:string};
/** Scan complete numeric ratios, excluding chained divisions, dates and zero denominators. */
export function notationTokens(text:string):NotationToken[] {
  const pattern=new RegExp(`(?<![\\w./⁄])(${scalar})\\s*[/⁄]\\s*(${scalar})(?![\\d./⁄]|[eE][+-]?\\d)`,'g');
  const tokens:NotationToken[]=[];let offset=0;
  for(const match of text.matchAll(pattern)) {
    const parsed=parseQuantity(match[0],'');
    if(!parsed?.fraction)continue;
    if(match.index>offset)tokens.push({kind:'text',text:text.slice(offset,match.index)});
    const [numerator,denominator]=parsed.fraction.split('/');
    tokens.push({kind:'fraction',numerator,denominator});offset=match.index+match[0].length;
  }
  if(offset<text.length)tokens.push({kind:'text',text:text.slice(offset)});
  return tokens.flatMap(token=>{
    if(token.kind!=='text')return [token];
    const parts:NotationToken[]=[];let start=0;
    const subscripts=/(?<=[\p{L}\p{N}])_(?:\{([^{}]+)\}|([\p{L}\p{N}]+))/gu;
    for(const match of token.text.matchAll(subscripts)){
      if(match.index>start)parts.push({kind:'text',text:token.text.slice(start,match.index)});
      parts.push({kind:'subscript',text:match[1]??match[2]});start=match.index+match[0].length;
    }
    if(start<token.text.length)parts.push({kind:'text',text:token.text.slice(start)});
    return parts;
  });
}
/** Mathematical italic glyphs preserve upright digits and do not alter stored labels. */
export function symbolGlyphs(text:string):string {
  const separator=text.search(/[=≈:]/);
  if(separator>=0)return symbolGlyphs(text.slice(0,separator))+text.slice(separator);
  return [...text].map(c=>{
    const code=c.codePointAt(0)!;
    if(c==='h')return 'ℎ';
    if(code>=65&&code<=90)return String.fromCodePoint(0x1d434+code-65);
    if(code>=97&&code<=122)return String.fromCodePoint(0x1d44e+code-97);
    const upper='ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡϴΣΤΥΦΧΨΩ',lower='αβγδεζηθικλμνξοπρςστυφχψω';
    const u=upper.indexOf(c),l=lower.indexOf(c);
    if(u>=0)return String.fromCodePoint(0x1d6e2+u);
    if(l>=0)return String.fromCodePoint(0x1d6fc+l);
    return c;
  }).join('');
}

export function notationDisplayText(text:string,symbol=false):string {
  return symbol||/^[A-Za-zΑ-Ωα-ω][A-Za-zΑ-Ωα-ω0-9_{}]*\s*[=≈]/.test(text)?symbolGlyphs(text):text;
}
