"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusPage } from "@/components/status-page";

// Client boundary: the full message catalog stays out of the bundle, so the few strings live here.
const COPY = {
  en: { title: "Something went wrong", body: "This page hit an error. Try again, or head back to your feed.", retry: "Try again", home: "Go to feed", ref: "Reference" },
  es: { title: "Algo salió mal", body: "Esta página tuvo un error. Inténtalo de nuevo o vuelve a tu feed.", retry: "Reintentar", home: "Ir al feed", ref: "Referencia" },
} as const;

function useStatusCopy() {
  const [lang, setLang] = useState<keyof typeof COPY>("en");
  useEffect(() => {
    if (document.documentElement.lang === "es") setLang("es");
  }, []);
  return COPY[lang];
}

/** Route-level error boundary. Server errors are already reported by instrumentation (onRequestError). */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const copy = useStatusCopy();
  useEffect(() => {
    console.error("[route error]", error.digest ?? error.message);
  }, [error]);
  return (
    <StatusPage code="500" title={copy.title} body={copy.body}>
      <button type="button" onClick={reset} className="btn-primary">
        {copy.retry}
      </button>
      <Link href="/" className="btn-secondary">
        {copy.home}
      </Link>
      {error.digest && (
        <p className="mt-2 w-full text-[12px] text-faint">
          {copy.ref}: <code>{error.digest}</code>
        </p>
      )}
    </StatusPage>
  );
}
