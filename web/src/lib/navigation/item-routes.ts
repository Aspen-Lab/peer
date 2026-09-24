/**
 * ABC-freemium 9-05 · Ruling 26 point 5 — the shapes of the internal links the
 * feed builds, named once.
 *
 * **Why these exist at all, and why they are not `Route`.** With `typedRoutes`
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
 * all the way to that check. Handing it a `string` — which is what a
 * ternary of template literals infers to with no annotation — collapses the
 * check to `RouteImpl<string>`, which is the error this item started from.
 *
 * **These aliases are not a second route table and cannot drift into one.**
 * They are shapes, not a list of routes: the assertion that `/jobs/[id]` still
 * exists happens at each `<Link>`, against Next's own generated
 * `DynamicRoutes`. Delete the jobs detail page and `` `/jobs/${string}` ``
 * stops matching that branch, resolves to `never`, and every site using this
 * alias fails to compile. Proved by planting exactly that.
 *
 * **This does NOT replace `dead-links.test.ts`** — that resolves RENDERED links
 * against the route tree *and* `public/`, which is how `/CHANGELOG.md` is known
 * to be a real file rather than a dead link. Neither guard covers the other and
 * nothing was deleted.
 */

/**
 * The three feed item detail pages, as one shape.
 *
 * A ternary over item kind produces this union; annotating the binding with it
 * is what makes all three branches checked instead of widened to `string`.
 */
export type ItemDetailRoute =
  | `/papers/${string}`
  | `/events/${string}`
  | `/jobs/${string}`;

/** The paper "thinking surface" page, reached from the paper detail page. */
export type PaperSurfaceRoute = `/papers/${string}/surface`;
