/**
 * ABC-freemium 9-05 · Ruling 26 point 5 — the shape of an internal link the
 * feed builds, named once.
 *
 * **Why this exists at all, and why it is not `Route`.** With `typedRoutes`
 * on, Next generates `Route<T extends string = string>` = `RouteImpl<T>`, and
 * `RouteImpl`'s dynamic-route branch is
 * `T extends \`${DynamicRoutes<infer _>}${Suffix}\` ? T : never`. That branch is
 * driven by the type argument, so the **bare** `Route` — whose default `T` is
 * `string` — accepts static routes and rejects every dynamic one. Measured:
 * annotating `` `/papers/${id}` `` as `Route` fails with
 * *"Type '`/papers/${string}`' is not assignable to type 'Route'"*.
 *
 * The working shape is the template-literal type itself. `<Link>` is generic,
 * so it infers `RouteType` from what it is handed and then checks
 * `RouteImpl<RouteType>`; handing it one of these keeps the literal shape alive
 * all the way to that check. Handing it a `string` collapses the check to
 * `RouteImpl<string>`, which is the error this item started from.
 *
 * **This is a shape, not a second route table, and it cannot drift into one.**
 * The assertion that `/papers/[id]/surface` still exists happens at each
 * `<Link>`, against Next's own generated `DynamicRoutes`. Delete that page and
 * `` `/papers/${string}/surface` `` stops matching that branch, resolves to
 * `never`, and every site using this alias fails to compile.
 *
 * **This does NOT replace `dead-links.test.ts`** — that resolves RENDERED links
 * against the route tree *and* `public/`, which is how `/CHANGELOG.md` is known
 * to be a real file rather than a dead link. Neither guard covers the other and
 * nothing was deleted.
 *
 * (P9-35, §1h.60: this file also held the alias of "the three feed item detail
 * pages". Two of the three were removed with the events and jobs feeds, and
 * nothing imported the alias; it went.)
 */

/** The paper "thinking surface" page, reached from the paper detail page. */
export type PaperSurfaceRoute = `/papers/${string}/surface`;
