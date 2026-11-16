/** @vitest-environment jsdom */

import { renderHook, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, expect, test } from "vitest";
import { WebSocket as WS, WebSocketServer } from "ws";

import { useWebSocket } from "../react";

let server: WebSocketServer;
let host: string;
const received: { path: string; protocol: string; message: string }[] = [];

beforeAll(async () => {
  server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a local TCP address");
  }
  host = `ws://127.0.0.1:${address.port}`;
  server.on("connection", (socket, request) => {
    socket.on("message", (data) => {
      received.push({
        path: request.url!,
        protocol: socket.protocol,
        message: data.toString()
      });
    });
  });
});

afterAll(async () => {
  for (const socket of server.clients) socket.terminate();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.each([
  {
    name: "a URL change",
    path: "/canvas-b",
    protocol: "canvas-a",
    transfer: undefined,
    keep: false
  },
  {
    name: "a protocol change",
    path: "/canvas-a",
    protocol: "canvas-b",
    transfer: undefined,
    keep: false
  },
  {
    name: "an explicit transfer",
    path: "/canvas-b",
    protocol: "canvas-b",
    transfer: true,
    keep: true
  }
])(
  "handles buffered messages on $name with unchanged options",
  async ({ path, protocol, transfer, keep }) => {
    received.length = 0;
    const options = {
      WebSocket: WS,
      startClosed: true,
      transferEnqueuedMessages: transfer
    };
    const { result, rerender, unmount } = renderHook(
      ({ path, protocol }) => useWebSocket(host + path, protocol, options),
      { initialProps: { path: "/canvas-a", protocol: "canvas-a" } }
    );
    const oldSocket = result.current;
    try {
      expect(oldSocket.send("canvas-a update")).toBe(false);
      rerender({ path, protocol });
      await waitFor(() => expect(result.current).not.toBe(oldSocket));
      await waitFor(() => expect(result.current.readyState).toBe(WS.OPEN));
      expect(result.current.send("ready")).toBe(true);
      // Frames are ordered: the marker arrives after any flushed messages.
      await waitFor(() => expect(received.at(-1)?.message).toBe("ready"));
      expect(received).toEqual(
        (keep ? ["canvas-a update", "ready"] : ["ready"]).map((message) => ({
          path,
          protocol,
          message
        }))
      );
    } finally {
      unmount();
    }
  }
);

test.each([
  { name: "the default policy", transfer: undefined, keep: true },
  { name: "explicit discard", transfer: false, keep: false }
])(
  "handles unchanged async providers with $name",
  async ({ transfer, keep }) => {
    received.length = 0;
    const url = async () => host + "/canvas-a";
    const protocols = async () => ["canvas-a"];
    const { result, rerender, unmount } = renderHook(
      ({ maxRetries }) =>
        useWebSocket(url, protocols, {
          WebSocket: WS,
          startClosed: true,
          maxRetries,
          transferEnqueuedMessages: transfer
        }),
      { initialProps: { maxRetries: 1 } }
    );
    const oldSocket = result.current;
    try {
      expect(oldSocket.send("canvas-a update")).toBe(false);
      rerender({ maxRetries: 2 });
      await waitFor(() => expect(result.current).not.toBe(oldSocket));
      await waitFor(() => expect(result.current.readyState).toBe(WS.OPEN));
      result.current.send("ready");
      await waitFor(() => expect(received.at(-1)?.message).toBe("ready"));
      expect(received).toEqual(
        (keep ? ["canvas-a update", "ready"] : ["ready"]).map((message) => ({
          path: "/canvas-a",
          protocol: "canvas-a",
          message
        }))
      );
    } finally {
      unmount();
    }
  }
);

test("compares against the destination that created a disabled socket", async () => {
  received.length = 0;
  const { result, rerender, unmount } = renderHook(
    ({ path, enabled }) =>
      useWebSocket(host + path, null, { WebSocket: WS, enabled }),
    { initialProps: { path: "/canvas-a", enabled: false } }
  );
  const oldSocket = result.current;
  try {
    oldSocket.send("canvas-a update");
    rerender({ path: "/canvas-b", enabled: false });
    expect(result.current).toBe(oldSocket);
    rerender({ path: "/canvas-b", enabled: true });
    await waitFor(() => expect(result.current).not.toBe(oldSocket));
    await waitFor(() => expect(result.current.readyState).toBe(WS.OPEN));
    result.current.send("ready");
    await waitFor(() => expect(received.at(-1)?.message).toBe("ready"));
    expect(received).toEqual([
      { path: "/canvas-b", protocol: "", message: "ready" }
    ]);
  } finally {
    unmount();
  }
});

test("keeps socket identity when only provider function identities change", () => {
  const { result, rerender, unmount } = renderHook(
    ({ url, protocols }) =>
      useWebSocket(url, protocols, { WebSocket: WS, startClosed: true }),
    {
      initialProps: {
        url: () => host + "/canvas-a",
        protocols: () => ["canvas-a"]
      }
    }
  );
  try {
    const oldSocket = result.current;
    rerender({ url: () => host + "/canvas-a", protocols: () => ["canvas-a"] });
    expect(result.current).toBe(oldSocket);
  } finally {
    unmount();
  }
});
