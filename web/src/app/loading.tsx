import { LoadingSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <article className="mx-auto max-w-[1280px] px-6 py-16 lg:py-20">
      <LoadingSkeleton />
    </article>
  );
}
