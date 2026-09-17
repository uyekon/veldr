import { afterEach, expect, it, vi } from 'vitest';
import { routerMethods } from './app/router.js';

afterEach(() => vi.unstubAllGlobals());

it.each(['dailyPush', 'dp'])('opens %s links as dp without adding browser history', id => {
  vi.stubGlobal('location', { hash: `#/whiteboard/${id}` });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  const app = { ...routerMethods, currentNav: 'docs', activeWhiteboardId: 't',
    navTo(nav) { this.currentNav = nav; } };
  app.applyRouteFromHash();
  expect(app.activeWhiteboardId).toBe('dp');
  expect(app.currentRouteHash()).toBe('#/whiteboard/dp');
  if (id === 'dailyPush') expect(history.replaceState).toHaveBeenCalledWith(null, '', '#/whiteboard/dp');
  else expect(history.replaceState).not.toHaveBeenCalled();
});
