/** Build identity, independent of document format and the currently visited subpage. */
export function releaseChannel(): 'main' | 'dev' {
  return import.meta.env.VITE_RELEASE_CHANNEL === 'main' ? 'main' : 'dev';
}

export function channelStorageKey(key: string): string {
  return `${releaseChannel()}:${key}`;
}

/** Adopt compatible pre-channel data once, preserving the original recovery copy. */
export function readChannelStorage(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  key: string,
  acceptsLegacy: (text: string) => boolean,
): string | null {
  const scoped = channelStorageKey(key);
  const current = storage.getItem(scoped);
  if (current !== null) return current;
  const legacy = storage.getItem(key);
  if (legacy === null) return null;
  try {
    if (!acceptsLegacy(legacy)) return null;
  } catch {
    return null;
  }
  storage.setItem(scoped, legacy);
  return legacy;
}
