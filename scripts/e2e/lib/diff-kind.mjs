// What kind of change a file's diff is, for scripts/e2e/affected.mjs: only comments, only words (string literals that
// read as prose), only how CSS paints (colours, shadows), or code. A words-only change needs the suites that assert on
// those words, not every suite that loads the module (a button label in hud.ts reaches every suite that loads the HUD).
//
// Conservative by design: anything it can't read for sure is "code", and "code" gets affected.mjs's full mapping.
// A changed string that looks like an identifier, a class name, a selector, a key or a path ("asking", ".empty-all",
// "coal") is code too: changing it changes what the program does. Only strings with a space, a non-ASCII character
// (an emoji, "…", "·") or sentence punctuation count as words.

/**
 * Scan JS/TS source into its code with every comment removed and every string literal's text replaced by a
 * placeholder, and the literals' text (a template's static parts, a regex's body) in order. Null when the scan can't be
 * sure (an unterminated literal or comment, unbalanced template braces): the caller then treats the change as code.
 */
export function scanJs(src) {
  let code = "";
  const strings = [];
  let i = 0;
  const n = src.length;
  // Braces open inside each template's ${…}: when one closes at depth 0, the template resumes.
  const templates = [];
  // Whether the code so far ends in a value (a name, a number, a literal, a closing bracket, a postfix ! or ++), to tell
  // a division from a regex literal, which can only start where a value can.
  let value = false;
  const regexKeywords = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await", "instanceof"]);
  const emit = (s, isValue) => { code += s; value = isValue; };
  const readQuoted = (q) => {
    // From the char after the opening quote; returns the text, or null if unterminated (a newline ends a '…' or "…").
    let out = "";
    while (i < n) {
      const c = src[i];
      if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === q) { i++; return out; }
      if (c === "\n") return null;
      out += c; i++;
    }
    return null;
  };
  // Reads a template's static part from i up to its closing ` (returns { text, end: "`" }) or a ${ (end: "${").
  const readTemplatePart = () => {
    let out = "";
    while (i < n) {
      const c = src[i];
      if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === "`") { i++; return { text: out, end: "`" }; }
      if (c === "$" && src[i + 1] === "{") { i += 2; return { text: out, end: "${" }; }
      out += c; i++;
    }
    return null;
  };
  const templatePart = () => {
    const part = readTemplatePart();
    if (!part) return false;
    strings.push(part.text);
    if (part.end === "`") emit("`T`", true);
    else { emit("`T${", false); templates.push(0); }
    return true;
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") { const e = src.indexOf("\n", i); i = e < 0 ? n : e; continue; }
    if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); if (e < 0) return null; i = e + 2; code += " "; continue; }
    if (c === '"' || c === "'") { i++; const s = readQuoted(c); if (s === null) return null; strings.push(s); emit(`${c}S${c}`, true); continue; }
    if (c === "`") { i++; if (!templatePart()) return null; continue; }
    if (templates.length && (c === "{" || c === "}")) {
      if (c === "{") { templates[templates.length - 1]++; emit(c, false); i++; continue; }
      if (templates[templates.length - 1] === 0) { templates.pop(); i++; code += "}T"; if (!templatePart()) return null; continue; }
      templates[templates.length - 1]--; emit(c, false); i++; continue;
    }
    if (c === "/" && !value) {
      // A regex literal: to its closing / outside a [class], then its flags.
      let j = i + 1;
      let inClass = false;
      let body = "";
      for (; j < n; j++) {
        const r = src[j];
        if (r === "\n") return null;
        if (r === "\\") { body += src.slice(j, j + 2); j++; continue; }
        if (r === "[") inClass = true;
        else if (r === "]") inClass = false;
        else if (r === "/" && !inClass) break;
        body += r;
      }
      if (j >= n) return null;
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      strings.push(body);
      emit("/R/", true);
      i = j;
      continue;
    }
    if (/[\w$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      emit(word, !regexKeywords.has(word));
      i = j;
      continue;
    }
    if (/\s/.test(c)) { code += c; i++; continue; }
    if ((c === "+" || c === "-") && d === c && value) { emit(c + c, true); i += 2; continue; }
    emit(c, (c === "!" && value) || c === ")" || c === "]");
    i++;
  }
  if (templates.length) return null;
  return { code, strings };
}

