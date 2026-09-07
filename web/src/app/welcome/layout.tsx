import type { ReactNode } from "react";

// The welcome wizard is a full-screen, standalone experience with no app
// chrome: the masthead and the thumb bar both return null on this route.
export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
