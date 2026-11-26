import type { z } from "zod";

/**
 * Every upper bound in a Zod schema: numbers' `max`, and arrays', strings' and records' lengths, each by its path
 * (`[]` an array's items, `{}` a record's values and `{key}` its keys, `|n` a union's nth choice, a tuple's items by index). For the save
 * limits' guard (save-limits.test.ts): a bound found there that the guard doesn't know of fails it.
 */
export interface Bound {
  readonly path: string;
  /** What's bounded: a number's value, or an array's, string's or record's length. */
  readonly of: "number" | "array" | "string";
  readonly max: number;
}

interface Check {
  _zod: { def: { check: string; value?: number | bigint; inclusive?: boolean; maximum?: number } };
}

interface Def {
  type: string;
  checks?: Check[];
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  options?: z.ZodType[];
  items?: z.ZodType[];
  rest?: z.ZodType | null;
  keyType?: z.ZodType;
  valueType?: z.ZodType;
  in?: z.ZodType;
  out?: z.ZodType;
}

export function schemaBounds(schema: z.ZodType, path = "$"): Bound[] {
  const def = (schema as unknown as { _zod: { def: Def } })._zod.def;
  const out: Bound[] = [];
  for (const c of def.checks ?? []) {
    const d = c._zod.def;
    // (A number's `max` is "less_than", inclusive; `lt` isn't: its bound the whole number below.)
    if (d.check === "less_than") out.push({ path, of: "number", max: d.inclusive ? Number(d.value) : Math.ceil(Number(d.value)) - 1 });
    else if (d.check === "max_length" || d.check === "max_size") out.push({ path, of: def.type === "string" ? "string" : "array", max: d.maximum! });
    else if (d.check === "length_equals") out.push({ path, of: def.type === "string" ? "string" : "array", max: (d as { length?: number }).length! });
  }
  switch (def.type) {
    case "object":
      for (const [k, v] of Object.entries(def.shape!)) out.push(...schemaBounds(v, `${path}.${k}`));
      break;
    case "array":
      out.push(...schemaBounds(def.element!, `${path}[]`));
      break;
    case "optional":
    case "nullable":
    case "default":
    case "readonly":
    case "nonoptional":
      out.push(...schemaBounds(def.innerType!, path));
      break;
    case "union":
      def.options!.forEach((o, i) => out.push(...schemaBounds(o, `${path}|${i}`)));
      break;
    case "tuple":
      def.items!.forEach((o, i) => out.push(...schemaBounds(o, `${path}[${i}]`)));
      if (def.rest) out.push(...schemaBounds(def.rest, `${path}[...]`));
      break;
    case "record":
      out.push(...schemaBounds(def.keyType!, `${path}{key}`), ...schemaBounds(def.valueType!, `${path}{}`));
      break;
    case "pipe":
      out.push(...schemaBounds(def.in!, path), ...schemaBounds(def.out!, path));
      break;
  }
  return out;
}
