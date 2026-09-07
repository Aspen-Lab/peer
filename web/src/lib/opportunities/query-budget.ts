/**
 * THE WHOLE PRODUCT'S DAILY WEB-SEARCH SPEND, and the Tavily key it is spent
 * against belongs to the USER, not the server — so this budget is per user,
 * per topic set, per local day. (Gemini/Vertex is the only search the server
 * pays for out of its own project.)
 *
 * 16 Events + 12 Jobs + 0 Papers = 28/day, or 868 in a 31-day month, against
 * Tavily's 1000-search monthly plan.
 *
 * PAPERS COST NOTHING HERE. They come from the free academic sources, which
 * have no monthly ceiling. The surface used to spend 4 searches a day on a
 * discovery side-channel that fed a response field nothing displayed; that
 * channel is deleted, and the ~124 searches a month it cost are the headroom
 * anything new (a manual refresh, say) gets to spend.
 */
export const EVENT_QUERY_BUDGET = 16;
export const JOB_QUERY_BUDGET = 12;
export const JOB_INTERNSHIP_QUERY_BUDGET = 5;

/**
 * Results requested per search. Providers charge per search, not per result,
 * so this costs nothing extra and is the cheapest lever on pool size — the
 * facet panel can only offer locations that made it into the pool.
 */
export const RESULTS_PER_SEARCH = 10;
