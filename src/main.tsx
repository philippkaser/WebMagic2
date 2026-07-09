import { createRoot } from "react-dom/client";
import { App } from "./App";

// No StrictMode: double-mounting a Rapier physics world in dev causes visible
// hitches and duplicated registrations for no benefit here.
createRoot(document.getElementById("root")!).render(<App />);
