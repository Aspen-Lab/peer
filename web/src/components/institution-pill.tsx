"use client";

import { useEffect, useState } from "react";
import "./institution-pill.css";

const resolved = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

function loadLogo(name: string, id?: string): Promise<string | null> {
  const key = `${id ?? ""}|${name}`;
  if (resolved.has(key)) return Promise.resolve(resolved.get(key) ?? null);
  const existing = pending.get(key);
  if (existing) return existing;
  const params = new URLSearchParams({ name });
  if (id && /^I\d{1,15}$/.test(id)) params.set("id", id);
  const request = fetch(`/api/institutions/logo?${params}`)
    .then(async (response) => {
      if (!response.ok) return null;
      const data = await response.json() as { logoUrl?: string | null };
      const logo = data.logoUrl ?? null;
      if (resolved.size >= 500) resolved.delete(resolved.keys().next().value!);
      resolved.set(key, logo);
      return logo;
    }).catch(() => null).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

export function InstitutionPill({ name, id }: { name: string; id?: string }) {
  const key = `${id ?? ""}|${name}`;
  const [result, setResult] = useState<{ key: string; logo: string | null } | null>(null);
  useEffect(() => {
    let active = true;
    void loadLogo(name, id).then((logo) => { if (active) setResult({ key, logo }); });
    return () => { active = false; };
  }, [name, id, key]);
  const logo = result?.key === key ? result.logo : null;
  return (
    <span className="institution-pill">
      {logo && <span className="institution-pill__mark"><img src={logo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setResult({ key, logo: null })} /></span>}
      <span className="institution-pill__name">{name}</span>
    </span>
  );
}
