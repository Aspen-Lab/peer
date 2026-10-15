// A stand-in for the few DOM members `lib/notes/wysiwyg.ts` reads and writes (this project's tests run in plain Node:
// no jsdom, no dependency may be added). It is a tree of nodes with a type, a name, children, a parent, attributes
// and text — enough to draw a block into, edit like a browser would (change a text node's data, wrap or split a
// node), and read back. Everything layout- or selection-shaped is measured in a real browser instead.

export class FakeNode {
  nodeType: 1 | 3;
  nodeName: string;
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  attrs: Record<string, string> = {};
  className = "";
  data = "";

  constructor(type: 1 | 3, name: string, data = "") {
    this.nodeType = type;
    this.nodeName = name;
    this.data = data;
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): FakeNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get textContent(): string {
    return this.nodeType === 3 ? this.data : this.childNodes.map((c) => c.textContent).join("");
  }
  appendChild(child: FakeNode): FakeNode {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child: FakeNode): FakeNode {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  insertBefore(child: FakeNode, ref: FakeNode | null): FakeNode {
    child.parentNode?.removeChild(child);
    child.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(child);
    else this.childNodes.splice(i, 0, child);
    return child;
  }
  getAttribute(name: string): string | null {
    return name in this.attrs ? this.attrs[name] : null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  contains(other: FakeNode | null): boolean {
    for (let at = other; at; at = at.parentNode) if (at === this) return true;
    return false;
  }
}

export const fakeDocument = {
  createElement: (tag: string) => new FakeNode(1, tag.toUpperCase()),
  createTextNode: (data: string) => new FakeNode(3, "#text", data),
} as unknown as Document;

/** An element with children (strings become text nodes) and attributes: `h("strong", {}, "bold")`. */
export function h(tag: string, attrs: Record<string, string> = {}, ...kids: (FakeNode | string)[]): FakeNode {
  const el = new FakeNode(1, tag.toUpperCase());
  el.attrs = { ...attrs };
  for (const k of kids) el.appendChild(typeof k === "string" ? new FakeNode(3, "#text", k) : k);
  return el;
}

/** A chip, as `mountInline` draws it. */
export function chip(kind: string, src: string, label: string): FakeNode {
  return h("span", { contenteditable: "false", "data-chip": kind, "data-src": src }, label);
}

/** Every text node under `n`, in order. */
export function textNodes(n: FakeNode): FakeNode[] {
  return n.nodeType === 3 ? [n] : n.childNodes.flatMap(textNodes);
}

/** The tree as tags and text, for a readable assertion: `<strong>bold</strong> and text`. */
export function show(n: FakeNode): string {
  if (n.nodeType === 3) return n.data;
  const tag = n.nodeName.toLowerCase();
  const inner = n.childNodes.map(show).join("");
  if (n.attrs["data-chip"] !== undefined) return `[${inner}]`;
  if (n.nodeName === "BR") return n.attrs["data-pad"] !== undefined ? "" : "<br>";
  return tag === "div" ? inner : `<${tag}>${inner}</${tag}>`;
}
