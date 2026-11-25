import { describe } from "vitest";
import { shard } from "./run";

// (An eighth of the routing cases with the train dispatcher on: run.ts.)
describe("routing cases, dispatcher on, 5/8", () => shard(4, true));
