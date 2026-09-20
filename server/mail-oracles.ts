import { coreHandlers } from "./mail-oracles-core.ts";
import { extraHandlers } from "./mail-oracles-extra.ts";

export const handlers = { ...coreHandlers, ...extraHandlers };
