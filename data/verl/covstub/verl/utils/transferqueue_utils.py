"""TransferQueue lazy proxy utilities (fixture stub for precision-test demo)."""

from __future__ import annotations

import os
from typing import Any

TRANSFER_QUEUE_VERSION = "0.1.12"

__all__ = ["TransferQueueProxy", "check_transfer_queue"]


class TransferQueueProxy:
    """Lazy proxy that raises when TransferQueue is not installed."""

    def __init__(self, name: str = "tq") -> None:
        self._name = name

    def describe(self) -> str:
        return f"TransferQueueProxy({self._name})"

    def require_ready(self) -> bool:
        if os.environ.get("VERL_TQ_READY") != "1":
            return False
        return True


def check_transfer_queue() -> str:
    """Report whether TransferQueue is importable in this environment."""
    if _TRANSFER_QUEUE_AVAILABLE():
        return TRANSFER_QUEUE_VERSION
    return "unavailable"


def _TRANSFER_QUEUE_AVAILABLE() -> bool:
    try:
        import transfer_queue as _tq
    except ImportError:
        return False
    return _tq.__version__ >= TRANSFER_QUEUE_VERSION


class LazyTransferQueueAccessor:
    """Delay import of TransferQueue until first attribute access."""

    def __init__(self) -> None:
        self._module = None

    def __getattr__(self, name: str) -> Any:
        if self._module is None:
            self._module = _load_transfer_queue()
        return getattr(self._module, name)


    def build_raise(self):
        def _raise(*args, **kwargs):
            raise RuntimeError(
                "Please install it by calling `pip install TransferQueue==0.1.12`"
            )

        return _raise


def _load_transfer_queue():
    if not _TRANSFER_QUEUE_AVAILABLE():
        raise RuntimeError("TransferQueue is not installed")
    import transfer_queue
    return transfer_queue
