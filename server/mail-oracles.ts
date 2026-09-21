import { coreHandlers } from "./mail-oracles-core.ts";
import { extraHandlers } from "./mail-oracles-extra.ts";
import { extHandlers } from "./mail-oracles-ext.ts";
import { moreHandlers } from "./mail-oracles-more.ts";
import { plusHandlers } from "./mail-oracles-plus.ts";

import { packHandlers } from "./mail-oracles-pack.ts";

export const handlers = { ...coreHandlers, ...extraHandlers, ...plusHandlers, ...moreHandlers, ...extHandlers, ...packHandlers };
