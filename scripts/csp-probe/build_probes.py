import pathlib

base = pathlib.Path(__file__).parent
tpl = (base / "template.html").read_text()

OLD = (
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' data: https://fonts.gstatic.com; "
    "img-src 'self' * http: https: data: blob:; "
    "media-src 'self' * http: https: data: blob:; "
    "connect-src 'self' * http: https: ws: wss: data: blob:; "
    "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'"
)

NEW = (
    "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' "
    "https://www.youtube.com https://s.ytimg.com; "
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' data: https://fonts.gstatic.com; "
    "img-src 'self' * http: https: data: blob:; "
    "media-src 'self' * http: https: data: blob:; "
    "connect-src 'self' * http: https: ws: wss: data: blob:; "
    "worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'"
)

(base / "old.html").write_text(tpl.replace("__CSP__", OLD).replace("__NAME__", "old"))
(base / "new.html").write_text(tpl.replace("__CSP__", NEW).replace("__NAME__", "new"))
print("written old.html / new.html")
