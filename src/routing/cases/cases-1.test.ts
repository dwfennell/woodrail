import { describe } from "vitest";
import { shard } from "./run";

// (An eighth of the routing cases: run.ts.)
describe("routing cases 1/8", () => shard(0));
