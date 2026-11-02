// Website port: this banner only made sense inside Electron ("App should run
// inside Electron — deeplinks, offline checks..."). The web build is not an
// app shell, so it renders nothing now, matching the removal of the desktop
// window controls (minimize / maximize / close).
export default function EnvironmentWarning() {
  return null;
}
