// e2e:gl-lost on a desktop (see gl-lost.mjs): a suite of its own, so its pass is kept apart from the phone's.
process.env.GL_LOST_DESKTOP = "1";
await import("./gl-lost.mjs");
