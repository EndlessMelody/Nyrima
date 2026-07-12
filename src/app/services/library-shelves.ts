export function splitPinnedLibraries<T extends { pinned?: boolean }>(
  folders: T[],
): { pinned: T[]; others: T[] } {
  const pinned: T[] = [];
  const others: T[] = [];

  for (const folder of folders) {
    if (folder.pinned) {
      pinned.push(folder);
    } else {
      others.push(folder);
    }
  }

  return { pinned, others };
}
