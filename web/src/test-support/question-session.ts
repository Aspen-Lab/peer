// A scripted reader for the question bar (round P10, P10-03). This project's Vitest has no DOM,
// so the bar runs on the minimal hook runtime (`hook-runtime.ts`) and a reader does ONE gesture
// per render round, each seeing the bar as the last one left it. The test file must install the
// runtime itself, before this module is imported:
//
//   vi.mock("react", async (importOriginal) => {
//     const actual = await importOriginal<typeof import("react")>();
//     const { hookRuntime } = await import("@/test-support/hook-runtime");
//     return { ...actual, ...hookRuntime.hooks };
//   });
//
// The element tree the bar returns is searched for host elements; the handlers on them are
// called as a browser would call them. Every question in a test is invented.

import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { ASK } from "@/components/reader/copy";
import { QuestionField, type ExampleGroupProp } from "@/components/reader/question-field";

export type Props = Record<string, unknown> & { children?: ReactNode };
export type El = ReactElement<Props>;

export function elements(node: ReactNode): El[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as El;
  return [element, ...elements(element.props.children)];
}

export interface View {
  all: El[];
  /** The box (the `<section>`): focus and blur are handled here. */
  section: El;
  /** The bar's textarea — there is exactly one. */
  bar: El;
  /** Every textarea marked `data-ask-line` (always one). */
  inputs: El[];
  /** The dropdown, when it is open. */
  listbox: El | undefined;
  /** Its items, in order, the gist last. */
  options: El[];
  /** The group headings drawn inside the dropdown. */
  headings: string[];
  /** The Submit control of this render. */
  submit: El;
  /** Every checkbox the bar draws (there is none). */
  boxes: El[];
}
export type Step = (view: View) => void;

const call = (fn: unknown, ...args: unknown[]) => (fn as (...a: unknown[]) => void)(...args);
const text = (node: ReactNode): string =>
  Array.isArray(node) ? node.map(text).join("") : typeof node === "string" || typeof node === "number" ? String(node) : node && typeof node === "object" && "props" in node ? text((node as El).props.children) : "";

export function viewOf(tree: ReactNode): View {
  const all = elements(tree);
  const listbox = all.find((el) => el.props.role === "listbox");
  return {
    all,
    section: all.find((el) => el.type === "section")!,
    bar: all.find((el) => "data-ask-line" in el.props)!,
    inputs: all.filter((el) => "data-ask-line" in el.props),
    listbox,
    options: all.filter((el) => el.props.role === "option"),
    headings: all.filter((el) => el.props.role === "group" && el.props["aria-label"] !== ASK.chips.gist).map((el) => String(el.props["aria-label"])),
    // P12-06: both acknowledgement labels identify the same guarded control.
    submit: all.find((el) => el.type === "button" && (el.props.children === ASK.submit || el.props.children === ASK.submitted))!,
    boxes: all.filter((el) => el.type === "input" && el.props.type === "checkbox"),
  };
}

export const optionTexts = (view: View) => view.options.map((option) => text(option.props.children));

export const type = (value: string): Step => ({ bar }) => call(bar.props.onChange, { target: { value } });
export const key = (name: string, extra: Record<string, unknown> = {}, prevented?: { count: number }): Step =>
  ({ bar }) => call(bar.props.onKeyDown, { key: name, preventDefault: () => void (prevented && (prevented.count += 1)), ...extra });
export const enter = key("Enter");
export const focus: Step = ({ section, bar }) => {
  call(section.props.onFocus);
  call(bar.props.onFocus);
};
export const leave: Step = ({ section, bar }) => {
  call(bar.props.onBlur);
  call(section.props.onBlur, { currentTarget: { contains: () => false }, relatedTarget: null });
};
export const submit: Step = ({ submit: button }) => call(button.props.onClick);
export const pick = (index: number): Step => ({ options }) => call(options[index].props.onClick);
export const check = (fn: (view: View) => void): Step => fn;

class Wait extends Error {}
export const wait = (ms: number): Step => {
  let until = 0;
  return () => {
    until = until || Date.now() + ms;
    if (Date.now() < until) throw new Wait();
  };
};

export interface SessionProps {
  paperId: string;
  examples?: readonly ExampleGroupProp[];
  standing?: readonly string[];
  vague?: boolean;
}

/** One page open: the bar, and a reader who does one thing per render round. */
export async function session(script: Step[], props: SessionProps) {
  const queued = [...script];
  const latest: { view: View | null } = { view: null };
  const opened = await hookRuntime.mount(
    () => {
      latest.view = viewOf(QuestionField({ paperId: props.paperId, examples: props.examples ?? [], standing: props.standing, vague: props.vague }));
      const [round, setRound] = useState(0);
      useEffect(() => {
        const next = queued[0];
        if (!next) return;
        try {
          next(latest.view!);
        } catch (error) {
          if (error instanceof Wait) {
            const timer = setTimeout(() => setRound((n) => n + 1), 2);
            return () => clearTimeout(timer);
          }
          throw error;
        }
        queued.shift();
        setRound((n) => n + 1);
      }, [round]);
      return null;
    },
    { maxRounds: 400 },
  );
  opened.unmount();
}
