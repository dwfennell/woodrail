import { describe } from "vitest";
import { shard } from "./run";

// (An eighth of the routing cases: run.ts.)
describe("routing cases 2/8", () => shard(1));