/** Code with whitespace runs collapsed, so a re-wrapped line isn't a change. */
const squash = (code) => code.replace(/\s+/g, " ").trim();

/**
 * Words, not code: a non-ASCII character (an emoji, "…", "·", "×"), or a space or sentence punctuation (?, !) in a
 * string that isn't all lowercase names and selectors ("feedback-small feedback-privacy", "keydown keyup", ".a > .b"
 * are code: class lists, event names, selectors).
 */
export function isProse(s) {
  if (/[^\x00-\x7f]/.test(s)) return true;
  const t = s.trim();
  if (!t || t.split(/\s+/).every((w) => /^[a-z0-9_.#:\-[\]="'()>+~*,]+$/.test(w))) return false;
  return /\s/.test(t) || /[A-Za-z][?!]/.test(t);
}

/** Each item of `a` not matched one-for-one in `b`. */
function minus(a, b) {
  const left = new Map();
  for (const s of b) left.set(s, (left.get(s) ?? 0) + 1);
  const out = [];
  for (const s of a) {
    const k = left.get(s) ?? 0;
    if (k > 0) left.set(s, k - 1);
    else out.push(s);
  }
  return out;
}

/**
 * A JS/TS file's change: { kind: "same" | "comment" | "copy" | "code", strings }. "comment": only comments (or
 * whitespace) changed. "copy": also string literals changed, and every one that changed (old and new) reads as prose;
 * `strings` lists them. Anything else, or a file that can't be scanned, is "code".
 */
export function classifyJs(before, after) {
  if (before === after) return { kind: "same", strings: [] };
  if (before == null || after == null) return { kind: "code", strings: [] };
  const a = scanJs(before);
  const b = scanJs(after);
  if (!a || !b) return { kind: "code", strings: [] };
  if (squash(a.code) !== squash(b.code)) return { kind: "code", strings: [] };
  const changed = [...minus(a.strings, b.strings), ...minus(b.strings, a.strings)];
  if (!changed.length) return { kind: "comment", strings: [] };
  if (!changed.every(isProse)) return { kind: "code", strings: changed };
  return { kind: "copy", strings: [...new Set(changed)] };
}

/**
 * Properties that change only how a thing is painted, never where it is, how big, whether it's there or whether it
 * takes a tap. (Not opacity or visibility: a check may read them; not outline: focus-ring asserts it; not font-weight or
 * letter-spacing: they change how wide a label is, and suites check labels fit.)
 */
const PAINT = new Set(["color", "background", "background-color", "background-image", "border-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "box-shadow", "text-shadow", "filter", "fill", "stroke", "caret-color", "accent-color", "text-decoration-color"]);
const COLOR = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla)\([^)]*\)|transparent|currentcolor|var\(--[\w-]+\)|[a-z]+)$/i;

/** CSS → Map<"context|selector", Set<"prop:value">> (comments dropped, @media and the like as context). */
export function cssRules(src) {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  const out = new Map();
  const stack = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") { stack.push(squash(buf)); buf = ""; continue; }
    if (c === "}") {
      const sel = stack.pop();
      if (sel === undefined) return null;
      if (buf.trim()) {
        const key = [...stack, sel].join(" | ");
        const decls = out.get(key) ?? new Set();
        for (const d of buf.split(";")) {
          const m = /^\s*([\w-]+)\s*:\s*([\s\S]*?)\s*$/.exec(d);
          if (m) decls.add(`${m[1].toLowerCase()}:${squash(m[2])}`);
        }
        out.set(key, decls);
      }
      buf = "";
      continue;
    }
    if (c === ";" && !stack.length) { buf = ""; continue; }
    buf += c;
  }
  return stack.length ? null : out;
}

/** A declaration that only paints: a PAINT property, or a custom property whose value is a colour. */
function paints(decl) {
  const k = decl.indexOf(":");
  const prop = decl.slice(0, k);
  const value = decl.slice(k + 1);
  if (PAINT.has(prop)) return true;
  return prop.startsWith("--") && COLOR.test(value.trim());
}

/**
 * A CSS file's change: { kind: "same" | "comment" | "paint" | "code", classes }. "paint": every declaration added or
 * taken away, in rules that were there before and still are, only paints; `classes` names the class names in those
 * rules' selectors. A rule added or removed, a selector changed, or any other property changed is "code".
 */
export function classifyCss(before, after) {
  if (before === after) return { kind: "same", classes: [] };
  if (before == null || after == null) return { kind: "code", classes: [] };
  const a = cssRules(before);
  const b = cssRules(after);
  if (!a || !b) return { kind: "code", classes: [] };
  const classes = new Set();
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const da = a.get(key);
    const db = b.get(key);
    if (!da || !db) return { kind: "code", classes: [] };
    const diff = [...[...da].filter((d) => !db.has(d)), ...[...db].filter((d) => !da.has(d))];
    if (!diff.length) continue;
    if (!diff.every(paints)) return { kind: "code", classes: [] };
    for (const m of key.matchAll(/\.([A-Za-z_][\w-]*)/g)) classes.add(m[1]);
  }
  return { kind: classes.size ? "paint" : "comment", classes: [...classes] };
}

