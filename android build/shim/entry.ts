// Order matters: the shim must define window.electronAPI before the shared UI starts,
// and the phone stylesheet must come after the UI's own CSS so its overrides win.
import './electron-shim';
import '../../src/main';
import './mobile.css';
