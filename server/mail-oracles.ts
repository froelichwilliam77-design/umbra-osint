import { coreHandlers } from "./mail-oracles-core.ts";
import { extraHandlers } from "./mail-oracles-extra.ts";
import { extHandlers } from "./mail-oracles-ext.ts";
import { moreHandlers } from "./mail-oracles-more.ts";
import { plusHandlers } from "./mail-oracles-plus.ts";

import { aiHandlers } from "./mail-oracles-ai.ts";
import { packHandlers } from "./mail-oracles-pack.ts";
import { writingHandlers } from "./mail-oracles-writing.ts";

export const handlers = {
  ...coreHandlers,
  ...extraHandlers,
  ...plusHandlers,
  ...moreHandlers,
  ...extHandlers,
  ...packHandlers,
  ...writingHandlers,
  ...aiHandlers,
};
