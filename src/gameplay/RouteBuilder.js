import { Route } from './Route.js';

/** Builds the Route for an event definition. */
export function buildEventRoute(roads, ev) {
  if (ev.road) {
    const r = roads.roads.find((x) => x.id === ev.road);
    if (!r) return null;
    if (r.closed) {
      const pts = roads.walkDistance(r, 0, r.length, ev.reverse ? -1 : 1);
      return new Route(pts, ev.type === 'circuit');
    }
    const pts = ev.reverse ? roads.walkDistance(r, r.count - 1, r.length, -1) : roads.walkDistance(r, 0, r.length, 1);
    // trim the very ends that sit inside junctions
    return new Route(pts.slice(6, pts.length - 6), false);
  }
  const wp = ev.waypoints;
  const closed = ev.type === 'circuit';
  const pts = [];
  const legs = closed ? wp.length : wp.length - 1;
  for (let k = 0; k < legs; k++) {
    const a = wp[k], b = wp[(k + 1) % wp.length];
    const seg = roads.route(a[0], a[1], b[0], b[1]);
    if (!seg) continue;
    if (pts.length) seg.shift();
    pts.push(...seg);
  }
  return new Route(pts, closed);
}
