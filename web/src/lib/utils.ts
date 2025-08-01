import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { ALLOWED_URL_PROTOCOLS } from "./constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const truncateString = (str: string, maxLength: number) => {
  return str.length > maxLength ? str.slice(0, maxLength - 1) + "..." : str;
};

/**
 * Custom URL transformer function for ReactMarkdown
 * Allows specific protocols to be used in markdown links
 * We use this with the urlTransform prop in ReactMarkdown
 */
export function transformLinkUri(href: string) {
  if (!href) return href;

  const url = href.trim();
  try {
    const parsedUrl = new URL(url);
    if (
      ALLOWED_URL_PROTOCOLS.some((protocol) =>
        parsedUrl.protocol.startsWith(protocol)
      )
    ) {
      return url;
    }
  } catch (e) {
    // If it's not a valid URL with protocol, return the original href
    return href;
  }
  return href;
}

export function isSubset(parent: string[], child: string[]): boolean {
  const parentSet = new Set(parent);
  return Array.from(new Set(child)).every((item) => parentSet.has(item));
}
