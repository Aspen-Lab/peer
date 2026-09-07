import { PersonaQuiz } from "@/components/persona/quiz";

export const metadata = {
  title: "Persona — Peer",
  description:
    "A short forced-choice quiz that maps your academic working style across five axes.",
};

export default function PersonaPage() {
  return (
    <article className="mx-auto max-w-[640px] px-6 py-16 lg:py-20">
      <header className="mb-10">
        <h1
          className="text-display lg:text-display-lg font-light text-heading tracking-[-0.02em] leading-[1.05] font-display"
        >
          Academic persona
        </h1>
        <p
          className="text-text-muted mt-3 text-lead leading-[1.6] max-w-[520px] font-reading"
        >
          Fifteen forced-choice questions across five working-style axes. Not a
          test, not a label — a description of how you tend to operate, useful
          for shaping your feed and noticing your own defaults.
        </p>
      </header>

      <PersonaQuiz />
    </article>
  );
}
