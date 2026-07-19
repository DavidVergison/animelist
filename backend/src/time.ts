/** Unix seconds (not milliseconds) — matches the schema's INTEGER timestamp columns
 * and AniList's own `airingAt` convention (README §4/§6). */
export function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
