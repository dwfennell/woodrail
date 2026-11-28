// Saves that last in the Android/iOS app (docs/native-builds.md).
//
// The game keeps everything in localStorage, read and written synchronously all over. Inside an app's WebView that
// storage is the WebView's, and the OS may clear it when the phone is short of space (iOS says so outright). So the app
// keeps a copy of every `woodrail.` key in its own files, which the OS leaves alone:
//
// - `restore`, before the game starts: a key the WebView has lost is put back from the copy. A key the WebView still
//   has wins (it's written first; the copy can be a moment behind).
// - `mirror`, from then on: localStorage's setItem and removeItem also write the copy, a moment later (writes to the
//   same key in that time are one write), and at once when the app goes to the background.
//
// The copy's store is passed in (`Durable`), so this is tested without the app.

export const PREFIX = "woodrail.";
/** How long a write waits for more writes to the same key before it goes to the copy (an autosave writes in bursts). */
export const MIRROR_DELAY_MS = 1500;

/** Where the copy lives: one entry per key. */
export interface Durable {
  keys(): Promise<string[]>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Put back each `woodrail.` key the storage has lost. Returns the keys put back. */
export async function restore(storage: Storage, durable: Durable): Promise<string[]> {
  const back: string[] = [];
  for (const key of await durable.keys()) {
    if (!key.startsWith(PREFIX) || storage.getItem(key) !== null) continue;
    const value = await durable.get(key);
    if (value === null) continue;
    try {
      storage.setItem(key, value);
      back.push(key);
    } catch {
      // Full: the copy keeps it for the next start.
    }
  }
  return back;
}

export interface Mirror {
  /** Write every waiting change to the copy now (the app going to the background). */
  flush(): Promise<void>;
}

/**
 * From now on, the storage's writes of `woodrail.` keys are copied to `durable`. It wraps setItem, removeItem and clear
 * on the storage's prototype (Storage.prototype in a page), copying only this storage's writes: sessionStorage shares
 * the prototype and is left alone. (Not on the object itself: defining a property on a Storage stores an item.)
 */
export function mirror(storage: Storage, durable: Durable, schedule: (fn: () => void, ms: number) => unknown = setTimeout): Mirror {
  /** Keys changed and not yet copied: the value to write, or null to remove. */
  const waiting = new Map<string, string | null>();
  let timer = false;
  let writing: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    timer = false;
    if (waiting.size === 0) return writing;
    const batch = [...waiting];
    waiting.clear();
    // One batch after another, so a remove can't overtake the set before it.
    writing = writing.then(async () => {
      for (const [key, value] of batch) {
        try {
          if (value === null) await durable.remove(key);
          else await durable.set(key, value);
        } catch {
          // The copy is a safety net: the game goes on with localStorage either way.
        }
      }
    });
    return writing;
  };
  const note = (key: string, value: string | null) => {
    if (!key.startsWith(PREFIX)) return;
    waiting.set(key, value);
    if (!timer) {
      timer = true;
      schedule(() => void flush(), MIRROR_DELAY_MS);
    }
  };

  const proto = Object.getPrototypeOf(storage) as Storage;
  const { setItem, removeItem, clear } = proto;
  proto.setItem = function (this: Storage, key: string, value: string) {
    setItem.call(this, key, value); // throws when full, and then nothing is copied: as the game saw it
    if (this === storage) note(String(key), String(value));
  };
  proto.removeItem = function (this: Storage, key: string) {
    removeItem.call(this, key);
    if (this === storage) note(String(key), null);
  };
  proto.clear = function (this: Storage) {
    const keys: string[] = [];
    if (this === storage) for (let i = 0; i < this.length; i++) keys.push(this.key(i) ?? "");
    clear.call(this);
    for (const k of keys) note(k, null);
  };
  return { flush };
}
