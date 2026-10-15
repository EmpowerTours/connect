"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { greeting } from "@/lib/today";

/** "Morning, Alex" — rendered with the server hour, then corrected to the viewer's local clock. */
export function Greeting({ name, locale, serverHour }: { name: string; locale: Locale; serverHour: number }) {
  const [hour, setHour] = useState(serverHour);
  useEffect(() => setHour(new Date().getHours()), []);
  return (
    <h1 className="text-[36px] font-semibold leading-[1.08] tracking-[-0.02em] text-fg md:text-[44px]">
      {greeting(hour, locale)},
      <br />
      <span className="bg-gradient-to-r from-accent to-[#8b5cf6] bg-clip-text text-transparent">{name}</span>
    </h1>
  );
}
