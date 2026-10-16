"use client";

import { useState } from "react";
import { Check, Share2 } from "lucide-react";

/** Native share sheet where available (phones), otherwise copies the link. */
export function InviteButton({ url, text, label, copiedLabel }: { url: string; text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text, url });
        return;
      } catch (err) {
        // The member closed the sheet: nothing to do. Any other failure falls back to copying.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard blocked (permissions or an insecure context): show the link so it can be copied by hand.
      window.prompt(label, url);
    }
  }
  return (
    <button type="button" onClick={share} className="btn-primary h-11 w-full text-[14.5px]">
      {copied ? <Check size={16} /> : <Share2 size={16} />}
      {copied ? copiedLabel : label}
    </button>
  );
}
