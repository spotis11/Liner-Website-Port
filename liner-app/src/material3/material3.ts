// MATERIAL 3 activation entry — loaded dynamically by main.tsx only when the
// "material3" design is selected (Settings → Appearance → App design).
import "./material3.css";
import { installM3Ripples } from "./ripples";

export function activateMaterial3(): void {
  installM3Ripples();
}
