import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadFaces } from "./ui3d/font/faces";

// Start rasterizing the UI's pixel fonts right away; the UI canvas suspends
// until they're ready (a few ms — they're bundled).
void loadFaces();

// No StrictMode: double-mounting a Rapier physics world in dev causes visible
// hitches and duplicated registrations for no benefit here.
createRoot(document.getElementById("root")!).render(<App />);