/** Which classifier reads a path, if any. */
export function classifierOf(path) {
  if (/\.(m?[jt]s|cjs)$/.test(path) && !/\.d\.ts$/.test(path)) return "js";
  if (/\.css$/.test(path)) return "css";
  return null;
}

/** A path's change, before → after (null: the file didn't exist): { kind, strings?, classes? }. */
export function classify(path, before, after) {
  const by = classifierOf(path);
  if (by === "js") return classifyJs(before, after);
  if (by === "css") return classifyCss(before, after);
  return { kind: before === after ? "same" : "code" };
}

/**
 * Whether a suite's source refers to any of the changed words: one of its own literals (prose, so " " or "click"
 * don't match everything) is inside a changed string or holds one. So a suite asserting "Throw away? Tap again", or
 * one checking `includes("Throw away")`, is hit by a label "Throw away" → "Delete cargo".
 */
export function refersToWords(suiteSource, words) {
  const scan = scanJs(suiteSource);
  const lits = scan ? scan.strings.map((s) => s.trim()).filter((s) => isProse(s) && s.length >= 3) : [];
  const ws = words.map((w) => w.trim()).filter((w) => w.length >= 3);
  return lits.some((l) => ws.some((w) => l === w || within(w, l) || within(l, w)));
}

/**
 * `part` stands in `text` as words: it starts and ends with a letter, digit or emoji, sits on word boundaries, and is
 * two words or more, or one of six letters or more. (A template's piece such as "'s goods", glued to an expression,
 * says too little to tie a suite to a label.)
 */
function within(text, part) {
  if (!/^[\p{L}\p{N}\p{Extended_Pictographic}].*[\p{L}\p{N}\p{Extended_Pictographic}?!…]$/u.test(part)) return false;
  if (!/\s/.test(part) && part.length < 6) return false;
  const word = /[\p{L}\p{N}]/u;
  for (let k = text.indexOf(part); k >= 0; k = text.indexOf(part, k + 1)) {
    const before = text[k - 1];
    const after = text[k + part.length];
    if ((before === undefined || !word.test(before)) && (after === undefined || !word.test(after))) return true;
  }
  return false;
}

/** Whether a suite's source names any of these CSS classes (as `.name` in a selector, or "name" in classList calls). */
export function refersToClasses(suiteSource, classes) {
  return classes.some((c) => new RegExp(`(\\.|["'\`\\s])${c.replace(/[-]/g, "\\-")}(?![\\w-])`).test(suiteSource));
}
