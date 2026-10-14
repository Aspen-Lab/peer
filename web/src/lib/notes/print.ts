// P10-09b (review 7.3): getting a note's export out of the page — a file saved, or the browser's print.
//
// There is no PDF library: "PDF" is the browser's print of `toPrintHtml`, in a hidden frame that holds the note alone
// (so the page, its toolbar and the windows around it are not in it), and the reader chooses "Save as PDF" there.
// Browser-only; nothing here runs on the server.

/** Save `text` as a file called `name` (an object URL clicked, then let go). */
export function downloadFile(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Print an HTML document from a hidden frame; the frame is removed afterwards. */
export function printHtml(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  const remove = () => frame.remove();
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) return remove();
    win.addEventListener("afterprint", remove);
    win.focus();
    win.print();
    // A browser that never reports the end of printing still lets the frame go.
    setTimeout(remove, 120_000);
  };
  frame.srcdoc = html;
  document.body.appendChild(frame);
}
