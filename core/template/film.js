// __FILM__: film-specific code. Everything shared comes from the core engine.
// Shot ids come from story/story.json: each line id, plus "<id>.1", "<id>.2" for its "cuts",
// and a final "tail" shot after the narration. See AGENTS.md for the full engine reference.
import { createFilm, A, crowd, put, cam, v3, crowdWalk, easeOut, smooth } from "core/stage.js";

const ZM = [0, 8]; // Zero's mark on the street

createFilm({
  id: "__FILM__",
  // cast: { name: { hair, scale, chest, face, col } },   extra characters
  // board: (g, w, h) => { ... },                         picture on the tower screen
  shots: [
    // [cut id, "set mood", stage(t, u, s)]   t seconds, u 0..1 through the shot, s shot start
    ["hook", "town day", (t, u) => {
      crowdWalk(t);
      cam(t, v3(0, 58, 78), v3(0, 6, -10), v3(0, 30, 58), v3(0, 8, -14), smooth(u));
    }],
    ["zero", "town day", (t, u) => {
      put(A.zero, ...ZM, 0, "Wave", t, "happy");
      cam(t, v3(1.6, 4.4, 19.5), v3(0, 4.25, 8), v3(0.9, 4.3, 16.8), v3(0, 4.3, 8), easeOut(u));
    }],
    ["zero.1", "town day", (t, u) => {
      put(A.zero, ...ZM, 0, "Talk", t, "smug");
      cam(t, v3(1.1, 4.2, 16), v3(0, 4.15, 8), v3(0.6, 4.2, 14), v3(0, 4.15, 8), easeOut(u));
    }],
    ["tail", "town day", (t, u) => {
      put(A.zero, ...ZM, 0, "Idle", t, "happy");
      cam(t, v3(0.5, 4.2, 15), v3(0, 4.15, 8), v3(0.3, 4.2, 13), v3(0, 4.15, 8), easeOut(u));
    }],
  ],
});
