/**
 * A thing made the first time it's wanted, from code fetched then (`import()`), and kept: for sheets and cards opened
 * now and then, so the bundle every start fetches doesn't carry them. `use(f)` calls `f` with it, at once if it's
 * made, else once it is (calls while it loads all wait, in order). `now` is it, or null till it's made.
 */
export interface Lazy<T> {
  readonly now: T | null;
  use(f: (t: T) => void): void;
}

export function lazy<T>(make: () => Promise<T>): Lazy<T> {
  let made: T | null = null;
  let waiting: ((t: T) => void)[] | null = null;
  return {
    get now() {
      return made;
    },
    use(f) {
      if (made !== null) return f(made);
      if (waiting) return void waiting.push(f);
      waiting = [f];
      void make().then((t) => {
        made = t;
        const fs = waiting!;
        waiting = null;
        for (const g of fs) g(t);
      });
    },
  };
}
