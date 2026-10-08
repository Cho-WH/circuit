/** Treat legacy/plain and subscript numeric suffixes as the same occupied name. */
function labelKey(label: string): string {
  const text = label.trim().normalize('NFKC');
  const numbered = /^([\p{L}]+)(?:_(?:\{([0-9]+)\}|([0-9]+))|([0-9]+))$/u.exec(text);
  return numbered ? `${numbered[1]}_${BigInt(numbered[2] ?? numbered[3] ?? numbered[4])}` : text;
}

/**
 * One local allocator per placement/copy batch. Only committed names and names
 * already issued by this allocator occupy numbers; IDs and cancelled drafts do not.
 * Definitions with the same short prefix intentionally share a numbering sequence.
 */
export function createComponentLabelAllocator(existingLabels: Iterable<string>) {
  const occupied = new Set([...existingLabels].map(labelKey));
  return (definition: { readonly short: string }): string => {
    let number = 1;
    while (occupied.has(labelKey(`${definition.short}_${number}`))) number++;
    const label = `${definition.short}_${number}`;
    occupied.add(labelKey(label));
    return label;
  };
}
