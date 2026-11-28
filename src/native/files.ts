// The app's copy of the saves (durable.ts) as files in its own data folder (iOS's Documents, Android's internal files),
// which the OS doesn't clear to free space, and which the phone's own backups carry. One file per key, written beside and renamed over, so a write cut short
// never leaves half a save.
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { Durable } from "./durable";

const DIR = "saves";
const where = { directory: Directory.Data };
const path = (key: string) => `${DIR}/${encodeURIComponent(key)}`;

export function fileDurable(): Durable {
  let made: Promise<unknown> | null = null;
  // (Made only when it isn't there: iOS's mkdir fails on a folder that is, and logs it.)
  const folder = () =>
    (made ??= Filesystem.stat({ ...where, path: DIR }).catch(() => Filesystem.mkdir({ ...where, path: DIR, recursive: true }).catch(() => undefined)));
  return {
    async keys() {
      await folder();
      const { files } = await Filesystem.readdir({ ...where, path: DIR });
      return files.map((f) => f.name).filter((n) => !n.endsWith(".tmp")).map((n) => decodeURIComponent(n));
    },
    async get(key) {
      try {
        return String((await Filesystem.readFile({ ...where, path: path(key), encoding: Encoding.UTF8 })).data);
      } catch {
        return null;
      }
    },
    async set(key, value) {
      await folder();
      const tmp = `${path(key)}.tmp`;
      await Filesystem.writeFile({ ...where, path: tmp, data: value, encoding: Encoding.UTF8 });
      await Filesystem.rename({ ...where, from: tmp, to: path(key), toDirectory: Directory.Data });
    },
    async remove(key) {
      await Filesystem.deleteFile({ ...where, path: path(key) }).catch(() => undefined);
    },
  };
}
