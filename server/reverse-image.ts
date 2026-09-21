import type { LedgerRow, ReverseImageLink } from "../shared/types.ts";
import { decodeAvatar, phashFromRgba, phashFromUrl } from "./phash.ts";

/** Public reverse-image search URLs. No engine scrape — operator opens the tab. */
export function reverseImageLinks(imageUrl: string): ReverseImageLink[] {
  const u = imageUrl.trim();
  if (!/^https?:\/\//i.test(u)) return [];
  const enc = encodeURIComponent(u);
  return [
    { engine: "Google Lens", url: `https://lens.google.com/uploadbyurl?url=${enc}` },
    { engine: "Yandex", url: `https://yandex.com/images/search?rpt=imageview&url=${enc}` },
    { engine: "TinEye", url: `https://tineye.com/search?url=${enc}` },
    { engine: "Bing Visual", url: `https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&sbisrc=UrlPaste&q=imgurl:${enc}` },
    { engine: "SauceNAO", url: `https://saucenao.com/search.php?url=${enc}` },
  ];
}

/** Engines that accept a local file upload when Umbra has no public image URL. */
export function reverseImageUploadLinks(): ReverseImageLink[] {
  return [
    { engine: "Google Lens (upload)", url: "https://lens.google.com/upload" },
    { engine: "Yandex (upload)", url: "https://yandex.com/images/" },
    { engine: "TinEye (upload)", url: "https://tineye.com/" },
    { engine: "Bing Visual (upload)", url: "https://www.bing.com/visualsearch" },
  ];
}

export function attachReverseImageToRow(row: LedgerRow): ReverseImageLink[] {
  const avatar = row.metadata?.avatarUrl;
  if (!avatar || !/^https?:\/\//i.test(avatar)) return [];
  const links = reverseImageLinks(avatar);
  row.metadata = {
    ...row.metadata,
    reverseImage: links,
    extra: {
      ...row.metadata?.extra,
      reverseLens: links[0]?.url ?? "",
      reverseYandex: links[1]?.url ?? "",
      reverseTinEye: links[2]?.url ?? "",
    },
  };
  return links;
}

export function attachReverseImageToFoundRows(rows: LedgerRow[]): number {
  let n = 0;
  for (const row of rows) {
    if (row.status !== "found") continue;
    if (attachReverseImageToRow(row).length) n += 1;
  }
  return n;
}

export function phashFromDataUrl(dataUrl: string): string | undefined {
  const m = dataUrl.trim().match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!m) return undefined;
  try {
    const bytes = Buffer.from(m[2], "base64");
    if (bytes.length > 2_000_000) return undefined;
    const decoded = decodeAvatar(bytes, m[1]);
    if (!decoded) return undefined;
    return phashFromRgba(decoded.data, decoded.width, decoded.height, decoded.channels);
  } catch {
    return undefined;
  }
}

export async function reverseFromPublicUrl(url: string): Promise<{
  phash?: string;
  reverseImage: ReverseImageLink[];
}> {
  const reverseImage = reverseImageLinks(url);
  const phash = await phashFromUrl(url);
  return { phash, reverseImage };
}
