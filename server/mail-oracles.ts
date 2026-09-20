import { coreHandlers } from "./mail-oracles-core.ts";
import { extraHandlers } from "./mail-oracles-extra.ts";
import { plusHandlers } from "./mail-oracles-plus.ts";

export const handlers = { ...coreHandlers, ...extraHandlers, ...plusHandlers };
