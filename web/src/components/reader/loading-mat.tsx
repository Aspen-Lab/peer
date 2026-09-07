// What stands where the page will be: the plate's mat at the plate's size,
// and two lines where the title goes. Not a skeleton — nothing shimmers, no
// row pretends to be a paragraph — just the two shapes that never move.

export function LoadingMat() {
  return (
    <div aria-busy="true" aria-label="Loading paper">
      <div className="rounded-2xl bg-[var(--plate-mat)] aspect-[16/9] mt-4" />
      <div className="mt-6 h-3 w-24 rounded-md bg-[var(--plate-mat)]" />
      <div className="mt-4 h-7 w-[86%] rounded-md bg-[var(--plate-mat)]" />
      <div className="mt-2.5 h-7 w-[58%] rounded-md bg-[var(--plate-mat)]" />
    </div>
  );
}
