import Link from "next/link";
import { tokenizePost } from "@/lib/posts";

export function RichText({ body, known }: { body: string; known: { orgs: Set<string>; handles: Set<string>; channels: Set<string> } }) {
  const segs = tokenizePost(body, known);
  return (
    <>
      {segs.map((s, i) => {
        switch (s.type) {
          case "org":
            return (
              <Link key={i} href={`/orgs/${s.slug}`} className="relative z-10 font-medium text-accent hover:underline">
                {s.value}
              </Link>
            );
          case "user":
            return (
              <Link key={i} href={`/u/${s.handle}`} className="relative z-10 font-medium text-accent hover:underline">
                {s.value}
              </Link>
            );
          case "channel":
            return (
              <Link key={i} href={`/channels/${s.slug}`} className="relative z-10 font-medium text-accent hover:underline">
                {s.value}
              </Link>
            );
          case "url":
            return (
              <a key={i} href={s.value} target="_blank" rel="noreferrer" className="relative z-10 text-accent hover:underline">
                {s.value.replace(/^https?:\/\//, "")}
              </a>
            );
          default:
            return <span key={i}>{s.value}</span>;
        }
      })}
    </>
  );
}
