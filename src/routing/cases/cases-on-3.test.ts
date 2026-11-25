import { describe } from "vitest";
import { shard } from "./run";

// (An eighth of the routing cases with the train dispatcher on: run.ts.)
describe("routing cases, dispatcher on, 3/8", () => shard(2, true));
