/// <reference types="vite/client" />
import io from "socket.io-client";

/** 开发与生产均走当前站点同源，由 Vite / Nginx 反代到 Node */
export const BACKEND_URL = "";

export const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
  autoConnect: true,
  path: "/socket.io/",
});

socket.on("connect", () => {
  console.log("Socket connected:", socket.id);
});

socket.on("disconnect", () => {
  console.log("Socket disconnected");
});
