"""Per-request database selection for the Demo mode (sandbox).

Requests authenticated with a *sandbox* token (issued only by an admin through
/api/admin/sandbox/enter) read and write a separate database
(``<DB_NAME>_sandbox``). Everything else uses the real database. Because every
module receives the same ``db`` proxy object, all existing code is isolated
automatically — demo data can never reach real statistics, reports or exports.
"""
import contextvars

sandbox_mode = contextvars.ContextVar("sandbox_mode", default=False)


class SandboxAwareDB:
    """Proxy that resolves to the real or the sandbox Motor database per request."""

    def __init__(self, real, sandbox):
        object.__setattr__(self, "_real", real)
        object.__setattr__(self, "_sandbox", sandbox)

    def current(self):
        return self._sandbox if sandbox_mode.get() else self._real

    @property
    def real(self):
        return self._real

    @property
    def sandbox(self):
        return self._sandbox

    def __getattr__(self, name):
        return getattr(self.current(), name)

    def __getitem__(self, name):
        return self.current()[name]


class SandboxMiddleware:
    """Pure ASGI middleware: flags the request as sandbox when its bearer token
    carries the ``sandbox`` claim (signature and expiry verified)."""

    def __init__(self, app, decode):
        self.app = app
        self.decode = decode  # callable(token) -> payload dict, raises on invalid

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            return await self.app(scope, receive, send)
        is_sandbox = False
        for k, v in scope.get("headers") or []:
            if k == b"authorization":
                val = v.decode("latin-1")
                if val.lower().startswith("bearer "):
                    try:
                        is_sandbox = bool(self.decode(val[7:].strip()).get("sandbox"))
                    except Exception:
                        is_sandbox = False
                break
        token = sandbox_mode.set(is_sandbox)
        try:
            return await self.app(scope, receive, send)
        finally:
            sandbox_mode.reset(token)
