import { describe } from "vitest";
import { shard } from "./run";

// (An eighth of the routing cases: run.ts.)
describe("routing cases 7/8", () => shard(6));
