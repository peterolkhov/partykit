---
"partysocket": patch
---

Fix `useWebSocket` retaining buffered messages when its URL or protocols change. Snapshot the destination with the connection options so the default transfer policy compares the old and new destinations correctly, including when the caller reuses an options object.
