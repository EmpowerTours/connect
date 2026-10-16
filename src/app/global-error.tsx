"use client";

import "@fontsource-variable/inter";
import "./globals.css";
import { useEffect } from "react";
import { StatusPage } from "@/components/status-page";
import { APP_NAME } from "@/lib/brand";

/**
 * Last-resort boundary for errors in the root layout itself. It replaces the whole document,
 * so it renders its own <html> and <body>, and stays English-only (the locale lookup lives in
 * the layout that just failed).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[global error]", error.digest ?? error.message);
  }, [error]);
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <StatusPage code="500" title="Something went wrong" body={`${APP_NAME} hit an unexpected error. Please try again in a moment.`}>
          <button type="button" onClick={reset} className="btn-primary">
            Try again
          </button>
          {/* A full page load, not client navigation: the app shell itself failed. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="btn-secondary">
            Reload
          </a>
        </StatusPage>
        {error.digest && <p className="pb-6 text-center text-[12px] text-faint">Reference: {error.digest}</p>}
      </body>
    </html>
  );
}
